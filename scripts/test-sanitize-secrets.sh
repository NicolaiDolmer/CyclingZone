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

# GitHub GraphQL paginerings-cursor (base64 "cursor:v2:...") allow-listet —
# starter med Y3Vyc29y, skal IKKE flagges som high-entropy (housekeeping FP 2026-05-31).
run "github-graphql-cursor allowlisted" \
  "Next page cursor: Y3Vyc29yOnYyOpK0NDU2Nzg5MDEyMzQ1Njc4OTBhYmNkZWZn done. $PAD" \
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

# ===== #3317: ISO-timestamp backup-filename false-positive skip =====

# Backup-filnavn fra repair2276Div4Cascade.js/repair2251Tier4GrandTours.js-
# moenstret (`<slug>-${now.toISOString().replace(/[:.]/g, "-")}.json`) SKAL
# passere som text (ikke som JSON-payload-tool_name, saa ren tekst-scanning).
run "iso-timestamp-backup-filename skipped (#3317)" \
  "backup skrevet: repair-2276-div4-cascade-2026-07-10T14-23-45-678Z.json done. $PAD" \
  0 ""

run "iso-timestamp-backup-filename skipped variant (#3317)" \
  "backup skrevet: repair-2251-tier4-gts-2026-06-30T09-05-12-003Z.json done. $PAD" \
  0 ""

# KONTROL: raw high-entropy UDEN ISO-timestamp-suffiks SKAL stadig blokere.
run "raw high-entropy still blocks (#3317 guard)" \
  "Value: $(mk_random_highentropy) $PAD" \
  2 "high-entropy"

# ===== #3128: Vercel/Supabase bot PR-comment metadata false-positive skip =====

# Ægte struktur fra Vercel-bottens PR-kommentar (PR #3125, 2026-08-04):
# "[vc]: #<base64-hash>:<base64-JSON-blob>". Bygget via printf ligesom de
# andre fixtures saa intet komplet secret-lignende moenster staar som
# litteral i denne fil.
mk_vercel_bot_comment() {
  # Hash- og blob-segmenter splittet i <40-tegns bidder (ligesom de andre
  # fixture-builders) saa intet enkelt literal i denne KILDEFIL selv trigger
  # high-entropy naar filen Read'es/Edit'es/Grep'es.
  printf '[vc]: #%s%s%s:%s%s%s%s%s' \
    'gJE7Z52QIG0Du' 'UH+Uggqbb' 'VZOnAOa8NWDEvf' \
    'eyJpc01vbm9yZXBv' 'Ijp0cnVlLCJ0eXBl' 'IjoiZ2l0aHVi' 'IiwicHJvamVjdHMi' 'OltdfQ=='
}
run "vercel-bot-pr-comment-metadata skipped (#3128)" \
  "Comment body: $(mk_vercel_bot_comment) $PAD" \
  0 ""

mk_supabase_bot_comment() {
  printf '[supa]: #%s%s:%s%s%s' \
    'aB3xZ9qK7mP2wR8n' 'T4vL6yC1jH5gF0d=' \
    'eyJicmFuY2giOiJm' 'aXgtMzEyOCIsInN0' 'YXR1cyI6InJlYWR5In0='
}
run "supabase-bot-pr-comment-metadata skipped (#3128)" \
  "Comment body: $(mk_supabase_bot_comment) $PAD" \
  0 ""

# KONTROL: en aegte JWT ELSEWHERE i samme kommentar-tekst SKAL stadig
# blokere — bot-metadata-stripning maa ikke skygge for et rigtigt fund.
run "real jwt beside vercel-bot-comment still blocks (#3128 guard)" \
  "Comment body: $(mk_vercel_bot_comment) leaked token: $(mk_jwt_legacy) $PAD" \
  2 "jwt-supabase-legacy"

# ===== #3024: thinking-signature-felter i agent-transcripts =====

