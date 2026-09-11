#!/bin/bash
# PreToolUse hook (matcher: Agent|Workflow). Haandhaever orkestrator-standard v2
# (#5142) i selve INDGANGEN i stedet for i docs og hukommelse.
#
# Fejlklassen 11/9: orkestratoren startede 9 haandskrevne subagenter selvom
# loftet (3 dengang) stod i docs/NIGHT_WAVE_RUNBOOK.md, i AGENTS.md hard rule 24
# og i memory. CPU laa paa 100 % i timevis, og ejeren maatte spoerge to gange
# hvad der foregik. Praecis samme klasse som 2/9 og 6/9. En regel der kun findes
# som prosa bliver brudt af den naeste session der har travlt - derfor denne hook.
#
# To spaerringer:
#   1. Koerer en boelge (.claude/run/wave-active.json findes og er ikke udloebet),
#      afvises ALLE Agent-spawns undtagen dem hvis prompt starter med et
#      WAVE-praefiks. Byggearbejde under en boelge hoerer til i wave.js' lane-pool,
#      ikke i et haandskrevet Agent-kald ved siden af.
#   2. Uden for en boelge: maks 4 spawns inden for de sidste 45 min. Hooken
#      appender selv en linje pr. TILLADT spawn til .claude/run/agent-slots.jsonl.
#
# Hvorfor et VINDUE og ikke en total: registret skal begraense HASTIGHEDEN af
# haandskrevne spawns, ikke det samlede antal for evigt. Et vindue betyder at
# registret aldrig kraever manuel nulstilling for at sessionen kan arbejde
# videre. 45 min er samme tal som stall-graensen i wave-lane-watch.ps1: en agent
# startet for mere end 45 min siden er enten faerdig eller allerede flagget.
# Manuel frigivelse alligevel: pwsh -File scripts/agent-slot-release.ps1
#
# FRITAGNE PRAEFIKSER (kanonisk liste - staar ogsaa som EXEMPT_PREFIXES i
# node-programmet nedenfor og i CLAUDE.md's afsnit "Orkestrator-standard"):
#   WAVE-LANE:      - et spor i wave.js' lane-pool
#   WAVE-REVIEW:    - reviewer-agenten paa et spor
#   WAVE-FOLLOWUP:  - EEN opfoelgning ad gangen i et EKSISTERENDE worktree
#   WAVE-SETUP:     - fase 0 (worktrees, briefs, lane-watch)
#   WAVE-CLEANUP:   - sidste fase (oprydning, rapport)
#   READ-ONLY:      - en agent der kun laeser (audit, opslag, research)
#
# Desuden fritages agenter med subagent_type Explore eller Plan: de aendrer
# ingen filer og koerer ingen tunge verifikationer, saa de bruger ikke den
# ressource loftet beskytter (CPU til byg + verifikation). Uden den undtagelse
# spaerrede en koerende boelge ogsaa for at SLAA NOGET OP, og det var ikke
# meningen med spaerringen.
#
# Exit 2 + stderr = bloker og vis beskeden. Fail-open ved alt uventet: en vagt
# der fejler maa aldrig kunne spaerre for legitimt arbejde.
#
# Selvtest: bash scripts/test-guard-agent-spawn.sh
#
# Refs #5142, #4918, #4920.

set -u

INPUT=$(cat 2>/dev/null || true)
[ -z "$INPUT" ] && exit 0

case "$INPUT" in
  *'"tool_name"'*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

# Run-mappe: normalt <repo-root>/.claude/run. CZ_AGENT_GUARD_RUN_DIR findes for
# selvtesten, saa den aldrig roerer det rigtige repos register.
if [ -n "${CZ_AGENT_GUARD_RUN_DIR:-}" ]; then
  RUN_DIR="$CZ_AGENT_GUARD_RUN_DIR"
