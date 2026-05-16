#!/bin/bash
# PreToolUse hook (matcher: Edit|Write). Blocks edits to archived paths
# listed in scripts/hooks/archived-paths.txt. Exit 2 + stderr = block.
#
# Refs: GitHub issue #77.

set -u

INPUT=$(cat 2>/dev/null || true)

case "$INPUT" in
  *'"tool_name":"Edit"'*|*'"tool_name": "Edit"'*) ;;
  *'"tool_name":"Write"'*|*'"tool_name": "Write"'*) ;;
  *'"tool_name":"NotebookEdit"'*|*'"tool_name": "NotebookEdit"'*) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(printf '%s' "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$FILE_PATH" ] && exit 0

SCRIPT_DIR=$(dirname "$0")
LIST="$SCRIPT_DIR/archived-paths.txt"
[ -f "$LIST" ] || exit 0

# Normalise to forward-slash relative-ish path for matching.
NORMALISED=$(printf '%s' "$FILE_PATH" | tr '\\' '/')

# Strip repo-root prefix if present, so a stored absolute Windows path
# C:/dev/CyclingZone/docs/archive/foo.md matches the glob docs/archive/**.
# Try multiple repo-root forms: git-rev-parse output and `pwd` (Git Bash maps
# C:\ to /c/, so both forms can appear in incoming JSON depending on caller).
REPO_ROOTS=()
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null | tr '\\' '/')
[ -n "$GIT_ROOT" ] && REPO_ROOTS+=("$GIT_ROOT")
PWD_ROOT=$(pwd 2>/dev/null | tr '\\' '/')
[ -n "$PWD_ROOT" ] && REPO_ROOTS+=("$PWD_ROOT")
# Also add the lowercase /c/ form derived from C:/ if applicable.
if [ -n "$GIT_ROOT" ]; then
  ALT=$(printf '%s' "$GIT_ROOT" | sed -E 's|^([A-Za-z]):|/\L\1|')
  [ "$ALT" != "$GIT_ROOT" ] && REPO_ROOTS+=("$ALT")
fi
for root in "${REPO_ROOTS[@]}"; do
  case "$NORMALISED" in
    "$root"/*) NORMALISED=${NORMALISED#"$root"/}; break ;;
  esac
done

# Convert glob to regex. Only ** and * are honored.
glob_to_regex() {
  local glob="$1"
  # Escape regex metas except * and /.
  local escaped
  escaped=$(printf '%s' "$glob" | sed 's/[][().+^${}|]/\\&/g')
  # ** -> .* ; single * -> [^/]*
  escaped=$(printf '%s' "$escaped" | sed -e 's|\*\*|.@@DOUBLESTAR@@|g' -e 's|\*|[^/]*|g' -e 's|@@DOUBLESTAR@@|*|g')
  printf '^%s$' "$escaped"
}

BLOCKED_BY=""
while IFS= read -r raw; do
  # Skip blanks and comments.
  pattern=$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -z "$pattern" ] && continue
  case "$pattern" in \#*) continue ;; esac
  rx=$(glob_to_regex "$pattern")
  if printf '%s' "$NORMALISED" | grep -Eq "$rx"; then
    BLOCKED_BY="$pattern"
    break
  fi
done < "$LIST"

if [ -n "$BLOCKED_BY" ]; then
  echo "BLOCKED: '$FILE_PATH' er arkiveret (matchet af pattern '$BLOCKED_BY' i scripts/hooks/archived-paths.txt). Brug GitHub issues til task-management; arkiverede docs er read-only. Se docs/HOOKS.md (#77)." >&2
  exit 2
fi

exit 0