# Baggrund: .claude/projects/**/*.jsonl indeholder et "signature"-felt paa hver
# thinking-blok — en meget lang base64-streng (maalt 30/8 2026: 4.431 felter i
# de 40 nyeste transcripts, korteste 352 tegn, 69.408 high-entropy-fragmenter
# inde i dem). Den er ikke en credential. I dag blokerer hooken alligevel hele
# outputtet naar en agent laeser et transcript; #3024 leverede foreloebig kun
# en forklarende linje i hook-beskeden, ikke en undtagelse.
#
# DISSE TO TESTS ER FORWARD-GUARDEN: tilfoejer nogen senere en rigtig
# signature-undtagelse i high-entropy-fallback'en, SKAL begge stadig passere.
# De beviser at undtagelsen ikke kan bruges som smuglerrute for en aegte,
# kendt-praefikset secret der er plantet i netop det felt. Named patterns
# koeres FOER fallback'en; falder de to her, er den orden braekket.

mk_signature_field() {
  # $1 = payload der plantes inde i signature-vaerdien.
  # Padding-segmenterne er splittet i <40-tegns bidder saa denne KILDEFIL ikke
  # selv trigger high-entropy naar den Read'es/Edit'es/Grep'es.
  printf '{"type":"thinking","%s":"%s%s%s%s"}' \
    'signature' \
    'EqQBCkYIBxgCKkCx9Kd2mHfLpQwXyZ0aBc' \
    'DeFgHiJkLmNoPqRsTuVwXyZ012345678' \
    "$1" \
    'AbCdEfGhIjKlMnOpQrStUvWxYz01234='
}

run "real jwt inside signature-field still blocks (#3024 guard)" \
  "Transcript line: $(mk_signature_field "$(mk_jwt_legacy)") $PAD" \
  2 "jwt-supabase-legacy"

run "supabase-secret inside signature-field still blocks (#3024 guard)" \
  "Transcript line: $(mk_signature_field "$(mk_supabase_secret)") $PAD" \
  2 "supabase-secret"

# ===== #4493: STORT_NAVN=<hex> false-positive skip =====

# UPPERCASE_VAR=<40-tegns-lowercase-hex> (fx et git commit-SHA) SKAL passere.
# '=' bandt tidligere variabelnavnets store bogstaver sammen med vaerdiens
# smaa+cifre til ét high-entropy-token; ingen af delene har en secret alene.
mk_fake_sha() {
  printf '%s%s' '3d3c42e5aa1b2c3d4e5f6789ab' 'cdef0123456789ba90b1'
}

run "COMMIT=<sha> allowlisted (#4493)" \
  "Log: COMMIT=$(mk_fake_sha) done. $PAD" \
  0 ""

run "SHA=<sha> allowlisted (#4493)" \
  "Log: SHA=$(mk_fake_sha) done. $PAD" \
  0 ""

run "COMMIT_SHA=<sha> allowlisted (#4493)" \
  "Log: COMMIT_SHA=$(mk_fake_sha) done. $PAD" \
  0 ""

# KONTROL: en aegte navngivet secret ved siden af et stort variabelnavn SKAL
# stadig blokere — named patterns koeres FOER high-entropy-fallback'en.
run "COMMIT=<jwt> still blocks (#4493 guard)" \
  "Log: COMMIT=$(mk_jwt_legacy) done. $PAD" \
  2 "jwt-supabase-legacy"

run "SUPABASE_KEY=<sb_secret_> still blocks (#4493 guard)" \
  "Log: SUPABASE_KEY=$(mk_supabase_secret) done. $PAD" \
  2 "supabase-secret"

# KONTROL: KEY=<aegte base64-secret med == padding> SKAL stadig blokere —
# vaerdi-segmentet alene (efter split paa '=') opfylder stadig entropi-kravet.
mk_padded_base64_secret() {
  # 42-tegns krop (>=40 kraevet uafhaengigt af padding) + '==' padding.
  printf '%s%s' 'AbC123dEfG456hIjK789lMnO012pQrS345tUvWxYz' '=='
}
run "KEY=<padded-base64-secret> still blocks (#4493 guard)" \
  "Log: KEY=$(mk_padded_base64_secret) done. $PAD" \
  2 "high-entropy"

# KONTROL: raw high-entropy UDEN '=' SKAL stadig blokere (beskyttelse intakt).
run "raw high-entropy still blocks (#4493 guard)" \
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
