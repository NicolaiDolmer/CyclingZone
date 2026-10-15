#!/bin/bash
# Test Stop hook (scripts/check-now-md.sh) NOW.md budget-warning logic
# without mutating the real file.
#
# Kontrakt (efter #750/#1097): hooken må ALDRIG mutere NOW.md og ALDRIG
# skrive til docs/archive/ — den emitter kun en warning om direkte trim
# når NOW.md er over budget (token primaer ~1.200, linjer sekundaer <=30).
# Refs #75, #750, #1097.

set -u
FAIL=0
PASS=0

WORK=$(mktemp -d)
cp docs/NOW.md "$WORK/NOW.md.orig" 2>/dev/null || true
ARCHIVE_BEFORE_LIST=$(ls docs/archive 2>/dev/null | sort)

cleanup() {
  if [ -f "$WORK/NOW.md.orig" ]; then
    cp "$WORK/NOW.md.orig" docs/NOW.md
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

NOW_WARN_MARKER="Opret IKKE docs/archive/NOW-"

# Test 1: >30 linjer -> warning emitted, fil UROERT, ingen ny arkivfil.
{
  echo "# NOW — Aktuel arbejdsstatus"
  echo ""
  echo "## Aktiv styring"
  echo ""
  echo "> **🎯 Next action:** SENTINEL_NEXT_ACTION_KEEP"
  echo "> **🤖 Working agent:** SENTINEL_WORKING_AGENT_KEEP"
  for i in $(seq 1 35); do echo "line $i"; done
} > docs/NOW.md

SHA_BEFORE=$(md5sum docs/NOW.md | cut -d' ' -f1)
OUT=$(bash scripts/check-now-md.sh </dev/null 2>/dev/null)
SHA_AFTER=$(md5sum docs/NOW.md | cut -d' ' -f1)

if [ "$SHA_BEFORE" = "$SHA_AFTER" ]; then
  PASS=$((PASS+1))
  echo "PASS  Over-budget NOW.md left byte-for-byte untouched (no auto-archive/trim)"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Hook mutated NOW.md (forbidden after #750)"
fi

if printf '%s' "$OUT" | grep -q "$NOW_WARN_MARKER"; then
  PASS=$((PASS+1))
  echo "PASS  Budget warning emitted for >30 lines"
else
  FAIL=$((FAIL+1))
  echo "FAIL  No budget warning emitted for >30 lines"
fi

ARCHIVE_AFTER_LIST=$(ls docs/archive 2>/dev/null | sort)
if [ "$ARCHIVE_BEFORE_LIST" = "$ARCHIVE_AFTER_LIST" ]; then
  PASS=$((PASS+1))
  echo "PASS  No new files created in docs/archive/"
else
  FAIL=$((FAIL+1))
  echo "FAIL  docs/archive/ contents changed (hook wrote an archive file)"
fi

# Test 2: faa linjer men >1.200 tok (taette lange linjer) -> token-primaer warning.
LONGLINE=$(printf 'x%.0s' $(seq 1 1600))
{
  echo "# NOW — Aktuel arbejdsstatus"
  echo "$LONGLINE"
  echo "$LONGLINE"
  echo "$LONGLINE"
  echo "$LONGLINE"
} > docs/NOW.md

OUT=$(bash scripts/check-now-md.sh </dev/null 2>/dev/null)
if printf '%s' "$OUT" | grep -q "$NOW_WARN_MARKER"; then
  PASS=$((PASS+1))
  echo "PASS  Token-primary warning fires on dense few-line file (>1.200 tok)"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Dense over-budget file slipped through (line-count blind spot)"
fi

# Test 3: lille compliant fil -> ingen NOW-budget-warning.
{
  echo "# NOW — Aktuel arbejdsstatus"
  echo ""
  echo "## Aktiv styring"
  echo ""
  echo "> **🎯 Next action:** kort og under budget"
} > docs/NOW.md

OUT=$(bash scripts/check-now-md.sh </dev/null 2>/dev/null)
if printf '%s' "$OUT" | grep -q "$NOW_WARN_MARKER"; then
  FAIL=$((FAIL+1))
  echo "FAIL  Budget warning fired on compliant file (cry-wolf)"
else
  PASS=$((PASS+1))
  echo "PASS  No budget warning on compliant file"
fi

# Test: EN gang pr. session (ejer 15/10). Samme session_id -> anden kørsel tavs;
# ny session -> vises igen; uden session_id -> uændret (vises hver gang).
SID="test-$$-dedupe"
SID2="test-$$-dedupe2"
SEEN=".claude/run/closeout-reminder-$SID.seen"
SEEN2=".claude/run/closeout-reminder-$SID2.seen"
rm -f "$SEEN" "$SEEN2"
{ echo "# NOW"; for i in $(seq 1 35); do echo "line $i"; done; } > docs/NOW.md
O1=$(printf '{"session_id":"%s"}' "$SID" | bash scripts/check-now-md.sh 2>/dev/null)
O2=$(printf '{"session_id":"%s"}' "$SID" | bash scripts/check-now-md.sh 2>/dev/null)
O3=$(printf '{"session_id":"%s"}' "$SID2" | bash scripts/check-now-md.sh 2>/dev/null)
O4=$(bash scripts/check-now-md.sh </dev/null 2>/dev/null)
O5=$(bash scripts/check-now-md.sh </dev/null 2>/dev/null)
rm -f "$SEEN" "$SEEN2"
if printf '%s' "$O1" | grep -q "$NOW_WARN_MARKER" && ! printf '%s' "$O2" | grep -q "$NOW_WARN_MARKER"; then
  PASS=$((PASS+1)); echo "PASS  Same session: reminder shown once, then silent"
else
  FAIL=$((FAIL+1)); echo "FAIL  Same session repeated the reminder (spam)"
fi
if printf '%s' "$O3" | grep -q "$NOW_WARN_MARKER"; then
  PASS=$((PASS+1)); echo "PASS  New session sees the reminder again"
else
  FAIL=$((FAIL+1)); echo "FAIL  New session did not see the reminder"
fi
if printf '%s' "$O4" | grep -q "$NOW_WARN_MARKER" && printf '%s' "$O5" | grep -q "$NOW_WARN_MARKER"; then
  PASS=$((PASS+1)); echo "PASS  Without session_id the hook behaves as before"
else
  FAIL=$((FAIL+1)); echo "FAIL  Without session_id the reminder was suppressed"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]
