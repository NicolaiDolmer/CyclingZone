#!/bin/bash
# Investigation for #623 — measure PatchNotes miss-rate over last 30 days.
# Outputs JSON to stdout with per-PR classification.

set -e

cd "$(dirname "$0")/.."

PRS_JSON="/tmp/prs2.json"
if [ ! -f "$PRS_JSON" ]; then
    echo "ERROR: $PRS_JSON missing — run gh pr list first" >&2
    exit 1
fi

echo "["
FIRST=1

jq -c '.[]' "$PRS_JSON" | while read -r pr; do
    NUM=$(echo "$pr" | jq -r '.number')
    SHA=$(echo "$pr" | jq -r '.mergeCommit.oid')
    TITLE=$(echo "$pr" | jq -r '.title')
    MERGED=$(echo "$pr" | jq -r '.mergedAt')
    LABELS=$(echo "$pr" | jq -c '[.labels[].name]')

    if [ -z "$SHA" ] || [ "$SHA" = "null" ]; then
        continue
    fi

    # Get files changed in this merge commit (1 = merge commit, look at -m -1)
    # For squash-merged or rebased PRs, mergeCommit is a single commit
    FILES=$(git show --name-only --format= "$SHA" 2>/dev/null | grep -v '^$' || true)

    if [ -z "$FILES" ]; then
        continue
    fi

    # Classify files
    USER_FACING=0
    PATCH_NOTE_TOUCHED=0
    HAS_FRONTEND=0
    HAS_LOCALES=0
    HAS_PUBLIC=0

    while IFS= read -r FILE; do
        case "$FILE" in
            frontend/src/pages/PatchNotesPage.jsx)
                PATCH_NOTE_TOUCHED=1
                USER_FACING=1
                HAS_FRONTEND=1
                ;;
            frontend/src/*.jsx|frontend/src/*.tsx|frontend/src/*.js|frontend/src/*.ts|frontend/src/*.css)
                USER_FACING=1
                HAS_FRONTEND=1
                ;;
            frontend/src/**/*.jsx|frontend/src/**/*.tsx|frontend/src/**/*.js|frontend/src/**/*.ts|frontend/src/**/*.css)
                USER_FACING=1
                HAS_FRONTEND=1
                ;;
            frontend/public/locales/*)
                USER_FACING=1
                HAS_LOCALES=1
                ;;
            frontend/public/*)
                # Only assets like favicon, og-image — borderline user-facing
                # Skip; not patch-note material on their own
                ;;
        esac

        # bash case doesn't handle ** — use grep for nested paths
        if echo "$FILE" | grep -qE '^frontend/src/.*\.(jsx|tsx|js|ts|css)$'; then
            USER_FACING=1
            HAS_FRONTEND=1
            if [ "$FILE" = "frontend/src/pages/PatchNotesPage.jsx" ]; then
                PATCH_NOTE_TOUCHED=1
            fi
        fi
        if echo "$FILE" | grep -qE '^frontend/public/locales/'; then
            USER_FACING=1
            HAS_LOCALES=1
        fi
    done <<< "$FILES"

    # Skip if not user-facing
    if [ "$USER_FACING" -eq 0 ]; then
        continue
    fi

    HAS_BACKEND_ONLY=$(echo "$LABELS" | jq 'any(. == "backend-only" or . == "docs-only")')

    if [ $FIRST -eq 0 ]; then echo ","; fi
    FIRST=0
    printf '  {"num":%s,"sha":"%s","title":%s,"mergedAt":"%s","labels":%s,"patchNoteTouched":%s,"hasFrontend":%s,"hasLocales":%s,"skipLabel":%s}' \
        "$NUM" "$SHA" "$(echo "$TITLE" | jq -Rs .)" "$MERGED" "$LABELS" "$PATCH_NOTE_TOUCHED" "$HAS_FRONTEND" "$HAS_LOCALES" "$HAS_BACKEND_ONLY"
done

echo ""
echo "]"
