#!/bin/bash
# Stop hook: recomputes the "🤖 Aktive sessioner" field in docs/NOW.md when
# this session ends, WITHOUT blindly resetting it to "Ingen aktiv session"
# the way the manual close-out step does. If other Claude Code sessions are
# still alive against this repo, the field is left showing them (self
# removed); only when none remain does it fall back to the reset sentinel.
#
# Shares detection logic with scripts/hooks/set-active-sessions.sh via
# scripts/hooks/lib/active_sessions_engine.py --mode stop. Only ever
# rewrites the field if it currently holds our own auto-marker or a known
# reset sentinel -- curated human/orchestrator prose is left untouched (we
# didn't write it, so it isn't ours to clear).
#
# Fail-safe: exits 0 always.
#
# Refs: #3712, #559, #558.

set -u

REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && exit 0

REMOTE_URL="$(cd "$REPO" && git config --get remote.origin.url 2>/dev/null)"
case "$REMOTE_URL" in
  *CyclingZone*|*cycling-manager*) ;;
  *) exit 0 ;;
esac

MAIN_ROOT="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10); exit}')"
[ -z "$MAIN_ROOT" ] && MAIN_ROOT="$REPO"

PY="$(command -v python3 || command -v python || true)"
[ -z "$PY" ] && exit 0

ENGINE="$REPO/scripts/hooks/lib/active_sessions_engine.py"
[ -f "$ENGINE" ] || ENGINE="$MAIN_ROOT/scripts/hooks/lib/active_sessions_engine.py"
[ -f "$ENGINE" ] || exit 0

INPUT=$(cat 2>/dev/null || true)
printf '%s' "$INPUT" | PYTHONIOENCODING=utf-8 "$PY" "$ENGINE" --mode stop --repo-root "$MAIN_ROOT" 2>/dev/null

exit 0
