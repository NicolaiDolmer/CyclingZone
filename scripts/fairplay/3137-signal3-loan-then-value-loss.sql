-- =============================================================================
-- Signal 3 — Loan immediately followed by value loss OUT of the team
-- (#3137, epic #3131; explicitly requested in #2776, IS the #2776 mechanic)
-- =============================================================================
-- Question: did this team take out a loan and then, shortly after, give away
-- a rider for far below market value? This is the exact #2776 signature:
-- Racing bike took a 388,349 loan, won an auction with it, then sold the
-- rider to Minisize Biking for 1 kr ~2 days later.
--
-- Output contract: signal_name, team_id, user_id, event_at, strength, evidence
-- (see 3137-signal1-account-age-at-transaction.sql for the full description).
--
-- Design notes:
--
-- 1. "Value loss" = an ACCEPTED transfer_offers row where the team is the
--    SELLER and offer_amount / rider.market_value < 0.25 (the 25% floor is
--    not arbitrary: it is the game's own bank-auction starting-price
--    convention, cited in #2776 as the natural "fire sale" cutoff). A ratio
--    near or above 1.0 is a FAIR or generous sale and must NOT fire this
--    signal — verified 2026-08-03: the gwshare-side counterparty trade (a
--    completely unrelated, fairly-priced sale at ratio=1.000 that happened to
--    also follow a loan) is correctly excluded by this threshold.
--
-- 2. Uses riders.market_value (CURRENT value) as a proxy for value-at-sale-
--    time. This is a known limitation — historical market_value isn't
--    snapshotted anywhere in the schema — flagged explicitly in `evidence`
--    via `market_value_is_current_proxy: true` so #3138 / a human reviewer
--    knows the ratio is approximate, not exact.
--
-- 3. Only the MOST RECENT loan strictly before the sale is used per fire-sale
--    event (DISTINCT ON), so a team with several small loans in the lookback
--    window doesn't produce duplicate evidence rows for the same sale.
--
-- 4. OUTER JOIN discipline (#2776's own lesson, restated in #3137): the
--    lateral enrichment below that reconstructs "how did this team acquire
--    the rider it's about to dump" LEFT JOINs auctions.seller_team_id and the
--    resulting team row. Roughly half of all auctions have seller_team_id
--    NULL (bank/academy/system auctions) — an INNER JOIN there is exactly the
--    bug #2776 called out ("rytterne var købt fra bank/AI-sælger uden
--    hold-id og et inner join smed rækkerne væk"). Verified against a real
--    system auction (id 'be15ed5e-e936-4e5b-9056-d3e4e1549bca',
--    seller_team_id IS NULL): the LEFT JOIN chain below returns a row for it
--    with acquisition_seller_team_name = NULL instead of dropping the parent
--    row, confirmed manually 2026-08-03.
--
-- 5. Lookback window for "shortly after": 7 days (matches #2776's own
--    proposed forward-guard of a 7-day new-loan lock). Widen/narrow via the
--    interval below.
--
-- Window: last 90 days.
-- =============================================================================

WITH loan_events AS (
  SELECT ft.team_id, ft.created_at AS loan_at, ft.amount AS loan_amount
  FROM finance_transactions ft
  WHERE ft.type = 'loan_received'
    AND ft.created_at >= now() - interval '90 days'
),
fire_sales AS (
  SELECT tro.id AS offer_id, tro.seller_team_id AS team_id, tro.buyer_team_id,
         tro.rider_id, tro.offer_amount, tro.created_at AS sale_at,
         r.market_value, r.firstname, r.lastname
  FROM transfer_offers tro
  JOIN riders r ON r.id = tro.rider_id
  WHERE tro.status = 'accepted'
    AND tro.created_at >= now() - interval '90 days'
    AND r.market_value > 0
    AND tro.offer_amount::numeric / r.market_value < 0.25  -- fire-sale floor, see note 1
),
-- most recent loan strictly before each fire sale, within the lookback window
latest_loan AS (
  SELECT DISTINCT ON (fs.offer_id)
    fs.offer_id, fs.team_id, fs.buyer_team_id, fs.rider_id, fs.offer_amount,
    fs.sale_at, fs.market_value, fs.firstname, fs.lastname,
    le.loan_at, le.loan_amount
  FROM fire_sales fs
  JOIN loan_events le
    ON le.team_id = fs.team_id
   AND le.loan_at BETWEEN fs.sale_at - interval '7 days' AND fs.sale_at
  ORDER BY fs.offer_id, le.loan_at DESC
),
-- enrichment: how did the seller acquire this rider? (demonstrates outer-join
-- discipline from note 4 — do NOT change these LEFT JOINs to INNER)
acquisition AS (
  SELECT DISTINCT ON (ll.offer_id)
    ll.offer_id, a.id AS acquisition_auction_id, a.current_price AS acquisition_price,
    a.seller_team_id AS acquisition_seller_team_id, a.actual_end AS acquisition_at
  FROM latest_loan ll
  LEFT JOIN auctions a
    ON a.rider_id = ll.rider_id
   AND a.current_bidder_id = ll.team_id
   AND a.actual_end <= ll.sale_at
  ORDER BY ll.offer_id, a.actual_end DESC
)
SELECT
  'lifecycle_loan_then_value_loss' AS signal_name,
  ll.team_id,
  u.id AS user_id,
  ll.sale_at AS event_at,
  round((
    0.4 * greatest(0, 1 - extract(epoch FROM (ll.sale_at - ll.loan_at)) / 3600.0 / (7 * 24.0))
    + 0.4 * greatest(0, 1 - (ll.offer_amount::numeric / ll.market_value) / 0.25)
    + 0.2 * least(1, ll.loan_amount::numeric / 300000.0)
  )::numeric, 3) AS strength,
  jsonb_build_object(
    'seller_team_name', t.name,
    'user_email', u.email,
    'loan_at', ll.loan_at,
    'loan_amount', ll.loan_amount,
    'sale_at', ll.sale_at,
    'gap_hours', round((extract(epoch FROM (ll.sale_at - ll.loan_at)) / 3600.0)::numeric, 1),
    'rider_id', ll.rider_id,
    'rider_name', trim(concat(ll.firstname, ' ', ll.lastname)),
    'offer_amount', ll.offer_amount,
    'market_value', ll.market_value,
    'market_value_is_current_proxy', true,
    'price_ratio', round((ll.offer_amount::numeric / ll.market_value)::numeric, 3),
    'buyer_team_id', ll.buyer_team_id,
    'buyer_team_name', buyer.name,
    'acquisition_auction_id', acq.acquisition_auction_id,
    'acquisition_price', acq.acquisition_price,
    'acquisition_seller_team_id', acq.acquisition_seller_team_id,
    'acquisition_seller_team_name', COALESCE(acq_seller.name, 'system/bank (seller_team_id NULL)')
  ) AS evidence
FROM latest_loan ll
JOIN teams t ON t.id = ll.team_id
JOIN users u ON u.id = t.user_id
LEFT JOIN teams buyer ON buyer.id = ll.buyer_team_id
LEFT JOIN acquisition acq ON acq.offer_id = ll.offer_id
LEFT JOIN teams acq_seller ON acq_seller.id = acq.acquisition_seller_team_id  -- OUTER: see note 4
WHERE t.is_ai = false AND t.is_test_account = false
ORDER BY strength DESC;
