#!/bin/bash
# PreToolUse hook (matcher: Bash). Scans `gh issue ...` invocations for
# patterns that pull verbose output into agent context. Warning-mode only:
# always exit 0; emit a systemMessage when suspicious patterns are detected.
#
# Refs: GitHub issue #73.

set -u

# --- #684 TRACE (cross-PC hook-firing investigation) ---
{
  mkdir -p "$HOME/.claude" 2>/dev/null
  printf '%s hook=%s pid=%s host=%s cwd=%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    "$(basename "$0")" \
    "$$" \
    "${COMPUTERNAME:-${HOSTNAME:-unknown}}" \
    "$(pwd 2>/dev/null)" \
    >> "$HOME/.claude/hook-trace.log" 2>/dev/null
} 2>/dev/null || true
# --- /#684 TRACE ---

# Hook input is a JSON object on stdin. We parse it without jq to avoid
# adding a dependency just for one hook.
INPUT=$(cat 2>/dev/null || true)

# Quick bail-out if not a Bash tool call.
case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *) exit 0 ;;
esac

# Extract command field. Tolerant of escape sequences; we only need a
# best-effort substring.
CMD=$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -c 4000)
[ -z "$CMD" ] && exit 0

# Only flag gh issue ... commands.
case "$CMD" in
  *'gh issue '*) ;;
  *) exit 0 ;;
esac

WARNINGS=()

# `gh issue view N` without --json
if echo "$CMD" | grep -Eq 'gh issue view [^|]*'; then
  if ! echo "$CMD" | grep -Eq -- '--json'; then
    WARNINGS+=("gh issue view uden --json giver verbose markdown - brug fx 'gh issue view N --json title,body,labels,state'")
  fi
fi

# `gh issue list` without --label and without --limit
if echo "$CMD" | grep -Eq 'gh issue list'; then
  if ! echo "$CMD" | grep -Eq -- '--label' && ! echo "$CMD" | grep -Eq -- '--limit'; then
    WARNINGS+=("gh issue list uden --label eller --limit kan hente hele backloggen - tilfoej fx '--label claude:todo --limit 10'")
  fi
fi

# `gh issue view N --comments` without --jq slice
if echo "$CMD" | grep -Eq -- '--comments'; then
  if ! echo "$CMD" | grep -Eq -- '--jq'; then
    WARNINGS+=("gh issue --comments uden --jq kan hente hele kommentar-traad - brug fx '--jq \".comments[-3:]\"' for kun seneste 3")
  fi
fi

if [ "${#WARNINGS[@]}" -eq 0 ]; then
  exit 0
fi

MSG="gh-lint warning (token-economy):"
for w in "${WARNINGS[@]}"; do
  MSG="${MSG}\\n- ${w}"
done

# Emit systemMessage but approve the call (exit 0).
printf '{"systemMessage": "%s"}\n' "$MSG"
exit 0
