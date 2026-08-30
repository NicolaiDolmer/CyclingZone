#!/bin/bash
# PreToolUse hook (matcher: Bash). Blokerer shell-kald der er kendt for at
# haenge en agent-session ihjel, fordi de venter paa noget der aldrig kommer
# i en ikke-interaktiv session: en pager, eller stdin uden nogen der skriver
# til det.
#
# To fejlklasser:
#   1. git diff|log|show|branch UDEN --no-pager. I visse miljoeer (fx naar
#      GIT_PAGER/core.pager er sat, eller Bash-toolet allokerer en pty) tror
#      git at output gaar til en terminal og starter `less`, som saa venter
#      evigt paa en bruger der ikke findes.
#   2. Bare `python`/`python3` (REPL) eller `jq` med kun et filter og ingen
#      fil/pipe/redirect. Begge dele venter paa stdin der aldrig fyldes.
#
# Fejlen har ramt 3 gange (3/7, 25/7, 25/8) og er dokumenteret i
# docs/PROMPT_LIBRARY.md. Ejerens kommentar 25/8: prompt-regel + hook daekker
# kun "blokeret shell"-klassen; den anden halvdel (stalled generation) daekkes
# af scripts/agent-stall-watch.ps1.
#
# Exit 2 + stderr = bloker og vis beskeden. Fail-open ved alt uventet: en
# vagt der fejler maa aldrig kunne spaerre for legitimt arbejde.
#
# Design-praemis: konservativ. Enhver tvivl -> lad kommandoen igennem. En
# falsk positiv her blokerer en agent fra at goere sit arbejde; en falsk
# negativ betyder blot at fejlen ikke er fanget denne gang.
#
# Refs: #3423.

set -u

INPUT=$(cat 2>/dev/null || true)

case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *) exit 0 ;;
esac

CMD=$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -c 8000)
[ -z "$CMD" ] && exit 0

# Billig forhaandsfiltrering: de fleste Bash-kald indeholder ingen af de tre
# ord, og skal ikke betale for en node-opstart.
case "$CMD" in
  *git*|*python*|*jq*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

