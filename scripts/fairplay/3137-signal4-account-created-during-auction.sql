-- =============================================================================
-- Signal 4 — Account created WHILE an auction was running, which then bid on
-- that SAME auction  (#3137, epic #3131; this IS the precise #2776 attack)
-- =============================================================================
-- Question: was this account created in the middle of a live auction, and did
-- it then place a bid on that exact auction? #2776 timeline: kps@latitude.dk
-- created 2026-07-19 23:20:18 UTC while the Pellegrini auction (requested_start
-- 2026-07-18 12:53, actual_end 2026-07-20 20:53) was running; team "Racing
-- bike" created 2 min 29s later; bid placed on that same auction 3 min 58s
-- after account creation.
--
-- Output contract: signal_name, team_id, user_id, event_at, strength, evidence
-- (see 3137-signal1-account-age-at-transaction.sql for the full description).
--
-- IMPORTANT — read before wiring this into #3138 with a naive threshold:
--
-- This signal has a structurally HIGH base rate in this specific game and
-- must not be scored/actioned alone. Verified empirically 2026-08-03: the
-- literal definition above (account created during a running senior/non-
-- youth auction, later bid on it) matches 168 bids in the last 90 days.
-- Root cause: fast onboarding is a DELIBERATE design feature here — new
-- accounts get starter capital + day-1 loan capacity and the game's whole
-- onboarding loop is "sign up, immediately join a live auction". Nearly every
-- new player's first bid technically satisfies the literal definition. This
-- matches the issue's own framing of these six signals as weak-alone,
-- strong-in-combination; #3138 MUST require corroboration (identity
-- correlation from #3135, value deviation from #3136, or this issue's own
-- signal 3) before this one contributes materially to a flag.
--
-- To keep this signal USEFUL rather than pure noise, three scoped inputs feed
-- `strength` (not hard filters — every literal match is still returned, so
-- #3138 keeps full recall):
--   - age_at_bid: minutes between account creation and the bid (decays over
--     24h)
--   - contested_before_account_existed: a DIFFERENT human team already had a
--     bid on this exact auction before this account even existed (the #2776
--     pattern: Minisize Biking was already bidding and ran out of money
--     before kps/Racing bike existed)
--   - won_auction: did this brand-new account end up winning?
-- Youth/academy auctions (is_youth=true) are excluded entirely: they are
-- system-driven onboarding auto-fills, not organic player-vs-player bidding,
-- and dominate the noise floor if included (spot-checked 2026-08-03: nearly
-- all sub-hour "contested + won" hits before this exclusion were clusters of
-- a single new team's own starter/academy intake auctions overlapping in time
-- with unrelated cohort signups, not funnel abuse).
--
-- OUTER JOIN discipline (#2776 lesson): `seller_team_id` is not filtered on
-- at all in the core match (a bidder's identity doesn't depend on who's
-- selling), but the enrichment below still LEFT JOINs teams on it so a system
-- auction (seller_team_id NULL) is never dropped from the result set.
-- Verified against auction id '81608451-c286-44d1-9b57-68dbf2b795e3'
-- (Davide Pellegrini, the actual #2776 auction, seller_team_id now NULL after
-- the incident cascade-deleted Racing bike's team row — see audit report,
-- "#2776 verification" section, for why the ORIGINAL bidder rows no longer
-- exist to re-query): the row is preserved with
-- acquisition_seller_team_name = 'system/bank (seller_team_id NULL)' rather
-- than being silently dropped.
--
-- Window: last 90 days.
-- =============================================================================

WITH prior_human_contest AS (
  SELECT ab.auction_id,
         min(ab.bid_time) AS earliest_human_bid_time,
         (array_agg(ab.team_id ORDER BY ab.bid_time ASC))[1] AS first_bidder_team_id
  FROM auction_bids ab
  JOIN teams bt ON bt.id = ab.team_id
  WHERE bt.is_ai = false AND bt.is_test_account = false
  GROUP BY ab.auction_id
)
SELECT
  'lifecycle_account_created_during_auction' AS signal_name,
  t.id AS team_id,
  u.id AS user_id,
  ab.bid_time AS event_at,
  round((
    0.4 * greatest(0, 1 - extract(epoch FROM (ab.bid_time - u.created_at)) / 3600.0 / 24.0)
    + 0.35 * (phc.earliest_human_bid_time < u.created_at AND phc.first_bidder_team_id <> ab.team_id)::int
    + 0.25 * (CASE WHEN a.current_bidder_id = ab.team_id AND a.status = 'completed' THEN 1 ELSE 0.3 END)
  )::numeric, 3) AS strength,
  jsonb_build_object(
    'team_name', t.name,
    'user_email', u.email,
    'user_created_at', u.created_at,
    'auction_id', a.id,
    'auction_requested_start', a.requested_start,
    'auction_actual_end', a.actual_end,
    'rider_id', a.rider_id,
    'rider_name', trim(concat(r.firstname, ' ', r.lastname)),
    'bid_time', ab.bid_time,
    'bid_amount', ab.amount,
    'age_at_bid_minutes', round((extract(epoch FROM (ab.bid_time - u.created_at)) / 60.0)::numeric, 1),
    'contested_before_account_existed', (phc.earliest_human_bid_time < u.created_at AND phc.first_bidder_team_id <> ab.team_id),
    'won_auction', (a.current_bidder_id = ab.team_id AND a.status = 'completed'),
    'final_price', a.current_price,
    'seller_team_id', a.seller_team_id,
    'seller_team_name', COALESCE(seller.name, 'system/bank (seller_team_id NULL)')
  ) AS evidence
FROM auction_bids ab
JOIN auctions a ON a.id = ab.auction_id
JOIN teams t ON t.id = ab.team_id
JOIN users u ON u.id = t.user_id
JOIN prior_human_contest phc ON phc.auction_id = ab.auction_id
LEFT JOIN riders r ON r.id = a.rider_id
LEFT JOIN teams seller ON seller.id = a.seller_team_id  -- OUTER: see header note, never INNER here
WHERE ab.bid_time >= now() - interval '90 days'
  AND t.is_ai = false AND t.is_test_account = false
  AND u.email NOT ILIKE '%@cyclingzone.dev'
  AND a.is_youth = false
  AND u.created_at >= a.requested_start
  AND u.created_at <= COALESCE(a.actual_end, a.calculated_end, now())
ORDER BY strength DESC;
