#!/usr/bin/env bash
# Test suite for scripts/hooks/guard-agent-spawn.sh (#5142).
#
# Run from repo root: bash scripts/test-guard-agent-spawn.sh
#
# Koerer hooken mod syntetiske PreToolUse-payloads i en mktemp-run-mappe
# (CZ_AGENT_GUARD_RUN_DIR), saa det rigtige repos .claude/run/ aldrig roeres.
# Samme run()-moenster som scripts/test-guard-commit-branch.sh.
#
# De to spaerringer der testes:
#   1. wave-active.json findes  -> alt uden WAVE-praefiks afvises
#   2. 4 spawns paa 45 min      -> naeste afvises
# Plus fail-open-adfaerden: ukendte tools, ulaeselig JSON og udloebet
# wave-active.json maa ALDRIG blokere.
#
# Refs: #5142, #4918.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$REPO_ROOT/scripts/hooks/guard-agent-spawn.sh"

if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook ikke fundet: $HOOK"
  exit 1
fi

PASS=0
FAIL=0
WORK="$(mktemp -d)"
RUN_DIR="$WORK/run"
STDERR_TMP="$WORK/stderr"
mkdir -p "$RUN_DIR"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

export CZ_AGENT_GUARD_RUN_DIR="$RUN_DIR"

reset_state() {
  rm -f "$RUN_DIR/wave-active.json" "$RUN_DIR/agent-slots.jsonl"
}

# payload TOOL PROMPT -> JSON paa stdout
payload() {
  TOOL="$1" PROMPT="$2" node -e '
const o = { hook_event_name: "PreToolUse", tool_name: process.env.TOOL, tool_input: { prompt: process.env.PROMPT } };
process.stdout.write(JSON.stringify(o));
'
}

# typed_payload SUBAGENT_TYPE PROMPT -> JSON for et Agent-kald med subagent_type
typed_payload() {
  SUB="$1" PROMPT="$2" node -e '
const o = { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: process.env.PROMPT, subagent_type: process.env.SUB } };
process.stdout.write(JSON.stringify(o));
'
}

# workflow_payload NAME -> JSON for et Workflow-kald (ingen prompt, kun name/args)
workflow_payload() {
  WF="$1" node -e '
const o = { hook_event_name: "PreToolUse", tool_name: "Workflow", tool_input: { name: process.env.WF, args: { tracks: [] } } };
process.stdout.write(JSON.stringify(o));
'
}

# run NAME WANT_EXIT WANT_STDERR_SUBSTR JSON
run() {
  local name="$1" want_exit="$2" want_err="$3" json="$4"
  printf '%s' "$json" | bash "$HOOK" >/dev/null 2>"$STDERR_TMP"
  LAST_CODE=$?
  LAST_ERR="$(cat "$STDERR_TMP" 2>/dev/null || echo "")"

  local ok=1
  [ "$LAST_CODE" = "$want_exit" ] || ok=0
  if [ -n "$want_err" ] && ! printf '%s' "$LAST_ERR" | grep -qF -- "$want_err"; then ok=0; fi

  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1)); echo "PASS  $name"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $name (exit=$LAST_CODE want=$want_exit, want stderr~\"$want_err\")"
    [ -n "$LAST_ERR" ] && echo "  stderr head: $(printf '%s' "$LAST_ERR" | head -c 300)"
  fi
}

# registry_count -> antal linjer i registret
registry_count() {
  local n=""
  if [ -f "$RUN_DIR/agent-slots.jsonl" ]; then
    # grep -c printer "0" OG exiter 1 naar der ingen match er. Et "|| echo 0"
    # ville derfor give to linjer ("0\n0") og braekke sammenligningen.
    n="$(grep -c . "$RUN_DIR/agent-slots.jsonl" 2>/dev/null)"
  fi
  [ -z "$n" ] && n=0
  printf '%s' "$n"
}