else
  ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  [ -z "$ROOT" ] && exit 0
  # Worktrees deler hoved-repoets register: ellers ville hvert worktree have sit
  # eget loft, og loftet ville i praksis ikke findes.
  COMMON=$(git rev-parse --git-common-dir 2>/dev/null || true)
  if [ -n "$COMMON" ]; then
    case "$COMMON" in
      /*|[A-Za-z]:*) ABS="$COMMON" ;;
      *) ABS="$ROOT/$COMMON" ;;
    esac
    MAIN=$(dirname "$ABS")
    [ -d "$MAIN" ] && ROOT="$MAIN"
  fi
  RUN_DIR="$ROOT/.claude/run"
fi

MAX_SPAWNS=${CZ_AGENT_GUARD_MAX:-4}
WINDOW_MIN=${CZ_AGENT_GUARD_WINDOW_MIN:-45}

VERDICT=$(printf '%s' "$INPUT" | \
  CZ_RUN_DIR="$RUN_DIR" CZ_MAX="$MAX_SPAWNS" CZ_WINDOW="$WINDOW_MIN" \
  node -e '
const fs = require("node:fs");
const path = require("node:path");
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const tool = payload.tool_name || "";
  if (tool !== "Agent" && tool !== "Workflow") process.exit(0);

  const input = payload.tool_input || {};
  // Agent bruger "prompt"; Workflow har ingen prompt - det har "name"/"args".
  const prompt = String(input.prompt ?? input.description ?? "").trimStart();
  const workflowName = String(input.name ?? "");

  // Selve wave-workflowet er INDGANGEN og maa aldrig blokeres af sin egen vagt:
  // ellers kan hverken en dryRun-plan eller en recovery-boelge efter en doed
  // session startes, saa laenge wave-active.json ligger der.
  if (tool === "Workflow" && workflowName === "wave") process.exit(0);

  // Kanonisk praefiks-liste - samme liste som i hookens header og i CLAUDE.md.
  const EXEMPT_PREFIXES = ["WAVE-LANE:", "WAVE-REVIEW:", "WAVE-FOLLOWUP:", "WAVE-SETUP:", "WAVE-CLEANUP:", "READ-ONLY:"];
  const READ_ONLY_AGENT_TYPES = ["Explore", "Plan"];
  const subagentType = String(input.subagent_type ?? "");
  const isWave = EXEMPT_PREFIXES.some((p) => prompt.startsWith(p)) ||
    (tool === "Agent" && READ_ONLY_AGENT_TYPES.includes(subagentType));
  // Label til registret: et Workflow-kald har ingen prompt, saa uden dette blev
  // hver linje skrevet med tom label og registret kunne ikke laeses tilbage.
  const label = prompt || (workflowName ? `Workflow:${workflowName}` : `${tool}:(uden prompt)`);

  const runDir = process.env.CZ_RUN_DIR;
  const activeFile = path.join(runDir, "wave-active.json");
  const registry = path.join(runDir, "agent-slots.jsonl");
  const maxSpawns = Number(process.env.CZ_MAX) || 4;
  const windowMin = Number(process.env.CZ_WINDOW) || 45;
  const now = Date.now();

  // --- 1. Boelge koerer? ---
  let active = null;
  try {
    active = JSON.parse(fs.readFileSync(activeFile, "utf8"));
  } catch { active = null; }
  if (active) {
    const expires = Date.parse(active.expiresAt || "");
    // En udloebet wave-active.json er en efterladt fil fra en doed session, ikke
    // en koerende boelge. Den maa ikke kunne spaerre repoet for altid.
    if (Number.isFinite(expires) && expires < now) {
      active = null;
    }
  }
  if (active && !isWave) {
    out({ block: "wave-active", file: activeFile, started: active.startedAt || "?", lanes: active.lanes ?? "?", tool });
  }

  // Wave-agenter taeller ikke i registret: lane-loftet haandhaeves af wave.js.
  if (isWave) process.exit(0);

  // --- 2. Hastighedsloft uden for boelger ---
  // LAAS om hele laes-taal-skriv. Uden den er loftet kun vejledende: N
  // hook-processer der starter i samme sekund laeser alle det samme register,
  // ser alle "under loftet" og skriver alle. Maalt af revieweren paa PR #5147:
  // 9 samtidige kald gav 5 tilladte ved loft 4, og skrivninger gik tabt fordi
  // den sidste writeFileSync vandt over de andre.
  //
  // mkdir er den portable atomiske primitiv: den fejler med EEXIST hvis mappen
  // findes, paa baade NTFS og POSIX, og kraever ikke flock (som Git Bash paa
  // Windows ikke har). Ventetid er begraenset, og en efterladt laas (en
  // hook-proces draebt mellem mkdir og rmdir) ryddes af den naeste der kommer
  // forbi - en vagt der fejler maa aldrig kunne spaerre for legitimt arbejde.
  const lockDir = path.join(runDir, "agent-slots.lock");
  const LOCK_WAIT_MS = 5000;
  const LOCK_STALE_MS = 30000;
  const sleepSync = (ms) => {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ingen sleep: spin videre */ }
  };
  let holdsLock = false;
  const releaseLock = () => {
    if (!holdsLock) return;
    holdsLock = false;
    try { fs.rmdirSync(lockDir); } catch { /* allerede vaek */ }
  };
  process.on("exit", releaseLock);   // ogsaa ved out()/process.exit()

  try { fs.mkdirSync(runDir, { recursive: true }); } catch { /* best-effort */ }
  const lockDeadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < lockDeadline) {
    try { fs.mkdirSync(lockDir); holdsLock = true; break; }
    catch (err) {
      if (!err || err.code !== "EEXIST") break;   // alt andet end "optaget": fail-open
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(lockDir); continue; }
      } catch { /* laasen forsvandt under os: proev igen med det samme */ }
      sleepSync(25);
    }
  }
  // Faar vi den ikke inden for LOCK_WAIT_MS, koerer vi alligevel videre: et
  // loft der af og til taeller en for meget er bedre end en vagt der haenger.

  let lines = [];
  try {
    lines = fs.readFileSync(registry, "utf8").split(/\r?\n/).filter((l) => l.trim());
  } catch { lines = []; }
  const cutoff = Date.now() - windowMin * 60 * 1000;
  const recent = [];
  const kept = [];
  for (const line of lines) {
    let ts = NaN;
    try { ts = Date.parse(JSON.parse(line).ts); } catch { ts = NaN; }
    if (!Number.isFinite(ts)) continue;      // ulaeselig linje: droppes
    if (ts < cutoff) continue;               // uden for vinduet: droppes med
    kept.push(line);                         // det samme, saa filen ikke vokser
    recent.push(ts);
  }
  if (recent.length >= maxSpawns) {
    releaseLock();
    out({ block: "rate", count: recent.length, max: maxSpawns, window: windowMin, file: registry, tool });
  }

  // Tilladt: registrér spawnet. Skriv den beskaarne liste tilbage, saa filen
  // ikke vokser uendeligt.
  try {
    const entry = JSON.stringify({ ts: new Date(now).toISOString(), tool, label: label.slice(0, 80) });
    fs.writeFileSync(registry, kept.concat(entry).join("\n") + "\n", "utf8");
  } catch { /* registrering er best-effort; den maa aldrig blokere et lovligt spawn */ }
  releaseLock();
  process.exit(0);
});
') || exit 0

