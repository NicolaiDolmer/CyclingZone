#!/bin/bash
# PreToolUse hook (matcher: Bash). Blokerer branch-skift i det DELTE hoved-checkout.
#
# Baggrund: C:\Dev\CyclingZone er ét arbejdstræ som alle sessioner deler, og et
# arbejdstræ kan kun stå på én branch ad gangen. Kører to sessioner samtidig,
# checker de hver deres branch ud oven i hinanden. Målt 25/8 kl. 13:32: seks
# branch-skift på 18 sekunder mellem tre branches (perf/4231, guard/4228,
# fix/4225) — ingen af dem havde et worktree.
#
# Hvorfor en ny hook, når guard-commit-branch.sh findes: den guard sidder ved
# COMMIT og fanger derfor kun konsekvensen — at en commit lander på en fremmed
# branch. Den kan ikke forhindre selve skiftet. Scriptet noterer selv 5 bid af
# samme fejlklasse (11/6, 12/6, 13/6, 6/8, 18/8). Denne hook flytter værnet op
# til mutationen: gør den ulovlige tilstand urepræsenterbar frem for at opdage
# den bagefter.
#
# Hvad der blokeres:  git checkout <branch> · git switch <branch> · -b / -c
# Hvad der IKKE blokeres:
#   - alt i et linked worktree (der er ingen anden session at kollidere med)
#   - git checkout -- <sti>        (filgendannelse)
#   - git checkout <ref> -- <sti>  (filgendannelse fra en ref)
#   - git checkout . og stier der findes på disk
#   - skift til main (hovedtræets hjemposition)
#
# Exit 2 + stderr = bloker og vis beskeden. Fail-open ved alt uventet: en vagt
# der fejler må aldrig kunne spærre for arbejdet.
#
# Leverer foerste halvdel af #4016 ("worktree-tvang for agenter"). #4016 foreslog en
# lock-fil med session-id; denne loesning er stroengere og billigere, fordi den ikke
# afhaenger af at nogen skriver og rydder en lock korrekt - hovedtraeet staar bare paa
# main, og saa er der ingen delt HEAD at kollidere om.
#
# Refs: #4016, #3112. Laering: .claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md

set -u

INPUT=$(cat 2>/dev/null || true)

# #8206: vurder den mappe kommandoen koerer i (inputtets cwd), ikke hook-processens
# cwd, og gaa til dens git-rod, saa en undermappe (frontend/) ogsaa daekkes.
# shellcheck source=lib/hook-cwd.sh
. "$(dirname "$0")/lib/hook-cwd.sh"
hook_enter_cwd "$INPUT"
# Kun i hoved-checkoutet. I et linked worktree er .git en FIL ("gitdir: ...").
# Dér er sessionen allerede isoleret, og så blander vi os ikke. Hvilket checkout
# et segment rammer, afgøres pr. segment nedenfor (cd <dir>, git -C <dir>), saa
# `git -C C:/Dev/CyclingZone switch x` fra et worktree ogsaa fanges (review #8207).

case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *) exit 0 ;;
esac

# Billig forhåndsfiltrering: langt de fleste Bash-kald nævner hverken checkout
# eller switch, og de skal ikke betale for en node-opstart.
case "$INPUT" in
  *checkout*|*switch*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

