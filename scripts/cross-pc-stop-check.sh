#!/bin/bash
# Stop-hook: advarer (ikke blokerende) hvis der er uncommitted eller unpushed work
# ved session-end. Hjaelper med cross-PC continuity.
#
# Tjekker:
#   1. Uncommitted changes (git status --porcelain)
#   2. Commits ahead af upstream (git log @{u}..HEAD)
#   3. Stash-entries (git stash list)
#   4. PUSH: trigger cross-PC transcript sync til OneDrive (background, non-blocking)
#
# Output: systemMessage til Claude Code via JSON paa stdout. Exit altid 0 (non-blocking).

# Vaer tolerant overfor at vaere udenfor et git-repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Trigger transcript-sync i background (#391 Phase 2). Log: ~/.claude/cross-pc-sync.log
# Stiller hverken stdout-output op eller blokerer Stop-hook.
if [ -x "$(git rev-parse --show-toplevel)/scripts/cross-pc-sync.sh" ]; then
  nohup bash "$(git rev-parse --show-toplevel)/scripts/cross-pc-sync.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
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

# 4. Lokal-only AI-state i .codex.local/ (whitelist match — alt andet er lokal-only persistent)
# Whitelist: SESSION_CONTEXT.md, SUPABASE_CONTEXT.md, supabase-readonly.env, preflight-state.json
# + ephemeral patterns: commit-msg*.txt, commit-N.txt, commitmsg-*.txt, pr*-body.md, pr-body-*.md
if [ -d ".codex.local" ]; then
  local_only=$(find .codex.local -type f \
    ! -name "SESSION_CONTEXT.md" \
    ! -name "SUPABASE_CONTEXT.md" \
    ! -name "supabase-readonly.env" \
    ! -name "preflight-state.json" \
    ! -name "commit-msg*.txt" \
    ! -name "commit-*.txt" \
    ! -name "commitmsg-*.txt" \
    ! -name "pr*-body.md" \
    ! -name "pr-body-*.md" \
    2>/dev/null)
  if [ -n "$local_only" ]; then
    count=$(echo "$local_only" | wc -l)
    issues+=("$count fil(er) i .codex.local/ udenfor whitelist (kør 'pwsh -File scripts/cross-pc-forensic-audit.ps1' for detaljer)")
  fi
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
