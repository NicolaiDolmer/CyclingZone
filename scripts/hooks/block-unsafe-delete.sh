#!/bin/bash
# PreToolUse hook (matcher: Bash|PowerShell). Blokerer sletning af worktrees og delte mapper
# uden om scripts/remove-worktree.ps1 / prune-merged-worktrees.ps1 (#7837).
# Logikken og testene ligger i scripts/unsafe-delete-guard.mjs(.test.mjs).
# Haendelse 7/11 (tredje gang efter 15/10 og 1/11): raa `git worktree remove --force` i et
# ad hoc-script fulgte junctions og slettede filer i OneDrive og alle node_modules-caches.
# Exit 2 + stderr = bloker. Fail-open hvis node mangler eller noget uventet fejler.

set -u
INPUT=$(cat 2>/dev/null || true)

# Billig forhaandsfiltrering: kun kommandoer der kan slette eller koere et script.
case "$INPUT" in
  *worktree*|*rm\ *|*Remove-Item*|*rmdir*|*rd\ *|*rimraf*|*node\ *|*pwsh*|*powershell*|*bash\ *|*python*|*tsx\ *) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$ROOT/scripts/unsafe-delete-guard.mjs" ] || exit 0
printf '%s' "$INPUT" | node "$ROOT/scripts/unsafe-delete-guard.mjs" hook
exit $?
