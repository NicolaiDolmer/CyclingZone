#!/usr/bin/env bash
# PreToolUse hook: block any Bash/PowerShell command that targets claude.exe
# processes for termination.
#
# Why: Claude Code's harness spawns child claude.exe processes (MCP servers,
# subagents). Killing them via Stop-Process / taskkill / pkill / killall
# crashes the live session. This happened on 2026-05-04 — the agent
# misidentified its own process tree as "zombies" and killed itself.
#
# Reads PreToolUse JSON from stdin. Exits 2 (with stderr message) to block.
# Exit 0 otherwise. Fails OPEN on parse errors so an unrelated bug here
# never breaks unrelated tool calls.

set -u

# Use python for JSON parsing — it's available on the user's Windows machines
# (3.14+) and handles escaped quotes correctly. jq is NOT installed by default
# on Git Bash for Windows.
cmd="$(python -c 'import sys, json
try:
  d = json.load(sys.stdin)
  print(d.get("tool_input", {}).get("command", ""))
except Exception:
  pass' 2>/dev/null || true)"

if [ -z "$cmd" ]; then
  exit 0
fi

lower="$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]')"

# Block when BOTH a kill-verb AND "claude" appear anywhere in the command.
# Deliberately broad — a false positive (e.g., `echo claude && taskkill other`)
# is acceptable because the cost of a real kill is a session crash, while the
# user can always rerun a benign command from a terminal outside Claude Code.
#
# Kill verbs cover: PowerShell (Stop-Process), Windows cmd (taskkill),
# Unix-style (pkill, killall). We do NOT block raw `kill <pid>` because the
# PID is opaque — the agent must use the explicit verbs above to be caught.
reject=0
if printf '%s' "$lower" | grep -qE '(stop-process|taskkill|pkill|killall)' && \
   printf '%s' "$lower" | grep -q 'claude'; then
  reject=1
fi

if [ "$reject" = 1 ]; then
  cat >&2 <<'EOF'
BLOCKED by scripts/hooks/protect-claude-process.sh

This command would terminate a claude.exe process. The Claude Code harness
spawns child claude.exe processes (MCP servers, subagents). Killing them
crashes the live session — this happened on 2026-05-04 and lost session state.

If you genuinely need to clean up zombie claude processes, do it from a
terminal OUTSIDE Claude Code (close all Claude windows first, then run
the cleanup from a fresh shell or Task Manager).
EOF
  exit 2
fi

exit 0