expect_count() {
  local name="$1" want="$2"
  local got
  got="$(registry_count)"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); echo "PASS  $name"
  else
    FAIL=$((FAIL+1)); echo "FAIL  $name (registret har $got linjer, forventet $want)"
  fi
}

# write_wave_active MINUTES_UNTIL_EXPIRY
write_wave_active() {
  MINS="$1" OUT="$RUN_DIR/wave-active.json" node -e '
const fs = require("node:fs");
const mins = Number(process.env.MINS);
const now = Date.now();
fs.writeFileSync(process.env.OUT, JSON.stringify({
  startedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + mins * 60000).toISOString(),
  lanes: 4,
  tracks: [{ issue: 1, branch: "chore/x" }],
}));
'
}

# seed_registry N MINUTES_AGO
seed_registry() {
  N="$1" AGO="$2" OUT="$RUN_DIR/agent-slots.jsonl" node -e '
const fs = require("node:fs");
const n = Number(process.env.N);
const ago = Number(process.env.AGO) * 60000;
const now = Date.now();
const lines = [];
for (let i = 0; i < n; i++) lines.push(JSON.stringify({ ts: new Date(now - ago).toISOString(), tool: "Agent", label: "seed" }));
fs.writeFileSync(process.env.OUT, lines.join("\n") + "\n");
'
}

# ===== 1. Boelge aktiv =====

reset_state
write_wave_active 120

run "boelge aktiv: haandskrevet Agent-spawn -> BLOKERET" \
  2 "en boelge koerer allerede" "$(payload Agent 'Ret bug i race-motoren')"

run "boelge aktiv: WAVE-FOLLOWUP slipper igennem" \
  0 "" "$(payload Agent 'WAVE-FOLLOWUP: ret reviewerens fund i chore/x')"

run "boelge aktiv: WAVE-REVIEW slipper igennem" \
  0 "" "$(payload Agent 'WAVE-REVIEW: gennemgaa diffen paa chore/x')"

run "boelge aktiv: WAVE-LANE slipper igennem" \
  0 "" "$(payload Agent 'WAVE-LANE: #1234 chore/x')"

# Read-only-agenter aendrer ingen filer og koerer ingen tunge verifikationer,
# saa de bruger ikke den ressource loftet beskytter. Uden den undtagelse
# spaerrede en koerende boelge ogsaa for at SLAA NOGET OP.
run "boelge aktiv: READ-ONLY-praefiks slipper igennem" \
  0 "" "$(payload Agent 'READ-ONLY: find alle steder vi laeser app_config')"

run "boelge aktiv: subagent_type Explore slipper igennem" \
  0 "" "$(typed_payload Explore 'find alle steder vi laeser app_config')"

run "boelge aktiv: subagent_type Plan slipper igennem" \
  0 "" "$(typed_payload Plan 'laeg en plan for #1234')"

run "boelge aktiv: subagent_type general-purpose -> stadig BLOKERET" \
  2 "en boelge koerer allerede" "$(typed_payload general-purpose 'ret bug i race-motoren')"

expect_count "WAVE-praefikser og read-only-agenter taeller ikke i registret" 0

run "boelge aktiv: Workflow-kald uden praefiks -> BLOKERET" \
  2 "en boelge koerer allerede" "$(payload Workflow 'koer endnu en boelge')"

# Et Workflow-kald har ingen "prompt", kun "name"/"args". Selve wave-workflowet
# ER indgangen og maa aldrig blokeres af sin egen vagt - ellers kan hverken en
# dryRun-plan eller en recovery-boelge startes mens wave-active.json ligger der.
run "boelge aktiv: Workflow({name:'wave'}) slipper igennem" \
  0 "" "$(workflow_payload wave)"

run "boelge aktiv: et ANDET gemt workflow -> BLOKERET" \
  2 "en boelge koerer allerede" "$(workflow_payload andet-workflow)"

run "boelge aktiv: fejlbeskeden peger paa registerfilen" \
  2 "wave-active.json" "$(payload Agent 'Ret bug i race-motoren')"

