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
  *'git push'*) ;;
  *) exit 0 ;;
esac

# Skip hvis ikke i et git-repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Skip hvis gh CLI mangler eller ikke authentikeret
command -v gh >/dev/null 2>&1 || exit 0
gh auth status >/dev/null 2>&1 || exit 0

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
[ -z "$CURRENT_BRANCH" ] && exit 0

# Skip på main/master — disse skal aldrig blokere
case "$CURRENT_BRANCH" in
  main|master) exit 0 ;;
esac

# Tjek seneste CI-run på denne branch. Hvis sidste run var failure/cancelled
# → emit warning. Vi bruger --json conclusion,headSha for at filtrere på
# faktisk afsluttede runs.
LATEST=$(gh run list --branch "$CURRENT_BRANCH" --limit 1 --json conclusion,headSha,status 2>/dev/null)
[ -z "$LATEST" ] && exit 0

# Parse conclusion uden jq (best-effort substring match)
CONCLUSION=$(printf '%s' "$LATEST" | sed -n 's/.*"conclusion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
STATUS=$(printf '%s' "$LATEST" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
SHA=$(printf '%s' "$LATEST" | sed -n 's/.*"headSha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

# Kun warn hvis run er afsluttet OG var failure
[ "$STATUS" = "completed" ] || exit 0
case "$CONCLUSION" in
  failure|cancelled|timed_out) ;;
  *) exit 0 ;;
esac

SHORT_SHA=$(printf '%s' "$SHA" | head -c 7)

# Emit warning
printf '{"systemMessage": "⚠️  CI-FAIL-LOOP-GUARD: Seneste push (%s) på branch %s havde CI-conclusion=%s. Inden du pusher endnu en fix:\\n  1. Har du kørt den fejlende test LOKALT? Specifikt for Playwright: npx playwright test <spec> --project=desktop-chromium\\n  2. Hvis det er 2+ runder på samme symptom → STOP, find rod-årsag, spørg brugeren før push.\\nSe postmortem: .claude/learnings/2026-05-17-symptom-patching-loop-vs-root-cause.md"}\n' "$SHORT_SHA" "$CURRENT_BRANCH" "$CONCLUSION"

exit 0