VERDICT=$(printf '%s' "$INPUT" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    const parsed = JSON.parse(raw);
    cmd = (parsed.tool_input && parsed.tool_input.command) || "";
  } catch {
    process.exit(0); // uparsbart input er ikke vores at dømme
  }
  if (!cmd) process.exit(0);

  const fs = require("fs");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const unquote = (t) => t.replace(/^["\x27]|["\x27]$/g, "");
  // Git Bash-stier (/c/dev/x) -> C:/dev/x paa Windows.
  const native = (p) => {
    const m = process.platform === "win32" && String(p).match(/^\/([a-zA-Z])(\/.*)?$/);
    return m ? `${m[1].toUpperCase()}:${m[2] || "/"}` : p;
  };
  // Vercel Security Review #8207: et mappe-argument med shell-ekspansion ($PWD, ~,
  // `...`, %X%) eller en mappe der ikke findes, er UKENDT. Saa beholdes den kendte
  // mappe (fail-closed), i stedet for at en uopslaaelig sti tolkes som "ikke hovedmappen".
  const at = (base, p) => {
    const raw = unquote(p);
    if (/[$`~%*?]/.test(raw)) return base;
    const abs = path.resolve(base, native(raw));
    try { return fs.statSync(abs).isDirectory() ? abs : base; } catch { return base; }
  };
  // Hoved-checkout = git-roden for mappen har en .git-MAPPE (linked worktree: fil).
  const isMainCheckout = (dir) => {
    try {
      const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return !!top && fs.statSync(path.join(top, ".git")).isDirectory();
    } catch { return false; }
  };

  // Del kommandoen i segmenter, så "cd x && git checkout y" også fanges.
  // Indlejret bash -c "..." / sh -c "..." pakkes ud, saa dens segmenter ogsaa ses.
  const flat = cmd.replace(/\b(?:bash|sh)\s+-l?c\s+("([^"\\]|\\.)*"|\x27[^\x27]*\x27)/g, (_, q) => " ; " + q.slice(1, -1).replace(/\\"/g, "\"") + " ; ");
  const segments = flat.split(/&&|\|\||[;\n|]/);
  // Kandidat-mapper (Vercel Security Review #8207, tredje runde): sporingen af cd/-C/
  // --work-tree maa kun TILFOEJE blokeringer, aldrig fjerne dem. Et segment blokeres,
  // hvis BLOT EN kandidat er hovedmappen: kommandoens startmappe, enhver mappe et
  // tidligere cd naaede (ogsaa i en subshell), -C, --work-tree, --git-dir og
  // GIT_DIR/GIT_WORK_TREE. Saa er vagten mindst lige saa streng som foer #8207.
  const start = process.cwd();
  const seen = [start];
  let dir = start;
  const stripGit = (p) => p.replace(/[\\/]\.git[\\/]?$/, "");

  for (const seg of segments) {
    // Subshell/gruppe: parenteser og klammer fjernes.
    const s = seg.trim().replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, "");
    // cd [--] [-flag] <sti> [2>/dev/null ...]: ekstra tokens efter stien er tilladt (review #8207).
    const cd = s.match(/^(?:cd|pushd|Set-Location|sl)\s+(?:--\s+)?(?:-[A-Za-z]+\s+)*("[^"]*"|\x27[^\x27]*\x27|[^\s;&|]+)(?:\s+.*)?$/);
    // Ingen continue: resten af segmentet tjekkes ogsaa, fx $(git switch x) efter stien (Vercel #8207).
    if (cd) { dir = at(dir, cd[1]); seen.push(dir); }
    // export GIT_DIR=... / GIT_WORK_TREE=...: gaelder resten af kommandoen.
    const exp = s.match(/^export\s+(?:GIT_DIR|GIT_WORK_TREE)=("[^"]*"|\x27[^\x27]*\x27|\S+)/);
    if (exp) seen.push(at(dir, stripGit(unquote(exp[1]))));
    // [VAR=x ...] [sudo/env ...] git [globale flag] (checkout|switch) <rest>
    // Hvert token der ligner git proeves (review #8207: "sudo -u git git checkout x").
    const toks = s.match(/"[^"]*"|\x27[^\x27]*\x27|\S+/g) || [];
    let i = -1, cands = null;
    for (let gi = 0; gi < toks.length && i < 0; gi++) {
      // Ogsaa git i en kommando-substitution: $(git og `git.
      if (!/(^|[\\/(`])git(\.exe)?$/i.test(unquote(toks[gi]))) continue;
      const c = [...seen, dir];
      for (const t of toks.slice(0, gi)) {
        const env = t.match(/^(?:GIT_DIR|GIT_WORK_TREE)=(.+)$/);
        if (env) c.push(at(dir, stripGit(unquote(env[1]))));
      }
      let segDir = dir, j = gi + 1;
      while (j < toks.length && toks[j].startsWith("-")) {
        const eq = toks[j].match(/^--(?:work-tree|git-dir)=(.+)$/);
        if (toks[j] === "-C" && j + 1 < toks.length) { segDir = at(segDir, toks[j + 1]); c.push(segDir); j += 2; }
        else if (eq) { c.push(at(segDir, stripGit(unquote(eq[1])))); j += 1; }
        else if ((toks[j] === "--work-tree" || toks[j] === "--git-dir") && j + 1 < toks.length) { c.push(at(segDir, stripGit(unquote(toks[j + 1])))); j += 2; }
        else if (toks[j] === "-c" && j + 1 < toks.length) j += 2;
        else j += 1;
      }
      if (toks[j] === "checkout" || toks[j] === "switch") { i = j; cands = c; }
    }
    if (i < 0) continue;
    if (!cands.some(isMainCheckout)) continue;
    const m = [null, toks[i], toks.slice(i + 1).join(" ")];

    const rest = (m[2] || "").trim();

    // "--" markerer filgendannelse: git checkout -- fil, git checkout HEAD -- fil
    if (/(^|\s)--(\s|$)/.test(rest)) continue;

    const tokens = rest.split(/\s+/).filter(Boolean).map(unquote); // "main" == main
    // Første token der ikke er et flag, er målet.
    const target = tokens.find((t) => !t.startsWith("-"));

    // Nye branches: -b / -c bærer altid et skift med sig.
    const createsBranch = tokens.some((t) => t === "-b" || t === "-c" || t === "-B" || t === "-C");

    if (!target && !createsBranch) continue;          // fx bart "git switch" -> git fejler selv
    if (!createsBranch && target === "main") continue; // hjempositionen er tilladt
    if (!createsBranch && target === ".") continue;    // git checkout . er filgendannelse

    console.log(JSON.stringify({ blocked: true, target: target || "(ny branch)", segment: s }));
    process.exit(0);
  }
  process.exit(0);
});
' 2>/dev/null) || exit 0

[ -z "$VERDICT" ] && exit 0

TARGET=$(printf '%s' "$VERDICT" | sed -n 's/.*"target":"\([^"]*\)".*/\1/p')
[ -z "$TARGET" ] && TARGET="din-branch"

SLUG=$(printf '%s' "$TARGET" | tr '/' '-')

cat >&2 <<EOF
[branch-lock] BLOKERET: hoved-checkoutet skifter ikke branch.

  C:\\Dev\\CyclingZone deles af alle sessioner. Skifter du branch her, skifter du
  den ogsaa under de andre sessioner der arbejder lige nu. Det skete 25/8 kl. 13:32
  med seks skift paa 18 sekunder mellem tre branches.

  Brug et worktree i stedet:

    pwsh -File scripts/new-worktree.ps1 -Branch $TARGET -FromBranch origin/main

  Aabn derefter arbejdet i:

    C:\\Dev\\CyclingZone-worktrees\\$SLUG

  Hovedmappen bliver staaende paa main. Filgendannelse (git checkout -- fil)
  og skift tilbage til main er stadig tilladt.
EOF
exit 2
