#!/bin/bash
# Stop-hook: close-out-reminder ved session-stop.
#  1) Advarer hvis NOW.md > 40 linjer (mål: 30)
#  2) Advarer hvis main har commits nyere end NOW.md (close-out glemt)

WARNINGS=()

# (1) NOW.md storrelse
if [ -f "docs/NOW.md" ]; then
  L=$(wc -l < "docs/NOW.md")
  if [ "$L" -gt 40 ]; then
    WARNINGS+=("NOW.md er $L linjer (maal: maks 30) - flyt historik til docs/archive/")
  fi
fi

# (1b) CLAUDE.md storrelse (HOT auto-load)
if [ -f "CLAUDE.md" ]; then
  L=$(wc -l < "CLAUDE.md")
  if [ "$L" -gt 80 ]; then
    WARNINGS+=("CLAUDE.md er $L linjer (maal: <60, fail >80) - flyt reference-indhold til docs/META_DOCS_INDEX.md")
  fi
fi

# (1c) MEMORY.md HOT-tier storrelse
MEM_PATH="$HOME/.claude/projects/C--dev-CyclingZone/memory/MEMORY.md"
if [ -f "$MEM_PATH" ]; then
  L=$(wc -l < "$MEM_PATH")
  if [ "$L" -gt 50 ]; then
    WARNINGS+=("MEMORY.md HOT er $L linjer (maal: <40, fail >50) - demotér entries til MEMORY_REFERENCE.md per docs/AI_OPS_TOKEN_BUDGET.md")
  fi
fi

# (2) Close-out-detektion: er origin/main blevet opdateret nyere end NOW.md?
#     Heuristik: nyeste main-commit <30min gammelt OG >5min nyere end NOW.md -> mind om close-out.
if [ -d ".git" ]; then
  LAST_MAIN_TS=$(git log origin/main -1 --format=%ct 2>/dev/null || echo 0)
  LAST_NOW_TS=$(git log -1 --format=%ct -- docs/NOW.md 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)

  if [ "$LAST_MAIN_TS" -gt 0 ] && [ "$LAST_NOW_TS" -gt 0 ]; then
    MAIN_AGE=$((NOW_TS - LAST_MAIN_TS))
    GAP=$((LAST_MAIN_TS - LAST_NOW_TS))
    if [ "$MAIN_AGE" -lt 1800 ] && [ "$GAP" -gt 300 ]; then
      LATEST_MAIN_MSG=$(git log origin/main -1 --format=%s 2>/dev/null | head -c 80)
      WARNINGS+=("main blev opdateret \\\"$LATEST_MAIN_MSG\\\" - har du koert close-out? (NOW.md entry, FEATURE_STATUS.md hvis kontrakt-aendring, learnings hvis bugfix, claude:done label paa issue)")
    fi
  fi
fi

# Output samlet warning
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  MSG=""
  for w in "${WARNINGS[@]}"; do
    MSG="${MSG}- ${w}\\n"
  done
  printf '{"systemMessage": "CLOSE-OUT REMINDER:\\n%s"}\n' "$MSG"
fi
