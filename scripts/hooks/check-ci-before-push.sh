#!/bin/bash
# PreToolUse hook (matcher: Bash). Når brugeren forsøger at `git push` og
# seneste push-commit havde rød CI på samme branch → emit warning der nudger
# Claude til at reproducere fejlen lokalt før endnu en gætvis fix.
#
# Bidt 2026-05-17: i18n Fase 3b (#412) endte i 5-runde symptom-patching-loop
# fordi Claude push'ede fixes uden at have kørt Playwright lokalt. Hook'en
# bryder loopen ved 2. push på rød CI.
#
# Warning-mode only: exit altid 0. Fail-safe: hvis gh ikke virker, network
# nede, eller branch ny → silent skip.
#
# Refs: postmortem `.claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md`

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

INPUT=$(cat 2>/dev/null || true)

# Bail-out: kun Bash tool-calls
case "$INPUT" in
  *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) ;;
  *) exit 0 ;;
esac

CMD=$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -c 4000)
[ -z "$CMD" ] && exit 0

# Kun match git push-kommandoer (inklusive force/lease/upstream-varianter)
case "$CMD" in
  *'git push'*|*'git -C '*' push'*) ;;
  *) exit 0 ;;
esac

# Ejer 4/11: `cd <dir> && git push` / `git -C <dir> push` pusher fra et andet worktree
# end sessionens cwd; tjek den branch, der faktisk pushes.
# Codex P2 (#7660): kommandoen afkodes som JSON, og shell-quoting fjernes (lib/push-target-dir.mjs).
# Ejer 8/11: destinations-branchen i en eksplicit refspec (`HEAD:wip/x`) er maalet, ikke den lokale branch.
DEST=$(printf '%s' "$INPUT" | node "$(dirname "$0")/lib/push-target-dir.mjs" --dest 2>/dev/null)
# Ejer 8/11: kun undtaget naar HVERT maal er en backup-branch (wip/*, backup/*): ingen PR, intet merges derfra.
[ "$DEST" = "__ALL_BACKUP__" ] && exit 0
# Intet maal fundet (usaedvanlig kommandoform, node fejlede): tjek den lokale branch som foer.
[ -z "$DEST" ] && DEST="__LOCAL__"
TARGET_DIR=$(printf '%s' "$INPUT" | node "$(dirname "$0")/lib/push-target-dir.mjs" 2>/dev/null)
if [ -n "$TARGET_DIR" ]; then cd "$TARGET_DIR" 2>/dev/null || exit 0; fi

# Eksplicit kvittering: CI_FAIL_ACK="<hvad er koert lokalt>" i kommandoen.
case "$CMD" in *CI_FAIL_ACK=*) exit 0 ;; esac

# Skip hvis ikke i et git-repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Skip hvis gh CLI mangler eller ikke authentikeret
command -v gh >/dev/null 2>&1 || exit 0
gh auth status >/dev/null 2>&1 || exit 0

LOCAL_BRANCH_NAME=$(git branch --show-current 2>/dev/null)

# Ejer 8/11: tjek hvert maal for pushet (Codex P2), ikke kun den lokale branch.
check_branch() {
CURRENT_BRANCH="$1"
[ -z "$CURRENT_BRANCH" ] && return 0

# Skip på main/master — disse skal aldrig blokere
case "$CURRENT_BRANCH" in
  main|master) return 0 ;;
esac

# Tjek seneste CI-run på denne branch. Hvis sidste run var failure/cancelled
# → emit warning. Vi bruger --json conclusion,headSha for at filtrere på
# faktisk afsluttede runs.
# Ejer 4/11: kun CI (ci.yml); review-gate og andre workflows er ikke testfejl.
LATEST=$(gh run list --branch "$CURRENT_BRANCH" --workflow ci.yml --limit 1 --json conclusion,headSha,status 2>/dev/null)
[ -z "$LATEST" ] && return 0

# Parse conclusion uden jq (best-effort substring match)
CONCLUSION=$(printf '%s' "$LATEST" | sed -n 's/.*"conclusion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
STATUS=$(printf '%s' "$LATEST" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
SHA=$(printf '%s' "$LATEST" | sed -n 's/.*"headSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# Kun warn hvis run er afsluttet OG var failure
[ "$STATUS" = "completed" ] || return 0
case "$CONCLUSION" in
  # Ejer 4/11: cancelled = afloest af et nyere push (cancel-in-progress paa PR'er), ikke en fejl.
  failure|timed_out) ;;
  *) return 0 ;;
esac

SHORT_SHA=$(printf '%s' "$SHA" | head -c 7)

# Emit warning
# Ejer 4/11: systemMessage ses kun af ejeren. Pushet afvises nu med en begrundelse, Claude
# ser; efter lokal koersel kvitteres med CI_FAIL_ACK="<hvad er koert>" foran git push.
MSG=$(printf '⚠️  CI-FAIL-LOOP-GUARD: Seneste push (%s) på branch %s havde CI-conclusion=%s. Inden du pusher endnu en fix:\\n  1. Har du kørt den fejlende test LOKALT? Specifikt for Playwright: npx playwright test <spec> --project=desktop-chromium\\n  2. Hvis det er 2+ runder på samme symptom → STOP, find rod-årsag, spørg brugeren før push.\\nSe postmortem: .claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md' "$SHORT_SHA" "$CURRENT_BRANCH" "$CONCLUSION")
# Ejer 8/11: ingen systemMessage; den viste hele teksten i ejerens vindue. Afvisningen naar Claude via begrundelsen.
printf '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s\\nKvittering efter lokal koersel: CI_FAIL_ACK=\\"<hvad er koert>\\" foran git push."}}\n' "$MSG"
exit 0
}

while IFS= read -r TARGET; do
  [ "$TARGET" = "__LOCAL__" ] && TARGET="$LOCAL_BRANCH_NAME"
  check_branch "$TARGET"
done <<EOT
$DEST
EOT

exit 0