VERDICT=$(printf '%s' "$CMD" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const cmd = raw;
  if (!cmd.trim()) process.exit(0);

  // --- 1. git diff|log|show|branch uden --no-pager nogetsteds i kommandoen ---
  if (!cmd.includes("--no-pager")) {
    // diff/log/show er altid risikable naar de kan skrive langt output.
    const readSubcmdRe = /(?:^|[\s;&|])git\s+(?:-[^\s]+(?:=\S+)?\s+)*(diff|log|show)\b/;
    const readMatch = cmd.match(readSubcmdRe);
    if (readMatch) {
      console.log(JSON.stringify({ kind: "git-pager", subcommand: readMatch[1] }));
      process.exit(0);
    }

    // "git branch" bruges konstant til ting der ALDRIG pager (--show-current,
    // -d/-D sletning, -m/-M omdoebning, oprettelse) - kun ren LISTNING (ingen
    // positional branch-arg, ingen af de kendte enkelt-vaerdi/mutations-flag)
    // er den risikable form. Undtag ogsaa den dokumenterede commit-guard
    // "git branch --show-current && ..." eksplicit, saa vi aldrig braekker den.
    const branchSubcmdRe = /(?:^|[\s;&|])git\s+(?:-[^\s]+(?:=\S+)?\s+)*branch\b/g;
    const exemptBranchFlags = new Set([
      "--show-current", "-d", "-D", "--delete", "-m", "-M", "--move",
      "-c", "-C", "--copy", "-u", "--set-upstream-to", "--unset-upstream",
      "-f", "--force",
    ]);
    let bm;
    while ((bm = branchSubcmdRe.exec(cmd)) !== null) {
      const tail = cmd.slice(bm.index + bm[0].length).split(/;|&&|\|\||\||\n/)[0];
      const toks = tail.trim().split(/\s+/).filter(Boolean);
      const hasExemptFlag = toks.some((t) => exemptBranchFlags.has(t));
      const hasPositionalArg = toks.some((t) => !t.startsWith("-"));
      if (!hasExemptFlag && !hasPositionalArg) {
        console.log(JSON.stringify({ kind: "git-pager", subcommand: "branch" }));
        process.exit(0);
      }
    }
  }

  // --- 2. bare python/python3 REPL eller jq uden fil/pipe/redirect ---
  // Split i top-level chains (&&, ||, ;, newline), og hver chain i
  // pipeline-stages (|). Kun stage 0 i en pipeline kan mangle stdin - senere
  // stages faar input fra forrige stage.
  const chains = cmd.split(/&&|\|\|/);
  for (const chain of chains) {
    const stages = chain.split("|");
    const first = stages[0];
    const hasRedirect = /<\s*\S/.test(first) || /<<-?\s*\S/.test(first);
    if (hasRedirect) continue;

    // Split det foerste segment af chainen (foer evt. ";" eller newline) i
    // tokens - vi kigger kun paa selve python/jq-invokationen.
    const segments = first.split(/;|\n/);
    for (const seg of segments) {
      const tokens = seg.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;

      // Spring env-var-assignments over (FOO=bar python ...).
      let i = 0;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
      const bin = tokens[i];
      if (!bin) continue;
      const rest = tokens.slice(i + 1);

      if (bin === "python" || bin === "python3") {
        // Har den et script, -c "..." eller -m modul? Saa koerer den og
        // afslutter selv - ikke en haengende REPL.
        const hasScriptOrInlineCode = rest.some((t) => !t.startsWith("-")) ||
          rest.includes("-c") || rest.includes("-m");
        if (!hasScriptOrInlineCode) {
          console.log(JSON.stringify({ kind: "stdin-block", bin }));
          process.exit(0);
        }
      }

      if (bin === "jq") {
        // Taeller non-flag-argumenter. 0 = ingen filter, venter paa alt.
        // 1 = kun filter, venter paa input. 2+ = filter + fil, trygt.
        const nonFlagArgs = rest.filter((t) => !t.startsWith("-"));
        if (nonFlagArgs.length < 2) {
          console.log(JSON.stringify({ kind: "stdin-block", bin: "jq" }));
          process.exit(0);
        }
      }
    }
  }

  process.exit(0);
});
' 2>/dev/null) || exit 0

[ -z "$VERDICT" ] && exit 0

case "$VERDICT" in
  *'"kind":"git-pager"'*)
    SUB=$(printf '%s' "$VERDICT" | sed -n 's/.*"subcommand":"\([^"]*\)".*/\1/p')
    cat >&2 <<EOF
BLOCKED: git $SUB uden --no-pager kan starte en pager der venter evigt i en ikke-interaktiv session.
Brug i stedet: git --no-pager $SUB ...
(Ramt 3x: 3/7, 25/7, 25/8 - se docs/PROMPT_LIBRARY.md.)
EOF
    exit 2
    ;;
  *'"kind":"stdin-block"'*)
    BIN=$(printf '%s' "$VERDICT" | sed -n 's/.*"bin":"\([^"]*\)".*/\1/p')
    if [ "$BIN" = "jq" ]; then
      cat >&2 <<EOF
BLOCKED: 'jq' med kun et filter og ingen fil/pipe venter evigt paa stdin.
Giv jq en fil (jq '.filter' fil.json) eller pipe input ind (cmd | jq '.filter').
EOF
    else
      cat >&2 <<EOF
BLOCKED: bare '$BIN' starter en interaktiv REPL der venter evigt paa stdin.
Giv den et script ($BIN script.py) eller inline-kode ($BIN -c "...").
EOF
    fi
    exit 2
    ;;
  *) exit 0 ;;
esac
