#!/bin/bash
# Stop-hook: close-out-reminder + NOW.md auto-archive ved session-stop.
#  1) Auto-arkivér NOW.md hvis >30 linjer (ældste linjer ned i docs/archive/NOW-YYYY-MM-DD.md)
#  2) Advarer hvis CLAUDE.md eller MEMORY.md over budget
#  3) Advarer hvis main har commits nyere end NOW.md (close-out glemt)
#  4) Reminder hvis seneste main-commit har "Refs #N" men issue ikke har comment fra denne session
#
# Refs: GitHub issues #75, #76.

WARNINGS=()

# (1) NOW.md auto-archive ved >30 linjer
if [ -f "docs/NOW.md" ]; then
  L=$(wc -l < "docs/NOW.md")
  if [ "$L" -gt 30 ]; then
    # Find første "## " header — alt FØR den (efter første header) er stale aktiv-noter,
    # alt EFTER fjernes når der er for mange linjer.
    # Strategi: bevar første 30 linjer, append rest til archive.
    ARCHIVE_DIR="docs/archive"
    mkdir -p "$ARCHIVE_DIR" 2>/dev/null
    DATE_TAG=$(date +%F)
    ARCHIVE_FILE="$ARCHIVE_DIR/NOW-$DATE_TAG.md"

    # Find sidste sektions-header indenfor de første 30 linjer for at klippe pænt.
    # Fallback: bare klip ved linje 30.
    CUT_LINE=$(head -30 "docs/NOW.md" | grep -n '^## ' | tail -1 | cut -d: -f1)
    if [ -z "$CUT_LINE" ] || [ "$CUT_LINE" -lt 5 ]; then
      CUT_LINE=30
    fi

    # Append overskydende (linjer efter CUT_LINE) til arkivet med header.
    {
      echo ""
      echo "## Auto-archived $(date -Iseconds)"
      echo ""
      tail -n +$((CUT_LINE + 1)) "docs/NOW.md"
    } >> "$ARCHIVE_FILE"

    # Trim NOW.md til CUT_LINE linjer.
    head -n "$CUT_LINE" "docs/NOW.md" > "docs/NOW.md.tmp" && mv "docs/NOW.md.tmp" "docs/NOW.md"

    WARNINGS+=("NOW.md var $L linjer - auto-arkiverede linjer >${CUT_LINE} til $ARCHIVE_FILE")
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

    # (3) Refs #N reminder: seneste commit på main har Refs #N men issue mangler en
    # session-comment med matching SHA (heuristik for "AI lukkede ikke loopen").
    if [ "$MAIN_AGE" -lt 1800 ] && command -v gh >/dev/null 2>&1; then
      LATEST_MSG=$(git log origin/main -1 --format=%B 2>/dev/null | head -c 2000)
      REFS=$(printf '%s' "$LATEST_MSG" | grep -Eoi 'Refs #[0-9]+' | grep -Eo '[0-9]+' | sort -u)
      LATEST_SHA=$(git log origin/main -1 --format=%H 2>/dev/null | head -c 7)
      for N in $REFS; do
        COMMENT_HIT=$(gh issue view "$N" --json comments --jq ".comments[].body" 2>/dev/null | grep -c "$LATEST_SHA" || true)
        if [ "${COMMENT_HIT:-0}" -eq 0 ]; then
          WARNINGS+=("Seneste main-commit refererer #$N men issuet har ingen kommentar med SHA $LATEST_SHA - husk close-out: gh issue comment $N --body \"...$LATEST_SHA...\"")
        fi
      done
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
