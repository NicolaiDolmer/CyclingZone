#!/bin/bash
# Stop-hook: close-out-reminder ved session-stop.
#  1) Advarer hvis NOW.md er over budget (token primaer ~1.200, linjer sekundaer <=30)
#  2) Advarer hvis CLAUDE.md eller MEMORY.md over budget
#  3) Advarer hvis main har commits nyere end NOW.md (close-out glemt)
#  4) Reminder hvis seneste main-commit har "Refs #N" men issue ikke har comment fra denne session
#
# Refs: GitHub issues #75, #76, #750, #1097.
#
# EN GANG PR. SESSION (ejer 15/10): Stop fyrer efter HVER tur, ikke kun ved
# session-slut, og systemMessage vises for ejeren. Uden dedupe blev samme
# paamindelse gentaget efter hvert svar ("spam"). Hver advarsel har derfor en
# stabil noegle; en noegle der allerede er vist i denne session (session_id fra
# hook-input paa stdin) springes over. Ny SHA/nyt issue = ny noegle = vises igen.
# Uden session_id (fx tests med </dev/null) opfoerer hooken sig som foer.

WARNINGS=()
KEYS=()

SESSION_ID=""
if [ ! -t 0 ]; then
  HOOK_INPUT=$(cat 2>/dev/null || true)
  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | grep -Eo '"session_id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/' | tr -cd 'A-Za-z0-9_-')
fi
SEEN_FILE=""
if [ -n "$SESSION_ID" ]; then
  mkdir -p .claude/run 2>/dev/null || true
  SEEN_FILE=".claude/run/closeout-reminder-$SESSION_ID.seen"
  # Gamle sessioners noegler (>7 dage) ryddes, saa mappen ikke vokser.
  find .claude/run -maxdepth 1 -name "closeout-reminder-*.seen" -mtime +7 -delete 2>/dev/null || true
  touch "$SEEN_FILE" 2>/dev/null || SEEN_FILE=""
fi
# seen KEY -> 0 hvis noeglen allerede er vist i denne session.
seen() { [ -n "$SEEN_FILE" ] && grep -qxF "$1" "$SEEN_FILE" 2>/dev/null; }
# add KEY TEXT -> tilfoej advarslen hvis noeglen ikke er vist endnu.
add() { if ! seen "$1"; then WARNINGS+=("$2"); KEYS+=("$1"); fi; }

# (1) NOW.md budget-warning (token primaer jf. #1275; linjer sekundaer).
# Auto-archive til docs/archive/NOW-*.md er FJERNET per #750 (ejer-beslutning):
# historik bevares i git-log + issue-traade, og docs/archive/** er #684-deny-
# beskyttet. Hooken muterer ALDRIG NOW.md — den minder kun om direkte trim.
# Token-estimat = bytes/4 (let overestimat ved emoji; fint til en warn-gate).
if [ -f "docs/NOW.md" ]; then
  L=$(wc -l < "docs/NOW.md")
  BYTES=$(wc -c < "docs/NOW.md")
  TOK=$((BYTES / 4))
  if [ "$TOK" -gt 1200 ] || [ "$L" -gt 30 ]; then
    add "now-budget" "NOW.md er ~$TOK tok / $L linjer (budget ~1.200 tok primaer, <=30 linjer sekundaer, jf. CLAUDE.md close-out trin 2) - trim gamle close-out-blokke DIREKTE (historik bevares i git-log + issue-traade). Opret IKKE docs/archive/NOW-*.md (#750)."
  fi
fi

# (1b) CLAUDE.md storrelse (HOT auto-load)
if [ -f "CLAUDE.md" ]; then
  L=$(wc -l < "CLAUDE.md")
  if [ "$L" -gt 80 ]; then
    add "claude-md-size" "CLAUDE.md er $L linjer (maal: <60, fail >80) - flyt reference-indhold til docs/META_DOCS_INDEX.md"
  fi
fi

# (1c) MEMORY.md HOT-tier storrelse
MEM_PATH="$HOME/.claude/projects/C--dev-CyclingZone/memory/MEMORY.md"
if [ -f "$MEM_PATH" ]; then
  L=$(wc -l < "$MEM_PATH")
  if [ "$L" -gt 50 ]; then
    add "memory-md-size" "MEMORY.md HOT er $L linjer (maal: <40, fail >50) - demotér entries til MEMORY_REFERENCE.md per docs/AI_OPS_TOKEN_BUDGET.md"
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
      LATEST_MAIN_SHA=$(git log origin/main -1 --format=%h 2>/dev/null)
      add "main-closeout:$LATEST_MAIN_SHA" "main blev opdateret \\\"$LATEST_MAIN_MSG\\\" - har du koert close-out? (NOW.md entry, FEATURE_STATUS.md hvis kontrakt-aendring, learnings hvis bugfix, issue-kommentar m. commit-SHA)"
    fi

    # (3) Refs #N reminder: seneste commit på main har Refs #N men issue mangler en
    # session-comment med matching SHA (heuristik for "AI lukkede ikke loopen").
    if [ "$MAIN_AGE" -lt 1800 ] && command -v gh >/dev/null 2>&1; then
      LATEST_MSG=$(git log origin/main -1 --format=%B 2>/dev/null | head -c 2000)
      REFS=$(printf '%s' "$LATEST_MSG" | grep -Eoi 'Refs #[0-9]+' | grep -Eo '[0-9]+' | sort -u)
      LATEST_SHA=$(git log origin/main -1 --format=%H 2>/dev/null | head -c 7)
      for N in $REFS; do
        # Allerede vist for denne SHA i sessionen: spring ogsaa gh-kaldet over.
        if seen "refs:$N:$LATEST_SHA"; then continue; fi
        COMMENT_HIT=$(gh issue view "$N" --json comments --jq ".comments[].body" 2>/dev/null | grep -c "$LATEST_SHA" || true)
        if [ "${COMMENT_HIT:-0}" -eq 0 ]; then
          add "refs:$N:$LATEST_SHA" "Seneste main-commit refererer #$N men issuet har ingen kommentar med SHA $LATEST_SHA - husk close-out: gh issue comment $N --body \"...$LATEST_SHA...\""
        fi
      done
    fi
  fi
fi

# Output samlet warning
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  if [ -n "$SEEN_FILE" ]; then printf '%s
' "${KEYS[@]}" >> "$SEEN_FILE" 2>/dev/null || true; fi
  # Warning text can contain quotes/backslashes (e.g. gh --body "...").
  # Serialize it rather than interpolating it into JSON; policy stays advisory.
  printf '%s\0' "${WARNINGS[@]}" | node -e '
    const warnings = require("fs").readFileSync(0, "utf8").split("\0").filter(Boolean);
    console.log(JSON.stringify({systemMessage: "CLOSE-OUT REMINDER:\n" + warnings.map(w => "- " + w).join("\n")}));
  '
fi
