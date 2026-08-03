-- =============================================================================
-- Signal 1/6 — Account age at transaction  (#3137, epic #3131, refs #2226 #2776)
-- =============================================================================
-- Question: how old was the account when it moved real (human-to-human) value?
--
-- Output contract (shared across all six #3137 signals, feeds #3138 scoring):
--   signal_name  text       -- fixed literal for this signal
--   team_id      uuid
--   user_id      uuid
--   event_at     timestamptz -- anchor timestamp of the flagged event
--   strength     numeric(4,3) -- 0.000-1.000, higher = more suspicious. This is a
--                               PER-SIGNAL heuristic score, not a final verdict.
--                               #3138 owns weighting/combination across signals.
--   evidence     jsonb       -- human-readable fields backing the number
--
-- Design notes (read before tuning thresholds):
--
-- 1. "Big transaction" here is scoped to HUMAN-COUNTERPARTY value moves only
--    (auction win against a real seller team, or a direct transfer_offers
--    trade). Bank/AI/system-seeded auctions (seller_team_id IS NULL, or
--    seller is_ai=true) are EXCLUDED on purpose: starting capital + day-1 loan
--    capacity is unlimited-supply NPC money by design, so a brand-new account
--    spending big against the bank on day 0 is normal onboarding, not a
--    fair-play concern. Verified empirically 2026-08-03: with this scoping,
--    only ONE row in the last 90 days clears "age < 2h" (the known gwshare
--    case, #3137 issue body) — without the human-counterparty filter, ~150+
--    ordinary day-0 starter purchases matched (pure noise, see audit report).
--
-- 2. OUTER JOIN discipline (#2776 lesson): auctions.seller_team_id is NULL for
--    ~47% of rows (system/academy/bank auctions). Enrichment joins below use
--    LEFT JOIN on the seller side everywhere, even though this signal filters
--    TO human sellers — so a system auction is never silently dropped by an
--    accidental INNER JOIN if this query is later adapted.
--
-- 3. Strength formula: 0.6 * age_score + 0.4 * size_score, age_score decays
--    linearly from 1.0 (age=0) to 0.0 (age>=14 days), size_score caps at 1.0
--    at amount>=500k. This is a starting curve for #3138 to recalibrate, not
--    a tuned model (n=1 known-positive is not enough to fit a curve on).
--
-- Window: last 90 days (per issue acceptance criteria). Change the interval
-- below to widen/narrow.
-- =============================================================================

WITH big_tx AS (
  -- auction wins where the seller is a real, non-AI, non-test human team
  SELECT ft.id AS tx_id, ft.team_id, ft.amount, ft.created_at, ft.reason_code,
         a.rider_id, a.seller_team_id AS counterparty_team_id, 'auction' AS tx_kind
  FROM finance_transactions ft
  JOIN auctions a ON a.id = ft.related_entity_id AND ft.related_entity_type = 'auction'
  JOIN teams seller ON seller.id = a.seller_team_id  -- LEFT would just re-admit system auctions we deliberately exclude here; kept INNER intentionally, see note 1 above
  WHERE ft.reason_code = 'auction_winner_payment'
    AND seller.is_ai = false AND seller.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code,
         tro.rider_id, tro.seller_team_id, 'transfer'
  FROM finance_transactions ft
  JOIN transfer_offers tro ON tro.id = ft.related_entity_id AND ft.related_entity_type = 'transfer'
  JOIN teams seller ON seller.id = tro.seller_team_id
  WHERE ft.reason_code = 'transfer_purchase'
    AND seller.is_ai = false AND seller.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  -- symmetric: a human account RECEIVING a big payout from another human buyer
  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code,
         a.rider_id, a.current_bidder_id, 'auction'
  FROM finance_transactions ft
  JOIN auctions a ON a.id = ft.related_entity_id AND ft.related_entity_type = 'auction'
  JOIN teams buyer ON buyer.id = a.current_bidder_id
  WHERE ft.reason_code = 'auction_seller_payout'
    AND buyer.is_ai = false AND buyer.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code,
         tro.rider_id, tro.buyer_team_id, 'transfer'
  FROM finance_transactions ft
  JOIN transfer_offers tro ON tro.id = ft.related_entity_id AND ft.related_entity_type = 'transfer'
  JOIN teams buyer ON buyer.id = tro.buyer_team_id
  WHERE ft.reason_code = 'transfer_sale'
    AND buyer.is_ai = false AND buyer.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'
)
SELECT
  'lifecycle_account_age_at_transaction' AS signal_name,
  bt.team_id,
  u.id AS user_id,
  bt.created_at AS event_at,
  round((
    0.6 * greatest(0, 1 - extract(epoch FROM (bt.created_at - u.created_at)) / 86400.0 / 14.0)
    + 0.4 * least(1, abs(bt.amount) / 500000.0)
  )::numeric, 3) AS strength,
  jsonb_build_object(
    'team_name', t.name,
    'user_email', u.email,
    'user_created_at', u.created_at,
    'tx_at', bt.created_at,
    'account_age_hours', round((extract(epoch FROM (bt.created_at - u.created_at)) / 3600.0)::numeric, 2),
    'amount', bt.amount,
    'direction', CASE WHEN bt.amount < 0 THEN 'spent' ELSE 'received' END,
    'reason_code', bt.reason_code,
    'tx_kind', bt.tx_kind,
    'rider_id', bt.rider_id,
    'rider_name', trim(concat(r.firstname, ' ', r.lastname)),
    'counterparty_team_id', bt.counterparty_team_id,
    'counterparty_team_name', cp.name
  ) AS evidence
FROM big_tx bt
JOIN teams t ON t.id = bt.team_id
JOIN users u ON u.id = t.user_id
LEFT JOIN riders r ON r.id = bt.rider_id
LEFT JOIN teams cp ON cp.id = bt.counterparty_team_id  -- OUTER: counterparty already guaranteed human by big_tx CTE, but keep LEFT for defensive robustness
WHERE t.is_ai = false AND t.is_test_account = false
  AND u.email NOT ILIKE '%@cyclingzone.dev'  -- owner's own test accounts (#3135 known-FP list)
  AND (bt.created_at - u.created_at) <= interval '30 days'  -- beyond this, age_score ~0 and row is noise
ORDER BY strength DESC;

-- Verification query (run manually): confirms a system/bank auction row
-- (seller_team_id IS NULL) is never silently produced by this signal, i.e.
-- our INNER JOIN on `seller` above is a deliberate exclusion, not an
-- accidental drop. Example system auction verified 2026-08-03:
--   SELECT id, rider_id, seller_team_id FROM auctions
--   WHERE id = 'be15ed5e-e936-4e5b-9056-d3e4e1549bca'; -- seller_team_id IS NULL (academy_signing)
-- That auction's finance_transactions row is correctly excluded from big_tx
-- above (fails the `seller.is_ai=false` join), NOT because of a broken outer
-- join, but because of the deliberate human-counterparty scope (note 1).
