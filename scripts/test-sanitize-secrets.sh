#!/usr/bin/env bash
# Test suite for PostToolUse sanitize-secrets.sh hook (#634 AC2).
#
# Run from repo root: bash scripts/test-sanitize-secrets.sh
#
# Hver case bygger en FAKE-but-realistic secret via printf-concat (saa hverken
# block-dangerous-secret-commands.sh PreToolUse hook eller gitleaks pre-commit
# ser et komplet pattern i source). Ved runtime samler bash strings og piper
# til .claude/hooks/sanitize-secrets.sh som SKAL fange dem.
#
# Path scripts/test-sanitize-secrets.sh er gitleaks-allow-listet (.gitleaks.toml).
#
# Refs: #634 AC2, AC6.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$REPO_ROOT/.claude/hooks/sanitize-secrets.sh"

if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook ikke fundet: $HOOK"
  exit 1
fi

PASS=0
FAIL=0
STDERR_TMP="$(mktemp 2>/dev/null || echo /tmp/.sanitize-test-stderr)"

run() {
  local name="$1" input="$2" want_exit="$3" want_type="$4"
  out=$(printf '%s' "$input" | bash "$HOOK" 2>"$STDERR_TMP")
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
    [ -n "$err" ] && echo "  stderr head: $(printf '%s' "$err" | head -c 200)"
  fi
}

# Padding: hook skipper output <100 chars. Padding loefter hver fixture over graensen.
PAD="lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore "

# ===== Fixture-builders =====
# Hver builder samler en FAKE secret via printf saa ingen komplet pattern
# eksisterer som litteral string i denne fil. Bash assembler ved runtime.

mk_jwt_legacy() {
  # eyJh + 10+ + . + eyJ + 20+ + . + 20+ chars
  printf '%s%s.%s%s.%s' 'eyJh' 'bGciOiJIUzI1NiJ9' 'eyJ' 'zdWIiOiJGSVhUVVJFMTIzNDU2Nzg5MCJ9' 'SflKxFIXTUREDoNotUsewRJSMeKKF2QT4fwpMeJf36POk6yJV'
}

mk_sentry_dsn() {
  # https:// + 32 hex + @ + host + .ingest.sentry.io/ + nums
  printf 'https://%s@%s%s/%s' 'abc123def456abc123def456abc123de' 'o1234567' '.ingest.sentry.io' '7654321'
}

mk_supabase_secret() {
  printf '%s%s' 'sb_secret_' 'FIXTUREaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
}

mk_supabase_publishable() {
  printf '%s%s' 'sb_publishable_' 'FIXTUREbbbbbbbbbbbbbbbbbbbbbbbbbb'
}

mk_discord_token() {
  # [MN] + 23-28 chars after = total 24-29 chars in first segment, then . 6-7 . 27-38
  printf '%s%s.%s.%s' 'M' 'TIzNDU2Nzg5MDEyMzQ1Njc4OTA' 'abcDEF' 'FIXTUREDoNotUseFIXTUREDoNotUseAB'
}

mk_github_pat() {
  printf '%s%s' 'ghp_' 'FIXTUREaBcDeFgHiJkLmNoPqRsTuVwXyZ012345'
}

mk_aws_key() {
  # AKIA + exactly 16 chars [0-9A-Z]
  printf '%s%s' 'AKIA' 'FIXTUREDONOTUSE1'
}

mk_anthropic_key() {
  printf '%s%s' 'sk-ant-' 'FIXTUREaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
}

mk_stripe_key() {
  printf '%s%s' 'sk_test_' 'FIXTUREaaaaaaaaaaaaaaaaaaaaaaaa'
}

# ===== Leak-detection tests =====

run "jwt-supabase-legacy detected" \
  "Tool output: $(mk_jwt_legacy) $PAD" \
  2 "jwt-supabase-legacy"

run "sentry-dsn detected" \
  "DSN: $(mk_sentry_dsn) $PAD" \
  2 "sentry-dsn"

run "supabase-secret detected" \
  "Key: $(mk_supabase_secret) $PAD" \
  2 "supabase-secret"

run "supabase-publishable detected" \
  "Key: $(mk_supabase_publishable) $PAD" \
  2 "supabase-publishable"

run "discord-bot-token detected" \
  "Token: $(mk_discord_token) $PAD" \
  2 "discord-bot-token"

run "github-pat detected" \
  "Auth: $(mk_github_pat) $PAD" \
  2 "github-pat"

run "aws-access-key detected" \
  "AWS: $(mk_aws_key) $PAD" \
  2 "aws-access-key"

run "anthropic-key detected" \
  "API: $(mk_anthropic_key) $PAD" \
  2 "anthropic-key"

run "stripe-key detected" \
  "Stripe: $(mk_stripe_key) $PAD" \
  2 "stripe-key"

# ===== Allow-list / safe-content tests =====

# git-SHA (40 hex chars) er allow-listet — skal IKKE flagges som high-entropy
run "git-SHA 40-hex allowlisted" \
  "Commit deadbeefcafebabefeedface0123456789abcdef pushed to main. $PAD" \
  0 ""

# Vite asset hash suffix allow-listet
run "vite-asset-hash allowlisted" \
  "Loaded /assets/index-DXFG08rR.js successfully without errors. $PAD" \
  0 ""

# Plain text uden patterns
run "safe text passes through" \
  "Build completed successfully in 4.2s. No warnings reported. $PAD$PAD" \
  0 ""

# ===== #752: path/identifier high-entropy false-positive skip =====

# Flad worktree-/session-sti (C:\ -> C--, mange ord-segmenter) SKAL passere.
run "worktree-flat-path skipped (#752)" \
  "Active session C--Dev-CyclingZone-worktrees-agent-ab3e0ab629c91e667 ready. $PAD" \
  0 ""

# Arkiv-filnavn med ord-segmenter SKAL passere.
run "archive-filename skipped (#752)" \
  "Trimmed NOW_HISTORICAL_ARCHIVE_consolidation_record entry. $PAD" \
  0 ""

# KONTROL: raw high-entropy UDEN ord-segmenter SKAL stadig blokere (beskyttelse intakt).
mk_random_highentropy() {
  printf '%s%s%s%s%s%s%s' 'aB3' 'xZ9qK7' 'mP2wR8' 'nT4vL6' 'yC1jH5' 'gF0dS2' 'bN8kM4pQ7'
}
run "raw high-entropy still blocks (#752 guard)" \
  "Value: $(mk_random_highentropy) $PAD" \
  2 "high-entropy"

# ===== Performance optimization tests =====

# <100 char input skipper hook scan (perf opt). Selv match-streng slipper.
# Brug minimal-JWT (eyJh + 10 + . + eyJ + 20 + . + 20 = 59 chars) m. prefix
mk_jwt_minimal() {
  printf '%s%s.%s%s.%s' 'eyJh' 'bGciOiJIUzI1' 'eyJ' 'zdWIiOiJGSVhUVVJFMTIz' 'SflKxFIXTUREDoNotUseab'
}
run "short output <100 char skipped" \
  "Token: $(mk_jwt_minimal)" \
  0 ""

# Empty input -> fail-open exit 0
run "empty input fail-open" \
  "" \
  0 ""

# ===== Summary =====
echo ""
echo "================================"
echo "Result: $PASS pass, $FAIL fail"
echo "================================"
rm -f "$STDERR_TMP" 2>/dev/null

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
