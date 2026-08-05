#!/usr/bin/env bash
# Test suite for PreToolUse block-dangerous-secret-commands.sh hook (#634 AC2,
# udvidet #3342 AC "test der bekræfter at hooken fanger den utrygge form").
#
# Run from repo root: bash scripts/test-block-dangerous-secret-commands.sh
#
# Hver case bygger et realistisk PreToolUse tool_input-JSON og pipe'r det til
# .claude/hooks/block-dangerous-secret-commands.sh via stdin (samme protokol
# som Claude Code selv bruger). Verificerer exit code + at stderr indeholder
# det forventede pattern-navn.
#
# Følger mønstret fra scripts/test-sanitize-secrets.sh (samme `run()`-stil),
# tilpasset PreToolUse's JSON tool_input frem for rå PostToolUse tool-output.
#
# Refs: #634, #3342.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$REPO_ROOT/.claude/hooks/block-dangerous-secret-commands.sh"

if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook ikke fundet: $HOOK"
  exit 1
fi

PASS=0
FAIL=0
STDERR_TMP="$(mktemp 2>/dev/null || echo /tmp/.block-dangerous-test-stderr)"

# run NAME TOOL_NAME_JSON WANT_EXIT WANT_STDERR_SUBSTRING
run() {
  local name="$1" payload="$2" want_exit="$3" want_type="$4"
  out=$(printf '%s' "$payload" | bash "$HOOK" 2>"$STDERR_TMP")
  code=$?
  err=$(cat "$STDERR_TMP" 2>/dev/null || echo "")

  ok=1
  if [ "$code" != "$want_exit" ]; then ok=0; fi
  if [ -n "$want_type" ] && ! printf '%s' "$err" | grep -qF "$want_type"; then ok=0; fi

  if [ "$ok" = "1" ]; then
    PASS=$((PASS+1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL+1))
    echo "FAIL  $name (exit=$code want=$want_exit)"
    [ -n "$err" ] && echo "  stderr head: $(printf '%s' "$err" | head -c 300)"
  fi
}

# Helper: bygger et Bash-tool PreToolUse-payload for en given command-streng.
bash_cmd_payload() {
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"
}

# Helper: bygger et Read-tool PreToolUse-payload for en given fil-sti.
read_payload() {
  printf '{"tool_name":"Read","tool_input":{"file_path":"%s"}}' "$1"
}

# ===== #3342: get-test-token.mjs — nye vektor-tests =====

run "get-test-token.mjs --print blocks" \
  "$(bash_cmd_payload 'node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --print')" \
  2 "get-test-token.mjs --print"

run "get-test-token.mjs --print --json blocks" \
  "$(bash_cmd_payload 'node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --json --print')" \
  2 "get-test-token.mjs --print"

run "get-test-token.mjs safe default (no --print) NOT blocked" \
  "$(bash_cmd_payload 'node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev')" \
  0 ""

run "get-test-token.mjs --out=<path> (safe explicit output) NOT blocked" \
  "$(bash_cmd_payload 'node scripts/get-test-token.mjs --email=test-a@cyclingzone.dev --out=.codex.local/my-token.json')" \
  0 ""

run "cat on get-test-token.mjs output file blocks" \
  "$(bash_cmd_payload 'cat .codex.local/test-token.json')" \
  2 "get-test-token.mjs-output"

run "Get-Content on get-test-token.mjs output file blocks" \
  "$(bash_cmd_payload 'Get-Content .codex.local/test-token.json')" \
  2 "get-test-token.mjs-output"

run "Read tool on get-test-token.mjs default output file blocks (Lag A)" \
  "$(read_payload '.codex.local/test-token.json')" \
  2 "Read/Grep mod secret-fil"

run "Read tool on custom-named test-token output file blocks (Lag A)" \
  "$(read_payload '.codex.local/test-token-custom.json')" \
  2 "Read/Grep mod secret-fil"

# KONTROL: Read paa en anden, ubeslaegtet .codex.local-fil skal IKKE blokeres —
# beskytter mod for-bred whitelist-effekt.
run "Read tool on unrelated .codex.local file NOT blocked (control)" \
  "$(read_payload '.codex.local/SESSION_CONTEXT.md')" \
  0 ""

# ===== Regression: eksisterende #634-mønstre skal stadig virke =====

run "railway variables (no filter) still blocks (#634 regression)" \
  "$(bash_cmd_payload 'railway variables')" \
  2 "railway variables"

run "railway variables --json | jq 'keys' still safe (#634 regression)" \
  "$(bash_cmd_payload "railway variables --json | jq 'keys'")" \
  0 ""

run "vercel env ls --format json (no filter) still blocks (#634 regression)" \
  "$(bash_cmd_payload 'vercel env ls production --format json')" \
  2 "vercel env ls"

run "infisical secrets --plain still blocks (#634 regression)" \
  "$(bash_cmd_payload 'infisical secrets --plain')" \
  2 "infisical secrets/export"

run "cat backend/.env still blocks (#634 regression)" \
  "$(bash_cmd_payload 'cat backend/.env')" \
  2 "cat .env"

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"
rm -f "$STDERR_TMP" 2>/dev/null

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
