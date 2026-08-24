#!/usr/bin/env bash
# Saetter godkendelsesgaten paa main, saa intet kan merges uden ejer-review.
#
# Baggrund: da eksterne hjaelpere fik write-adgang var main reelt aaben:
# required_pull_request_reviews var null, saa enhver collaborator kunne merge
# sin egen PR (og pushe direkte til main).
#
# Scriptet er idempotent og kan koeres igen. Det LAESER de eksisterende
# required status checks og skriver dem tilbage uaendret, saa de 24 checks
# ikke tabes af et PUT der overskriver hele protection-objektet.
#
# Bevidste valg:
#   enforce_admins: false   -> ejeren beholder direkte push af chore/docs til
#                              main, og kan bypasse review paa egne PR'er
#                              (GitHub tillader ikke selv-godkendelse).
#   restrictions: null      -> "restrict who can push" findes kun paa
#                              org-ejede repos. Ikke noedvendigt: naar review
#                              er paakraevet, kan non-admins ikke pushe til main.
#
# Brug:  bash scripts/apply-collab-branch-protection.sh [--dry-run]

set -euo pipefail

REPO="NicolaiDolmer/CyclingZone"
BRANCH="main"
OWNER="NicolaiDolmer"
DRY_RUN=0

[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

echo "==> Laeser eksisterende protection paa $REPO@$BRANCH"
CURRENT=$(gh api "repos/$REPO/branches/$BRANCH/protection")

STRICT=$(echo "$CURRENT" | jq '.required_status_checks.strict')
CONTEXTS=$(echo "$CURRENT" | jq -c '.required_status_checks.contexts')
COUNT=$(echo "$CONTEXTS" | jq 'length')

echo "    Bevarer $COUNT required status checks (strict=$STRICT)"

if [ "$COUNT" -lt 20 ]; then
  echo "STOP: forventede mindst 20 required checks, fandt $COUNT." >&2
  echo "Skriv ikke videre - det ville svaekke gaten i stedet for at stramme den." >&2
  exit 1
fi

PAYLOAD=$(jq -n \
  --argjson strict "$STRICT" \
  --argjson contexts "$CONTEXTS" \
  '{
    required_status_checks: { strict: $strict, contexts: $contexts },
    enforce_admins: false,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 1
    },
    restrictions: null
  }')

if [ "$DRY_RUN" = "1" ]; then
  echo "==> DRY RUN. Payload der ville blive sendt:"
  echo "$PAYLOAD" | jq '.required_pull_request_reviews, {enforce_admins}, {checks: (.required_status_checks.contexts | length)}'
  exit 0
fi

echo "==> Skriver protection"
echo "$PAYLOAD" | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - > /dev/null

echo "==> Verificerer"
AFTER=$(gh api "repos/$REPO/branches/$BRANCH/protection")

echo "$AFTER" | jq '{
  required_reviews: .required_pull_request_reviews.required_approving_review_count,
  code_owner_review: .required_pull_request_reviews.require_code_owner_reviews,
  dismiss_stale: .required_pull_request_reviews.dismiss_stale_reviews,
  enforce_admins: .enforce_admins.enabled,
  checks_bevaret: (.required_status_checks.contexts | length)
}'

OK=1
[ "$(echo "$AFTER" | jq -r '.required_pull_request_reviews.required_approving_review_count')" = "1" ] || OK=0
[ "$(echo "$AFTER" | jq -r '.required_pull_request_reviews.require_code_owner_reviews')" = "true" ] || OK=0
[ "$(echo "$AFTER" | jq -r '.required_pull_request_reviews.dismiss_stale_reviews')" = "true" ] || OK=0
[ "$(echo "$AFTER" | jq -r '.required_status_checks.contexts | length')" = "$COUNT" ] || OK=0

if [ "$OK" = "1" ]; then
  echo "OK: godkendelsesgate aktiv. Ingen PR kan merges uden review fra @$OWNER."
else
  echo "FEJL: post-verify matchede ikke forventningen. Se output ovenfor." >&2
  exit 1
fi
