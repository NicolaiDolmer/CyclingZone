#!/bin/bash
# Test suite for project-level PreToolUse hooks (#73, #76, #77).
# Run from repo root: bash scripts/hooks/__tests__/test-hooks.sh
#
# Each case feeds a synthetic tool-call JSON on stdin and asserts on exit
# code + output. No real edits happen.

set -u
FAIL=0
PASS=0

run() {
  local name=$1
  local hook=$2
  local input=$3
  local want_exit=$4
  local want_stdout_substr=${5:-}
  local want_stderr_substr=${6:-}

  out=$(printf '%s' "$input" | bash "$hook" 2>/tmp/.hook-stderr)
  code=$?
  err=$(cat /tmp/.hook-stderr 2>/dev/null || echo "")

  ok=1
  if [ "$code" != "$want_exit" ]; then ok=0; fi
  if [ -n "$want_stdout_substr" ] && ! printf '%s' "$out" | grep -qF "$want_stdout_substr"; then ok=0; fi
  if [ -n "$want_stderr_substr" ] && ! printf '%s' "$err" | grep -qF "$want_stderr_substr"; then ok=0; fi

  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $name (exit=$code, want=$want_exit)"
    [ -n "$out" ] && echo "  stdout: $out"
    [ -n "$err" ] && echo "  stderr: $err"
  fi
}

# ---- lint-gh-issue.sh (#73) ----

run "lint-gh-issue: non-Bash tool ignored" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Edit","tool_input":{"file_path":"foo.md"}}' \
  0 "" ""

run "lint-gh-issue: gh issue view without --json warns" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"gh issue view 154"}}' \
  0 "systemMessage" ""

run "lint-gh-issue: gh issue view with --json is silent" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"gh issue view 154 --json title,body"}}' \
  0 "" ""

run "lint-gh-issue: gh issue list without filter warns" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"gh issue list"}}' \
  0 "kan hente hele backloggen" ""

run "lint-gh-issue: gh issue list with --label is silent" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"gh issue list --label claude:todo --limit 10"}}' \
  0 "" ""

run "lint-gh-issue: --comments without --jq warns" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"gh issue view 154 --comments"}}' \
  0 "kommentar-traad" ""

run "lint-gh-issue: non-gh Bash ignored" \
  scripts/hooks/lint-gh-issue.sh \
  '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' \
  0 "" ""

# ---- check-now-md-edit.sh (#76) ----

# Build a fake 31-line content for Write.
LONG_CONTENT=""
for i in $(seq 1 31); do LONG_CONTENT="${LONG_CONTENT}line${i}\\n"; done

run "check-now-md-edit: non-NOW.md path ignored" \
  scripts/hooks/check-now-md-edit.sh \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"foo/bar.md\",\"content\":\"x\"}}" \
  0 "" ""

run "check-now-md-edit: Write 31 lines to NOW.md blocks" \
  scripts/hooks/check-now-md-edit.sh \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"docs/NOW.md\",\"content\":\"${LONG_CONTENT}\"}}" \
  2 "" "BLOCKED"

run "check-now-md-edit: Write 5 lines to NOW.md allowed" \
  scripts/hooks/check-now-md-edit.sh \
  '{"tool_name":"Write","tool_input":{"file_path":"docs/NOW.md","content":"a\nb\nc\nd\ne\n"}}' \
  0 "" ""

# ---- block-archived-edit.sh (#77) ----

run "block-archived: docs/archive/foo.md blocked" \
  scripts/hooks/block-archived-edit.sh \
  '{"tool_name":"Write","tool_input":{"file_path":"docs/archive/NOW-2026-01-01.md","content":"x"}}' \
  2 "" "BLOCKED"

run "block-archived: docs/NOW.md allowed" \
  scripts/hooks/block-archived-edit.sh \
  '{"tool_name":"Write","tool_input":{"file_path":"docs/NOW.md","content":"x"}}' \
  0 "" ""

run "block-archived: non-Edit/Write ignored" \
  scripts/hooks/block-archived-edit.sh \
  '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}' \
  0 "" ""

run "block-archived: absolute path under docs/archive blocked" \
  scripts/hooks/block-archived-edit.sh \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$(pwd)/docs/archive/foo.md\",\"old_string\":\"a\",\"new_string\":\"b\"}}" \
  2 "" "BLOCKED"

# ---- ensure-scheduled-tasks.sh (auto-install on new PC) ----

SCHED_DIR="$HOME/.claude/scheduled-tasks/weekly-memory-audit"

# Case A: existing task → silent.
if [ -f "$SCHED_DIR/SKILL.md" ]; then
  out=$(bash scripts/hooks/ensure-scheduled-tasks.sh </dev/null)
  if [ -z "$out" ]; then
    PASS=$((PASS+1)); echo "PASS  ensure-scheduled-tasks: existing task silent"
  else
    FAIL=$((FAIL+1)); echo "FAIL  ensure-scheduled-tasks: should be silent, got: $out"
  fi
fi

# Case B: simulate missing.
if [ -f "$SCHED_DIR/SKILL.md" ]; then
  mv "$SCHED_DIR/SKILL.md" "$SCHED_DIR/SKILL.md.testbak"
  out=$(bash scripts/hooks/ensure-scheduled-tasks.sh </dev/null)
  mv "$SCHED_DIR/SKILL.md.testbak" "$SCHED_DIR/SKILL.md"
  if printf '%s' "$out" | grep -q "weekly-memory-audit"; then
    PASS=$((PASS+1)); echo "PASS  ensure-scheduled-tasks: missing task emits systemMessage"
  else
    FAIL=$((FAIL+1)); echo "FAIL  ensure-scheduled-tasks: missing task did not emit task id"
  fi
fi

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ] && exit 0 || exit 1
