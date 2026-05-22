#!/bin/bash
# Test Stop hook (scripts/check-now-md.sh) NOW.md auto-archive logic
# without mutating the real file. Refs #75.

set -u
FAIL=0
PASS=0

WORK=$(mktemp -d)
cp -r docs/NOW.md "$WORK/NOW.md.orig" 2>/dev/null || true

# Snapshot ALL pre-existing archive files so we can restore them byte-for-byte.
# Script appends to NOW-YYYY-MM-DD.md, so "remove what wasn't there" leaks test data.
mkdir -p "$WORK/archive-snapshot"
if [ -d "docs/archive" ]; then
  cp -p docs/archive/NOW-*.md "$WORK/archive-snapshot/" 2>/dev/null || true
fi
ARCHIVE_BEFORE_LIST=$(ls docs/archive 2>/dev/null | sort)

cleanup() {
  if [ -f "$WORK/NOW.md.orig" ]; then
    cp "$WORK/NOW.md.orig" docs/NOW.md
  fi
  # Restore pre-existing archive files byte-for-byte.
  for snap in "$WORK/archive-snapshot/"NOW-*.md; do
    [ -f "$snap" ] || continue
    bn=$(basename "$snap")
    cp -p "$snap" "docs/archive/$bn"
  done
  # Remove any NEW archive file that didn't exist before the test ran.
  ARCHIVE_AFTER_LIST=$(ls docs/archive 2>/dev/null | sort)
  comm -13 <(printf '%s\n' "$ARCHIVE_BEFORE_LIST") <(printf '%s\n' "$ARCHIVE_AFTER_LIST") | while read -r f; do
    [ -n "$f" ] && rm -f "docs/archive/$f"
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

ARCHIVE_BEFORE=$(ls docs/archive 2>/dev/null | wc -l)

# Test 1: legacy behavior (ingen Aktiv styring-sektion).
{
  echo "# NOW"
  echo ""
  echo "## Aktiv slice"
  for i in $(seq 1 35); do echo "line $i"; done
  echo "## Tail"
  echo "tail content"
} > docs/NOW.md

ORIG_LINES=$(wc -l < docs/NOW.md)

bash scripts/check-now-md.sh </dev/null >/dev/null 2>&1

NEW_LINES=$(wc -l < docs/NOW.md)
ARCHIVE_AFTER=$(ls docs/archive 2>/dev/null | wc -l)

if [ "$NEW_LINES" -le 30 ]; then
  PASS=$((PASS+1))
  echo "PASS  Stop hook trims legacy NOW.md from $ORIG_LINES to $NEW_LINES lines"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Stop hook did NOT trim legacy file (still $NEW_LINES lines)"
fi

if [ "$ARCHIVE_AFTER" -ge "$ARCHIVE_BEFORE" ]; then
  PASS=$((PASS+1))
  echo "PASS  archive dir grew or stayed same ($ARCHIVE_BEFORE -> $ARCHIVE_AFTER)"
fi

# Test 2: Aktiv styring-protection MED en cut-point header til archivering.
# Regression-guard mod dfcee56-incident 2026-05-22 (Aktiv styring arkiveret som
# hvis det var historisk indhold).
{
  echo "# NOW — Aktuel arbejdsstatus"
  echo ""
  echo "## Recent sessions"
  echo ""
  for i in $(seq 1 25); do echo "> Session quote $i"; echo ""; done
  echo "## Aktiv styring"
  echo ""
  echo "> **🎯 Next action:** SENTINEL_NEXT_ACTION_KEEP"
  echo ">"
  echo "> _Format spec_"
  echo ""
  echo "> **🤖 Working agent:** SENTINEL_WORKING_AGENT_KEEP"
  echo ">"
  echo "> _Format spec_"
} > docs/NOW.md

bash scripts/check-now-md.sh </dev/null >/dev/null 2>&1

if grep -q "SENTINEL_NEXT_ACTION_KEEP" docs/NOW.md && grep -q "SENTINEL_WORKING_AGENT_KEEP" docs/NOW.md; then
  PASS=$((PASS+1))
  echo "PASS  Aktiv styring sentinels preserved in NOW.md after trim"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Aktiv styring sentinels lost (Next action / Working agent felter blev arkiveret)"
fi

if grep -q "^## Aktiv styring" docs/NOW.md; then
  PASS=$((PASS+1))
  echo "PASS  '## Aktiv styring' header still in NOW.md"
else
  FAIL=$((FAIL+1))
  echo "FAIL  '## Aktiv styring' header missing from NOW.md after trim"
fi

# Sanity: gamle session-quotes MÅ være arkiveret (cut-header eksisterer).
TODAY_ARCHIVE="docs/archive/NOW-$(date +%F).md"
if [ -f "$TODAY_ARCHIVE" ] && grep -q "Session quote" "$TODAY_ARCHIVE"; then
  PASS=$((PASS+1))
  echo "PASS  Old session quotes were archived to $TODAY_ARCHIVE"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Old session quotes NOT archived (expected at least one in $TODAY_ARCHIVE)"
fi

# Test 3: real-world layout — kun ÉN ## header (Aktiv styring), session-quotes er
# blockquotes uden ## boundaries. Script må IKKE arkivere (ingen sikker cut) men
# må heller IKKE ødelægge filen.
{
  echo "# NOW — Aktuel arbejdsstatus"
  echo ""
  echo "> Næste session-kandidater: noget"
  echo ""
  for i in $(seq 1 12); do echo "> Session quote $i — lang nok til at fylde linjen"; echo ""; done
  echo "## Aktiv styring"
  echo ""
  echo "> **🎯 Next action:** SENTINEL_REAL_WORLD_NEXT"
  echo ""
  echo "> **🤖 Working agent:** SENTINEL_REAL_WORLD_WORKING"
} > docs/NOW.md

LINES_BEFORE=$(wc -l < docs/NOW.md)
SHA_BEFORE=$(md5sum docs/NOW.md | cut -d' ' -f1)
bash scripts/check-now-md.sh </dev/null >/dev/null 2>&1
LINES_AFTER=$(wc -l < docs/NOW.md)
SHA_AFTER=$(md5sum docs/NOW.md | cut -d' ' -f1)

if grep -q "SENTINEL_REAL_WORLD_NEXT" docs/NOW.md && grep -q "SENTINEL_REAL_WORLD_WORKING" docs/NOW.md; then
  PASS=$((PASS+1))
  echo "PASS  Real-world layout: sentinels preserved"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Real-world layout: sentinels LOST (regression)"
fi

# Når der ingen pre-Aktiv-styring ## headers er, skal scriptet skip-archive — fil unchanged.
if [ "$SHA_BEFORE" = "$SHA_AFTER" ]; then
  PASS=$((PASS+1))
  echo "PASS  Real-world layout: file unchanged when no safe cut exists (no destructive trim)"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Real-world layout: file modified despite no safe cut (lines $LINES_BEFORE -> $LINES_AFTER)"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]
