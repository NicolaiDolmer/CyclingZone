#!/bin/bash
# Stop-hook: advarer (ikke blokerende) hvis der er uncommitted eller unpushed work
# ved session-end. Hjaelper med cross-PC continuity.
#
# Tjekker:
#   1. Uncommitted changes (git status --porcelain)
#   2. Commits ahead af upstream (git log @{u}..HEAD)
#   3. Stash-entries (git stash list)
#
# Output: systemMessage til Claude Code via JSON paa stdout. Exit altid 0 (non-blocking).

# Vaer tolerant overfor at vaere udenfor et git-repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

issues=()

# 1. Uncommitted
porcelain=$(git status --porcelain 2>/dev/null)
if [ -n "$porcelain" ]; then
  count=$(echo "$porcelain" | wc -l)
  issues+=("$count uncommitted aendring(er)")
fi

# 2. Ahead af upstream
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -n "$upstream" ]; then
  ahead=$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo "0")
  if [ "$ahead" -gt 0 ]; then
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    issues+=("$branch er $ahead commit(s) ahead af $upstream (ikke pushet)")
  fi
fi

# 3. Stash
stash_count=$(git stash list 2>/dev/null | wc -l)
if [ "$stash_count" -gt 0 ]; then
  issues+=("$stash_count stash-entry/-ies eksisterer (ikke synced)")
fi

if [ ${#issues[@]} -eq 0 ]; then
  exit 0
fi

# Byg besked
msg="ADVARSEL — cross-PC sync ikke i orden:"
for i in "${issues[@]}"; do
  msg="$msg | $i"
done
msg="$msg | Anden PC kan ikke fortsaette uden disse aendringer."

# Escape til JSON (escape backslash og quote)
msg_json=$(echo "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
echo "{\"systemMessage\": \"$msg_json\"}"
exit 0
