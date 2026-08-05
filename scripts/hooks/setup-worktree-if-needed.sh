#!/bin/bash
# SessionStart + PreToolUse(Bash) hook. Auto-setup af et worktree der mangler
# node_modules eller .env. PreToolUse-varianten dækker subagent-worktrees oprettet
# MIDT i en session (Agent-tool isolation:worktree), som aldrig rammer SessionStart —
# første Bash-kald i worktree'et udbedrer hullet (11/7: #2311/#2328-agenterne
# snublede begge over manglende .env).
#
# Harness-oprettede worktrees (.claude/worktrees/<navn>) går uden om new-worktree.ps1
# og mangler derfor node_modules + .env-hardlinks → backend `node --test`
# fejler lokalt med "supabaseUrl is required" og frontend kræver manuel npm ci.
# Denne hook detekterer hullet og delegerer til scripts/setup-worktree.ps1 (junction
# til delt cache + OneDrive-.env-hardlinks; LÆSER aldrig secret-værdier).
#
# #3367: guarden tjekker SUNDHED, ikke blot eksistens. En junction til et tømt mål
# — eller en halvfærdig install — består `[ -e ]` og fejler så først som
# ERR_MODULE_NOT_FOUND midt i en test-kørsel. npm efterlader altid
# `node_modules/.package-lock.json` efter et fuldført install; den er markøren.
#
# Idempotent + hurtig: i main-repoet er .git en mappe (ikke en fil) → øjeblikkelig
# no-op. Kun et LINKED worktree med noget usundt spawner pwsh.
# Fail-safe: exit 0 uanset hvad, så session-start aldrig blokeres.
#
# Refs: issue #994, #3367.

set -u

# Kun i et linked worktree er .git en FIL ("gitdir: ..."). I main-repoet er .git en mappe.
[ -f .git ] || exit 0

# Billig guard: skip hvis alt allerede er sundt (undgå pwsh-spawn uden grund).
need=0
for d in node_modules backend/node_modules frontend/node_modules; do
  [ -f "$d/.package-lock.json" ] || { need=1; break; }
done
if [ "$need" -eq 0 ]; then
  for f in backend/.env frontend/.env; do
    [ -e "$f" ] || { need=1; break; }
  done
fi
[ "$need" -eq 0 ] && exit 0

# Throttle: er et setup-forsøg allerede slået fejl i dette worktree, så lad være
# at spawne pwsh (og evt. en flere-minutters npm ci) på HVERT efterfølgende
# Bash-kald. Agenten har fået beskeden én gang; den gentages kort i stedet.
stamp=".git-worktree-setup-failed"
if [ -f "$stamp" ]; then
  echo "[worktree-setup] Tidligere setup-forsøg fejlede i dette worktree." >&2
  echo "                 Kør: pwsh -File scripts/setup-worktree.ps1 -Rebuild" >&2
  echo "                 (fjern $stamp for at lade hooken prøve igen)" >&2
  exit 0
fi

# Windows-only setup (junctions + hardlinks). Spring stille over hvis pwsh mangler.
command -v pwsh >/dev/null 2>&1 || exit 0

if pwsh -NoProfile -File scripts/setup-worktree.ps1 -Quiet; then
  rm -f "$stamp"
else
  : > "$stamp"
  echo "[worktree-setup] setup-worktree.ps1 kunne ikke gøre worktreet klar." >&2
  echo "                 Kør: pwsh -File scripts/setup-worktree.ps1 -Rebuild" >&2
fi
exit 0
