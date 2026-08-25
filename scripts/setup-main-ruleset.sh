#!/usr/bin/env bash
# Migrerer main fra klassisk branch protection til to rulesets:
#   1. main-ci-gate     — required status checks, intet bypass (gaelder alle, ogsaa admin)
#   2. main-review-gate — PR-review-kravet, med bypass for Repository admin
#
# Dermed kan ejeren merge egne PR'er uden review, men CI skal stadig vaere groen.
# Bypass-actors paa et enkelt ruleset omgaar ALLE regler i det ruleset — derfor
# splittes CI-checks og review-kravet i to separate rulesets (#4241).
#
# BRUG:
#   bash scripts/setup-main-ruleset.sh --dry-run   # vis payloads, ingen aendringer
#   bash scripts/setup-main-ruleset.sh             # opret/opdater rulesets
#
# PROCEDURE (jf. #4241):
#   1. Kour dette script → to rulesets oprettes VED SIDEN AF eksisterende protection
#   2. Test: opret en PR som ikke-admin og verificer at review kraeves
#   3. Slet klassisk branch protection: Settings > Branches > main > (edit) > delete
#   4. Test igen at gaten stadig er aktiv for begge scenarier
#
# UNDO: slet begge rulesets under Settings > Rules
#       og kour: bash scripts/apply-collab-branch-protection.sh

set -euo pipefail

REPO="NicolaiDolmer/CyclingZone"
BRANCH="main"
DRY_RUN=0

[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# ---------------------------------------------------------------
# Hjaelper: opret eller opdater et ruleset (idempotent paa navn)
# ---------------------------------------------------------------
apply_ruleset() {
  local NAME="$1"
  local PAYLOAD="$2"

  if [ "$DRY_RUN" = "1" ]; then
    echo ""
    echo "==> DRY RUN [$NAME]:"
    echo "$PAYLOAD" | jq '{name, bypass_actors, rules: [.rules[] | {type, parameters}]}'
    return
  fi

  EXISTING_ID=$(gh api "repos/$REPO/rulesets" 2>/dev/null \
    | jq -r --arg n "$NAME" '.[] | select(.name==$n) | .id' | head -1)

  if [ -n "$EXISTING_ID" ]; then
    echo "==> Opdaterer eksisterende ruleset '$NAME' (id=$EXISTING_ID)"
    echo "$PAYLOAD" | gh api -X PUT "repos/$REPO/rulesets/$EXISTING_ID" --input - > /dev/null
  else
    echo "==> Opretter nyt ruleset '$NAME'"
    RESULT=$(echo "$PAYLOAD" | gh api -X POST "repos/$REPO/rulesets" --input -)
    EXISTING_ID=$(echo "$RESULT" | jq -r '.id')
    echo "    id=$EXISTING_ID"
  fi
}

# ---------------------------------------------------------------
# Laes eksisterende klassisk branch protection
# ---------------------------------------------------------------
echo "==> Laeser eksisterende protection paa $REPO@$BRANCH"
CURRENT=$(gh api "repos/$REPO/branches/$BRANCH/protection")

STRICT=$(echo "$CURRENT" | jq '.required_status_checks.strict // false')

# Konverter klassisk format til ruleset-format.
# .checks (app-baserede checks, nyere format): app_id -> integration_id
# .contexts (legacy strings):                   integration_id = null
CHECKS_RAW=$(echo "$CURRENT" | jq -c '
  if .required_status_checks.checks and (.required_status_checks.checks | length) > 0 then
    [.required_status_checks.checks[] | {context: .context, integration_id: (.app_id // null)}]
  elif .required_status_checks.contexts and (.required_status_checks.contexts | length) > 0 then
    [.required_status_checks.contexts[] | {context: ., integration_id: null}]
  else
    []
  end
')

COUNT=$(echo "$CHECKS_RAW" | jq 'length')
echo "    Bevarer $COUNT required status checks (strict=$STRICT)"

if [ "$COUNT" -lt 20 ]; then
  echo "STOP: forventede mindst 20 required checks, fandt $COUNT." >&2
  echo "Kour ikke videre — det ville efterlade main delvist ubeskyttet." >&2
  exit 1
fi

# ---------------------------------------------------------------
# Ruleset 1: CI-gate (ingen bypass — CI gaelder for alle, ogsaa admin)
# ---------------------------------------------------------------
CI_PAYLOAD=$(jq -n \
  --arg branch "$BRANCH" \
  --argjson strict "$STRICT" \
  --argjson checks "$CHECKS_RAW" \
  '{
    name: "main-ci-gate",
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["refs/heads/" + $branch],
        exclude: []
      }
    },
    bypass_actors: [],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: $strict,
          required_status_checks: $checks
        }
      }
    ]
  }')