[ -z "$VERDICT" ] && exit 0

case "$VERDICT" in
  *'"block":"wave-active"'*)
    FILE=$(printf '%s' "$VERDICT" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
    printf '%s\n' \
      "BLOKERET: en boelge koerer allerede (orkestrator-standard v2, #5142)." \
      "" \
      "Byggearbejde under en boelge hoerer hjemme i lane-poolen i .claude/workflows/wave.js," \
      "ikke i et haandskrevet Agent-kald ved siden af. 11/9 blev der startet 9 subagenter" \
      "paa den maade: CPU laa paa 100 % i timevis." \
      "" \
      "Goer i stedet ET af disse:" \
      "  1. Tilfoej sporet til wave.js' args og koer boelgen derfra." \
      "  2. Er det EN opfoelgning i et EKSISTERENDE worktree: start prompten med" \
      "     'WAVE-FOLLOWUP:' - een ad gangen." \
      "  3. Er boelgen faerdig (eller doed): slet registerfilen" \
      "     ${FILE}" \
      >&2
    exit 2
    ;;
  *'"block":"rate"'*)
    COUNT=$(printf '%s' "$VERDICT" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')
    MAXV=$(printf '%s' "$VERDICT" | sed -n 's/.*"max":\([0-9]*\).*/\1/p')
    WIN=$(printf '%s' "$VERDICT" | sed -n 's/.*"window":\([0-9]*\).*/\1/p')
    printf '%s\n' \
      "BLOKERET: ${COUNT} agent-spawns inden for de sidste ${WIN} min (loft: ${MAXV}, orkestrator-standard v2, #5142)." \
      "" \
      "Maskinen er DOLMERPC: 8 kerner. Flere end ${MAXV} samtidige spor gav 100 % CPU 11/9." \
      "" \
      "Goer i stedet ET af disse:" \
      "  1. Vent til et af de igangvaerende spor er faerdigt." \
      "  2. Skal der koeres flere spor: brug .claude/workflows/wave.js (4 laner + semafor)." \
      "  3. Er et spor reelt slut, men registret ikke opdateret:" \
      "     pwsh -File scripts/agent-slot-release.ps1" \
      >&2
    exit 2
    ;;
  *) exit 0 ;;
esac
