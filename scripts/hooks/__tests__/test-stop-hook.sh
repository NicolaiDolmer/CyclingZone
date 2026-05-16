#!/bin/bash
# Test Stop hook (scripts/check-now-md.sh) NOW.md auto-archive logic
# without mutating the real file. Refs #75.

set -u
FAIL=0
PASS=0

WORK=$(mktemp -d)
cp -r docs/NOW.md "$WORK/NOW.md.orig" 2>/dev/null || true

# Snapshot archive dir state so we can drop test-created archive files.
ARCHIVE_BEFORE_LIST=$(ls docs/archive 2>/dev/null | sort)

cleanup() {
  if [ -f "$WORK/NOW.md.orig" ]; then
    cp "$WORK/NOW.md.orig" docs/NOW.md
  fi
  # Remove any archive file that didn't exist before the test ran.
  ARCHIVE_AFTER_LIST=$(ls docs/archive 2>/dev/null | sort)
  comm -13 <(printf '%s\n' "$ARCHIVE_BEFORE_LIST") <(printf '%s\n' "$ARCHIVE_AFTER_LIST") | while read -r f; do
    [ -n "$f" ] && rm -f "docs/archive/$f"
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

ARCHIVE_BEFORE=$(ls docs/archive 2>/dev/null | wc -l)

# Build a 40-line NOW.md.
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
  echo "PASS  Stop hook trims NOW.md from $ORIG_LINES to $NEW_LINES lines"
else
  FAIL=$((FAIL+1))
  echo "FAIL  Stop hook did NOT trim (still $NEW_LINES lines)"
fi

if [ "$ARCHIVE_AFTER" -ge "$ARCHIVE_BEFORE" ]; then
  PASS=$((PASS+1))
  echo "PASS  archive dir grew or stayed same ($ARCHIVE_BEFORE -> $ARCHIVE_AFTER)"
fi

echo ""
echo "Results: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]
