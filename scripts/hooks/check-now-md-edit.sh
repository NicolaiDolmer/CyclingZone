#!/bin/bash
# PreToolUse hook (matcher: Edit|Write). Hard-blocks edits to docs/NOW.md
# that would push the file over 30 lines. Exit 2 + stderr = block.
#
# Refs: GitHub issue #76.

set -u

INPUT=$(cat 2>/dev/null || true)

# Only run on Edit / Write tool calls.
case "$INPUT" in
  *'"tool_name":"Edit"'*|*'"tool_name": "Edit"'*) TOOL=Edit ;;
  *'"tool_name":"Write"'*|*'"tool_name": "Write"'*) TOOL=Write ;;
  *) exit 0 ;;
esac

# Extract file_path. Forward and backslashes both tolerated.
FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$FILE_PATH" ] && exit 0

# Normalise to forward slashes for matching.
NORMALISED=$(printf '%s' "$FILE_PATH" | tr '\\' '/')
case "$NORMALISED" in
  */docs/NOW.md|docs/NOW.md) ;;
  *) exit 0 ;;
esac

# Estimate post-edit line count.
RESULTING_LINES=0

if [ "$TOOL" = "Write" ]; then
  # Write replaces the whole file with content. Count newlines in content.
  # We extract content via python for reliable JSON unescape if available;
  # else fall back to grep-counting.
  if command -v python3 >/dev/null 2>&1; then
    RESULTING_LINES=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
data = sys.stdin.read()
try:
  obj = json.loads(data)
except Exception:
  sys.exit(0)
content = obj.get("tool_input", {}).get("content", "")
print(content.count("\n") + (0 if content.endswith("\n") or not content else 1))
' 2>/dev/null)
  fi
elif [ "$TOOL" = "Edit" ]; then
  # Read current file size, then add (new_string newlines - old_string newlines).
  if [ -f "$FILE_PATH" ]; then
    CURRENT=$(wc -l < "$FILE_PATH" 2>/dev/null | tr -d ' ')
  else
    CURRENT=0
  fi
  if command -v python3 >/dev/null 2>&1; then
    DELTA=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
data = sys.stdin.read()
try:
  obj = json.loads(data)
except Exception:
  print(0); sys.exit(0)
inp = obj.get("tool_input", {})
old = inp.get("old_string", "")
new = inp.get("new_string", "")
print(new.count("\n") - old.count("\n"))
' 2>/dev/null)
    RESULTING_LINES=$((CURRENT + ${DELTA:-0}))
  else
    RESULTING_LINES=$CURRENT
  fi
fi

# If we couldn't compute (no python3), don't block - exit 0.
if [ -z "$RESULTING_LINES" ] || [ "$RESULTING_LINES" -le 0 ]; then
  exit 0
fi

if [ "$RESULTING_LINES" -gt 30 ]; then
  echo "BLOCKED: docs/NOW.md vil blive ${RESULTING_LINES} linjer (maks 30 per CLAUDE.md). Arkivér ældre indhold til docs/archive/NOW-YYYY-MM-DD.md først, eller slet linjer i samme edit. Se docs/HOOKS.md (#76)." >&2
  exit 2
fi

exit 0
