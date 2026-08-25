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

# Kun i hoved-checkoutet. I et linked worktree er .git en FIL ("gitdir: ...").
# Dér er sessionen allerede isoleret, og så blander vi os ikke.
[ -f .git ] && exit 0
[ -d .git ] || exit 0

INPUT=$(cat 2>/dev/null || true)

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

  // Del kommandoen i segmenter, så "cd x && git checkout y" også fanges.
  const segments = cmd.split(/&&|\|\||[;\n|]/);

  for (const seg of segments) {
    const s = seg.trim();
    const m = s.match(/(?:^|\s)git\s+(?:-[^\s]+\s+)*(checkout|switch)\b(.*)$/);
    if (!m) continue;

    const rest = (m[2] || "").trim();

    // "--" markerer filgendannelse: git checkout -- fil, git checkout HEAD -- fil
    if (/(^|\s)--(\s|$)/.test(rest)) continue;

    const tokens = rest.split(/\s+/).filter(Boolean);
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
