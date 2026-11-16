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

# Blokbeskeden hedder "fil-læser mod .env" siden udvidelsen 2026-08-06; den
# gamle forventning ("cat .env") fejlede derfor altid (#8240).
run "cat backend/.env still blocks (#634 regression)" \
  "$(bash_cmd_payload 'cat backend/.env')" \
  2 "fil-læser mod .env"

# ===== #8240: alle moenstre efter omskrivningen til een Python-proces =====
# Hver blokerende regel har en prøve, og de vigtigste undtagelser har en
# kontrol, saa en fremtidig optimering ikke stille kan tabe et moenster.

# JSON-escaping af en vilkaarlig streng (backslash, citationstegn, linjeskift).
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}
tool_payload() { # TOOL KEY VALUE
  printf '{"tool_name":"%s","tool_input":{"%s":%s}}' "$1" "$2" "$(json_str "$3")"
}
bash_any() { tool_payload Bash command "$1"; }
ps_any() { tool_payload PowerShell command "$1"; }

# Fixture-secrets samles ved runtime, saa denne fil ikke selv indeholder et
# komplet moenster (gitleaks + sanitize-secrets).
FAKE_SB="sb_""secret_""FIXTURE_DO_NOT_USE_1234567890abcdefghij"
FAKE_GH="ghp""_""$(printf 'A%.0s' $(seq 1 36))"
FAKE_AWS="AKIA""ABCDEFGHIJKLMNOP"

# --- Lag 1: literal secret i tool_input for ALLE vaerktoejer ---
run "Write with supabase secret in content blocks (all-tools layer)" \
  "$(tool_payload Write content "const k = '$FAKE_SB';")" \
  2 "supabase-secret"
run "Agent prompt with github PAT blocks (all-tools layer)" \
  "$(tool_payload Agent prompt "brug token $FAKE_GH her")" \
  2 "github-pat"
run "MCP arg with AWS key blocks (all-tools layer)" \
  "$(tool_payload mcp__probe__call query "key $FAKE_AWS")" \
  2 "aws-access-key"
run "Edit with harmless Danish text passes" \
  "$(tool_payload Edit new_string 'Hej verden æøå — ingen hemmeligheder')" \
  0 ""

# --- Lag 2: Read/Grep mod secret-filer ---
run "Read .mcp.json blocks" "$(read_payload 'C:/repo/.mcp.json')" 2 "Read/Grep mod secret-fil"
run "Read backend/.env.local blocks" "$(read_payload 'backend/.env.local')" 2 "Read/Grep mod secret-fil"
run "Read secrets/ dir blocks" "$(read_payload 'ops/secrets/prod.txt')" 2 "Read/Grep mod secret-fil"
run "Grep with explicit .env path blocks" "$(tool_payload Grep path 'backend/.env')" 2 "Read/Grep mod secret-fil"
run "Read .env.example passes (whitelist)" "$(read_payload 'backend/.env.example')" 0 ""
run "Read ordinary source file passes" "$(read_payload 'frontend/src/App.jsx')" 0 ""

# --- Lag 3: Bash/PowerShell-kommandoer ---
run "railway variables --json without jq blocks" "$(bash_any 'railway variables --json')" 2 "railway variables"
run "probe-railway-keys wrapper passes" "$(bash_any 'railway variables --json | node scripts/probe-railway-keys.mjs')" 0 ""
run "vercel env ls json with jq list passes" "$(bash_any "vercel env ls production --format json | jq '[.[] | .key]'")" 0 ""
run "vercel env pull blocks" "$(bash_any 'vercel env pull .env.local')" 2 "vercel env pull"
run "vercel env decrypt blocks" "$(bash_any 'vercel env decrypt FOO')" 2 "vercel env decrypt"
run "infisical export blocks" "$(bash_any 'infisical export --env=prod')" 2 "infisical secrets/export"
run "infisical run passes" "$(bash_any 'infisical run --env=dev -- node x.js')" 0 ""
run "tail on .env blocks" "$(bash_any 'tail -n 5 backend/.env')" 2 "fil-læser mod .env"
run "sed on .env blocks" "$(bash_any "sed -n 1,5p backend/.env")" 2 "fil-læser mod .env"
run "grep keys-only on .env passes" "$(bash_any "grep -oE '^[A-Z_]+' backend/.env")" 0 ""
run "PowerShell Get-Content .env blocks" "$(ps_any 'Get-Content backend/.env')" 2 "Get-Content .env"
run "PowerShell gc .env blocks" "$(ps_any 'gc .env')" 2 "Get-Content .env"
run "type test-token json blocks" "$(ps_any 'type .codex.local/test-token.json')" 2 "get-test-token.mjs-output"
run "bare env blocks" "$(bash_any 'env')" 2 "env / printenv"
run "printenv after && blocks" "$(bash_any 'cd x &&printenv')" 2 "env / printenv"
run "Get-ChildItem env: blocks" "$(ps_any 'Get-ChildItem env:')" 2 "Get-ChildItem env:"
run "gci env: blocks" "$(ps_any 'gci env:')" 2 "Get-ChildItem env:"
run "Get-ChildItem env: names-only passes" "$(ps_any 'Get-ChildItem env: | Select-Object -ExpandProperty Name')" 0 ""
run "git show of .env blocks" "$(bash_any 'git show HEAD~3:backend/.env')" 2 "git show"
run "git log -p .env blocks" "$(bash_any 'git log -p backend/.env')" 2 "git log -p .env"
run "vercel inspect unfiltered blocks" "$(bash_any 'vercel inspect https://x.vercel.app')" 2 "vercel inspect"
run "vercel inspect with jq passes" "$(bash_any "vercel inspect https://x.vercel.app | jq '.url'")" 0 ""
run "console.log(process.env) blocks" "$(bash_any "node -e 'console.log(process.env)'")" 2 "console.log(process.env)"
run "uppercase command still blocks (case-insensitive)" "$(bash_any 'RAILWAY VARIABLES')" 2 "railway variables"
run "dangerous second line of multi-line command blocks" "$(bash_any $'git status\ncat backend/.env')" 2 "fil-læser mod .env"
run "non-ASCII command passes without parse failure" "$(bash_any 'git commit -m \"Træning 漢字 ✓\"')" 0 ""
run "ordinary git command passes" "$(bash_any 'git --no-pager log --oneline -5')" 0 ""
run "Bash literal secret in command blocks via all-tools layer" "$(bash_any "echo $FAKE_SB")" 2 "supabase-secret"

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"
rm -f "$STDERR_TMP" 2>/dev/null

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