# ---------------------------------------------------------------
# Ruleset 2: Review-gate (bypass for Repository admin)
# actor_id=5 er GitHub's konstant for "Repository admin"-rollen
# bypass_mode="pull_request": bypass gaelder kun via PR, ikke direkte push
# ---------------------------------------------------------------
REVIEW_PAYLOAD=$(jq -n \
  --arg branch "$BRANCH" \
  '{
    name: "main-review-gate",
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["refs/heads/" + $branch],
        exclude: []
      }
    },
    bypass_actors: [
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request"
      }
    ],
    rules: [
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: false,
          required_review_thread_resolution: false
        }
      }
    ]
  }')

apply_ruleset "main-ci-gate" "$CI_PAYLOAD"
apply_ruleset "main-review-gate" "$REVIEW_PAYLOAD"

[ "$DRY_RUN" = "1" ] && exit 0

# ---------------------------------------------------------------
# Verificer begge rulesets
# ---------------------------------------------------------------
echo ""
echo "==> Verificerer"
ALL_RULESETS=$(gh api "repos/$REPO/rulesets")

for NAME in "main-ci-gate" "main-review-gate"; do
  RS=$(echo "$ALL_RULESETS" | jq --arg n "$NAME" '.[] | select(.name==$n)')
  if [ -z "$RS" ] || [ "$RS" = "null" ]; then
    echo "FEJL: ruleset '$NAME' ikke fundet efter oprettelse." >&2
    exit 1
  fi
  echo "  $NAME (id=$(echo "$RS" | jq -r '.id')): enforcement=$(echo "$RS" | jq -r '.enforcement') OK"
done

CI_ID=$(echo "$ALL_RULESETS" | jq -r '.[] | select(.name=="main-ci-gate") | .id')
CI_DETAIL=$(gh api "repos/$REPO/rulesets/$CI_ID")
CI_CHECK_COUNT=$(echo "$CI_DETAIL" | jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks | length')
CI_BYPASS_COUNT=$(echo "$CI_DETAIL" | jq '.bypass_actors | length')

REVIEW_ID=$(echo "$ALL_RULESETS" | jq -r '.[] | select(.name=="main-review-gate") | .id')
REVIEW_DETAIL=$(gh api "repos/$REPO/rulesets/$REVIEW_ID")
REVIEW_BYPASS=$(echo "$REVIEW_DETAIL" | jq -r '.bypass_actors[] | select(.actor_id==5 and .actor_type=="RepositoryRole") | .bypass_mode')

OK=1
[ "$CI_CHECK_COUNT" = "$COUNT" ]   || { echo "FEJL: CI-gate har $CI_CHECK_COUNT checks, forventede $COUNT" >&2; OK=0; }
[ "$CI_BYPASS_COUNT" = "0" ]       || { echo "FEJL: CI-gate har bypass-actors, burde vaere 0" >&2; OK=0; }
[ "$REVIEW_BYPASS" = "pull_request" ] || { echo "FEJL: review-gate bypass_mode er '$REVIEW_BYPASS', forventede 'pull_request'" >&2; OK=0; }

if [ "$OK" = "1" ]; then
  echo ""
  echo "OK. To rulesets er aktive:"
  echo "  main-ci-gate:     $COUNT checks, ingen bypass (CI gaelder alle)"
  echo "  main-review-gate: 1 review kraevet, admin bypasser via pull_request"
  echo ""
  echo "Naeste skridt:"
  echo "  1. Test som ikke-admin: review kraeves"
  echo "  2. Slet klassisk protection: GitHub > Settings > Branches > main > delete"
  echo "  3. Test begge scenarier igen"
  echo ""
  echo "  UNDO: slet rulesets under Settings > Rules"
  echo "        og kour: bash scripts/apply-collab-branch-protection.sh"
else
  echo ""
  echo "FEJL: post-verify fejlede. Se output ovenfor." >&2
  exit 1
fi
