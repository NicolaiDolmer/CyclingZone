#!/bin/bash
# SessionStart + PreToolUse(Bash) hook. Auto-setup af et worktree der mangler
# node_modules eller .env. PreToolUse-varianten dækker subagent-worktrees oprettet
# MIDT i en session (Agent-tool isolation:worktree), som aldrig rammer SessionStart —
# første Bash-kald i worktree'et udbedrer hullet (11/7: #2311/#2328-agenterne
# snublede begge over manglende .env).
#
# Harness-oprettede worktrees (.claude/worktrees/<navn>) går uden om new-worktree.ps1
# og mangler derfor node_modules-junctions + .env-hardlinks → backend `node --test`
# fejler lokalt med "supabaseUrl is required" og frontend kræver manuel npm ci.
# Denne hook detekterer hullet og delegerer til scripts/setup-worktree.ps1 (junctions
# + OneDrive-.env-hardlinks; LÆSER aldrig secret-værdier).
#
# Idempotent + hurtig: i main-repoet er .git en mappe (ikke en fil) → øjeblikkelig
# no-op. Kun et LINKED worktree med noget manglende spawner pwsh.
# Fail-safe: exit 0 uanset hvad, så session-start aldrig blokeres.
#
# Refs: issue #994.

set -u

# Kun i et linked worktree er .git en FIL ("gitdir: ..."). I main-repoet er .git en mappe.
[ -f .git ] || exit 0

# Billig guard: skip hvis alt allerede er på plads (undgå pwsh-spawn uden grund).
need=0
for d in backend/node_modules frontend/node_modules backend/.env frontend/.env; do
  [ -e "$d" ] || { need=1; break; }
done
[ "$need" -eq 0 ] && exit 0

# Windows-only setup (junctions + hardlinks). Spring stille over hvis pwsh mangler.
command -v pwsh >/dev/null 2>&1 || exit 0

pwsh -NoProfile -File scripts/setup-worktree.ps1 -Quiet || true
exit 0
