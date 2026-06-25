#!/usr/bin/env bash
# check-memory-budget.sh — SessionStart hook: surfacer MEMORY.md HOT-tier budget-status.
#
# HOT auto-memory (MEMORY.md) auto-loades HVER session og koster tokens hver gang.
# Den drifter når man tilføjer entries uden at demotere — og den gamle gate var opt-in
# ("kør check-agent-token-hygiene.ps1 ved lange sessioner"), så drift (61 linjer/3.600 tok
# 2026-06-25) var usynlig i ugevis. Denne hook gør budgettet synligt ved hver session-start,
# hvor man kan handle på det. Non-blocking (altid exit 0 — en session må aldrig fejle på dette).
#
# Kanoniske tærskler håndhæves OGSÅ i scripts/check-agent-token-hygiene.ps1
# (claude-memory + memory-hot-budget checks). Hold dem i sync.
set -u

mem=""
for cand in \
  "${HOME:-}/.claude/projects/C--Dev-CyclingZone/memory/MEMORY.md" \
  "${USERPROFILE:-}/.claude/projects/C--Dev-CyclingZone/memory/MEMORY.md" \
  "${OneDrive:-}/CyclingZone-context/memory/MEMORY.md"; do
  if [ -n "$cand" ] && [ -f "$cand" ]; then mem="$cand"; break; fi
done
[ -z "$mem" ] && exit 0

chars=$(wc -c < "$mem" | tr -d ' ')
lines=$(wc -l < "$mem" | tr -d ' ')
tok=$(( chars / 4 ))

# Tærskler — hold i sync med check-agent-token-hygiene.ps1
TOK_WARN=2800; TOK_FAIL=3200
LINE_WARN=48;  LINE_FAIL=54

status="OK"
if [ "$tok" -gt "$TOK_FAIL" ] || [ "$lines" -gt "$LINE_FAIL" ]; then
  status="FAIL"
elif [ "$tok" -gt "$TOK_WARN" ] || [ "$lines" -gt "$LINE_WARN" ]; then
  status="WARN"
fi

if [ "$status" != "OK" ]; then
  echo "⚠️  MEMORY.md HOT-budget $status: ${tok} tok / ${lines} linjer (mål ≤${TOK_WARN} tok / ≤${LINE_WARN} linjer; fail >${TOK_FAIL} / >${LINE_FAIL})."
  echo "    → Trim ved close-out: demotér lav-frekvens/graduerede entries til MEMORY_REFERENCE.md (se memory/README.md)."
fi
exit 0
