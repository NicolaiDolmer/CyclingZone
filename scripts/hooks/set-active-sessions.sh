#!/bin/bash
# SessionStart hook: auto-sets the "🤖 Aktive sessioner" (fka "Working
# agent") field in docs/NOW.md and fires the #559 multi-AI gate when other
# Claude Code sessions already appear to be working on this repo.
#
# Why: CLAUDE.md's close-out step RESETS this field, but nothing ever SET
# it at session start -- so a running session looked identical to no
# session at all for its entire lifetime, and the "STOP + ask the user"
# gate in CLAUDE.md Start step 1 could never fire. Hit 3x (28/7 lost work,
# 14/8 + 15/8 near-misses) -- see #3712.
#
# What it does: delegates to scripts/hooks/lib/active_sessions_engine.py,
# which reads the local ~/.claude/sessions/*.json registry (one file per
# top-level `claude` process, written by the harness) to see which OTHER
# sessions are alive and associated with this repo (main checkout or a
# `<repo>-worktrees/*` sibling). It ALWAYS emits the gate warning when it
# finds others (that is the actual fix), and it updates the NOW.md field
# ONLY when doing so is non-destructive (field currently empty, a known
# reset sentinel, or our own previous auto-marker) -- curated
# human/orchestrator prose in that field is left untouched.
#
# Same-machine, best-effort signal only -- NOT the full cross-session
# picture `mcp__ccd_session_mgmt__list_sessions` could give (that tool only
# exists at the agent/LLM layer; a hook subprocess has no MCP access).
#
# Fail-safe: exits 0 always. Missing python -> silently does nothing.
#
# Refs: #3712, #559, #558.

set -u

REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO" ] && exit 0

# Guard to CyclingZone/cycling-manager only (same pattern as
# scripts/hooks/cycling-manager-cleanup.sh) -- never touch an unrelated repo.
REMOTE_URL="$(cd "$REPO" && git config --get remote.origin.url 2>/dev/null)"
case "$REMOTE_URL" in
  *CyclingZone*|*cycling-manager*) ;;
  *) exit 0 ;;
esac

# The main worktree is always the first entry of `git worktree list`,
# regardless of which worktree this hook is actually running in.
MAIN_ROOT="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10); exit}')"
[ -z "$MAIN_ROOT" ] && MAIN_ROOT="$REPO"

PY="$(command -v python3 || command -v python || true)"
[ -z "$PY" ] && exit 0

ENGINE="$REPO/scripts/hooks/lib/active_sessions_engine.py"
[ -f "$ENGINE" ] || ENGINE="$MAIN_ROOT/scripts/hooks/lib/active_sessions_engine.py"
[ -f "$ENGINE" ] || exit 0

INPUT=$(cat 2>/dev/null || true)
printf '%s' "$INPUT" | PYTHONIOENCODING=utf-8 "$PY" "$ENGINE" --mode start --repo-root "$MAIN_ROOT" 2>/dev/null

exit 0
