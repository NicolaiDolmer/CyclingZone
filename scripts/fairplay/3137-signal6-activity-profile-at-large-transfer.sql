-- =============================================================================
-- Signal 6 — Activity profile at large transfers  (#3137, epic #3131)
-- =============================================================================
-- Question: at the moment of a big human-to-human value move, how engaged was
-- this account? Per the issue: "En konto der flytter 650k uden at have kørt
-- et løb er anomal uanset pris" — this signal ignores price entirely and
-- looks only at engagement (level, XP, login streak, race participation).
--
-- Output contract: signal_name, team_id, user_id, event_at, strength, evidence
-- (see 3137-signal1-account-age-at-transaction.sql for the full description).
--
-- Design notes:
--
-- 1. Reuses the same human-counterparty "big transaction" scope as signals 1
--    and 2 (see 3137-signal1-account-age-at-transaction.sql note 1 for why
--    bank/AI-seeded auctions are excluded).
--
-- 2. "Has raced before the transaction" checks race_entries joined to races
--    with status='completed' and a scheduled_for at or before the flagged
--    transaction — i.e. did this team have any actual on-track history when
--    it moved this money, not merely "has a team been created". Verified
--    2026-08-03 against the known gwshare case (#3137 issue body): the
--    account's transfer_purchase happened same-day as team creation, before
--    any race had been completed for that team — this signal correctly
--    fires for it (level=1, xp=0, no completed races yet), matching the
--    issue's expectation that gwshare should surface via SOME signal even
--    though it's a known non-cheating case.
--
-- 3. strength = 0.30*race_score + 0.25*level_score + 0.20*xp_score +
--    0.10*streak_score + 0.15*size_score. Weighted toward "never raced" per
--    the issue's own framing of that as the sharpest sub-component.
--
-- Window: last 90 days.
-- =============================================================================

WITH big_tx AS (
  SELECT ft.id AS tx_id, ft.team_id, ft.amount, ft.created_at, ft.reason_code,
         a.rider_id, a.seller_team_id AS counterparty_team_id
  FROM finance_transactions ft
  JOIN auctions a ON a.id = ft.related_entity_id AND ft.related_entity_type = 'auction'
  JOIN teams seller ON seller.id = a.seller_team_id
  WHERE ft.reason_code = 'auction_winner_payment'
    AND seller.is_ai = false AND seller.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code, tro.rider_id, tro.seller_team_id
  FROM finance_transactions ft
  JOIN transfer_offers tro ON tro.id = ft.related_entity_id AND ft.related_entity_type = 'transfer'
  JOIN teams seller ON seller.id = tro.seller_team_id
  WHERE ft.reason_code = 'transfer_purchase'
    AND seller.is_ai = false AND seller.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code, a.rider_id, a.current_bidder_id
  FROM finance_transactions ft
  JOIN auctions a ON a.id = ft.related_entity_id AND ft.related_entity_type = 'auction'
  JOIN teams buyer ON buyer.id = a.current_bidder_id
  WHERE ft.reason_code = 'auction_seller_payout'
    AND buyer.is_ai = false AND buyer.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'

  UNION ALL

  SELECT ft.id, ft.team_id, ft.amount, ft.created_at, ft.reason_code, tro.rider_id, tro.buyer_team_id
  FROM finance_transactions ft
  JOIN transfer_offers tro ON tro.id = ft.related_entity_id AND ft.related_entity_type = 'transfer'
  JOIN teams buyer ON buyer.id = tro.buyer_team_id
  WHERE ft.reason_code = 'transfer_sale'
    AND buyer.is_ai = false AND buyer.is_test_account = false
    AND ft.created_at >= now() - interval '90 days'
),
raced_before AS (
  SELECT bt.tx_id,
    EXISTS (
      SELECT 1
      FROM race_entries re
      JOIN races ra ON ra.id = re.race_id
      WHERE re.team_id = bt.team_id
        AND ra.status = 'completed'
        AND ra.scheduled_for <= bt.created_at
    ) AS has_raced_before_tx
  FROM big_tx bt
)
SELECT
  'lifecycle_activity_profile_at_large_transfer' AS signal_name,
  bt.team_id,
  u.id AS user_id,
  bt.created_at AS event_at,
  round((
    0.30 * (NOT rb.has_raced_before_tx)::int
    + 0.25 * (CASE WHEN u.level <= 1 THEN 1 WHEN u.level <= 3 THEN 0.5 ELSE 0 END)
    + 0.20 * (CASE WHEN u.xp = 0 THEN 1 WHEN u.xp < 100 THEN 0.5 ELSE 0 END)
    + 0.10 * (CASE WHEN u.login_streak <= 1 THEN 1 WHEN u.login_streak <= 3 THEN 0.5 ELSE 0 END)
    + 0.15 * least(1, abs(bt.amount) / 500000.0)
  )::numeric, 3) AS strength,
  jsonb_build_object(
    'team_name', t.name,
    'user_email', u.email,
    'tx_at', bt.created_at,
    'amount', bt.amount,
    'direction', CASE WHEN bt.amount < 0 THEN 'spent' ELSE 'received' END,
    'reason_code', bt.reason_code,
    'rider_id', bt.rider_id,
    'rider_name', trim(concat(r.firstname, ' ', r.lastname)),
    'level', u.level,
    'xp', u.xp,
    'login_streak', u.login_streak,
    'has_raced_before_tx', rb.has_raced_before_tx
  ) AS evidence
FROM big_tx bt
JOIN teams t ON t.id = bt.team_id
JOIN users u ON u.id = t.user_id
LEFT JOIN riders r ON r.id = bt.rider_id
JOIN raced_before rb ON rb.tx_id = bt.tx_id
WHERE t.is_ai = false AND t.is_test_account = false
  AND u.email NOT ILIKE '%@cyclingzone.dev'
ORDER BY strength DESC;