# Udloebet boelge = efterladt fil fra en doed session, ikke en koerende boelge.
reset_state
write_wave_active -90
run "udloebet wave-active.json spaerrer IKKE" \
  0 "" "$(payload Agent 'Ret bug i race-motoren')"

# ===== 2. Hastighedsloft uden for boelger =====

reset_state
run "foerste spawn uden boelge -> tilladt" \
  0 "" "$(payload Agent 'opgave 1')"
expect_count "tilladt spawn registreres" 1

reset_state
seed_registry 4 5
run "4 spawns inden for 45 min -> naeste BLOKERET" \
  2 "loft: 4" "$(payload Agent 'opgave 5')"

run "rate-beskeden peger paa agent-slot-release.ps1" \
  2 "agent-slot-release.ps1" "$(payload Agent 'opgave 5')"

reset_state
seed_registry 4 90
run "4 spawns AELDRE end 45 min -> tilladt igen (vinduet udloeber)" \
  0 "" "$(payload Agent 'opgave 5')"

reset_state
seed_registry 3 5
run "3 spawns inden for vinduet -> det fjerde er stadig tilladt" \
  0 "" "$(payload Agent 'opgave 4')"
expect_count "det fjerde spawn blev registreret" 4
run "det femte er saa BLOKERET" \
  2 "loft: 4" "$(payload Agent 'opgave 5')"

# ===== 2b. Samtidighed (reviewer-fund paa PR #5147) =====
# Uden laas laeser N hook-processer der starter samtidig det SAMME register,
# ser alle "under loftet" og skriver alle: revieweren maalte 9 samtidige kald
# -> 5 tilladte ved loft 4, og skrivninger gik tabt fordi den sidste
# writeFileSync vandt. Med mkdir-laasen skal 9 parallelle kald give PRAECIS 4
# tilladte og et register med PRAECIS 4 linjer.

reset_state
CONC_DIR="$WORK/conc"
mkdir -p "$CONC_DIR"

for i in 1 2 3 4 5 6 7 8 9; do
  CONC_JSON="$(payload Agent "samtidig opgave $i")"
  (
    printf '%s' "$CONC_JSON" | bash "$HOOK" >/dev/null 2>&1
    echo $? > "$CONC_DIR/exit-$i"
  ) &
done
wait

CONC_ALLOWED=0
CONC_BLOCKED=0
for i in 1 2 3 4 5 6 7 8 9; do
  code="$(cat "$CONC_DIR/exit-$i" 2>/dev/null || echo "?")"
  case "$code" in
    0) CONC_ALLOWED=$((CONC_ALLOWED+1)) ;;
    2) CONC_BLOCKED=$((CONC_BLOCKED+1)) ;;
  esac
done

if [ "$CONC_ALLOWED" = "4" ] && [ "$CONC_BLOCKED" = "5" ]; then
  PASS=$((PASS+1)); echo "PASS  9 parallelle spawns -> praecis 4 tilladt, 5 blokeret"
else
  FAIL=$((FAIL+1))
  echo "FAIL  9 parallelle spawns (tilladt=$CONC_ALLOWED forventet 4, blokeret=$CONC_BLOCKED forventet 5)"
fi

expect_count "registret har praecis 4 linjer efter 9 parallelle kald" 4

# Laasen maa ikke efterlades: naeste kald ville ellers vente 5 sek pr. gang.
if [ -d "$RUN_DIR/agent-slots.lock" ]; then
  FAIL=$((FAIL+1)); echo "FAIL  laasemappen agent-slots.lock blev efterladt"
else
  PASS=$((PASS+1)); echo "PASS  laasemappen er ryddet efter koerslen"
fi

# ===== 3. Fail-open =====

reset_state
write_wave_active 120

run "andet tool end Agent/Workflow -> ignoreres" \
  0 "" "$(payload Bash 'npm run build')"

run "ulaeselig JSON -> fail-open" \
  0 "" "{ dette er ikke json"

run "tom stdin -> fail-open" \
  0 "" ""

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
