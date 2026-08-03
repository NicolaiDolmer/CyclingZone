-- =============================================================================
-- Signal 2 — Account lifetime AFTER the transaction  (#3137, epic #3131)
-- =============================================================================
-- Question: did the player ever come back after moving big value? Per the
-- issue: "En konto der forsvinder umiddelbart efter en stor overførsel er det
-- stærkeste enkeltsignal" — this is meant to be the sharpest single axis.
--
-- Output contract: signal_name, team_id, user_id, event_at, strength, evidence
-- (see 3137-signal1-account-age-at-transaction.sql header for the full
-- contract description — repeated per-file on purpose so each script stays
-- standalone/testable).
--
-- Design notes:
--
-- 1. Reuses the same human-counterparty "big transaction" scope as signal 1
--    (see that file for why bank/AI-seeded auctions are excluded).
--
-- 2. Needs an OBSERVATION WINDOW: a transaction from 2 hours ago hasn't had
--    time to "come back" yet, so we only evaluate transactions at least 3
--    days old. Without this guard every very recent big transaction would
--    falsely look "abandoned".
--
-- 3. "Did they come back" uses users.last_seen (login-based) unioned with
--    ANY subsequent finance_transactions activity on the team (facility
--    purchases, prize payouts, academy signings, etc. all require an active,
--    played team, and are a stronger proxy of genuine return than a bare
--    page load). Verified 2026-08-03: the known gwshare case (#3137 issue
--    body) shows continued finance_transactions activity through 2026-08-02
--    (facility purchases, race prizes, academy signings) — i.e. this specific
--    signal correctly does NOT fire strongly for that case, consistent with
--    the issue's framing that it was likely not cheating. That is the
--    expected, correct behaviour: signal 2 is designed to catch true
--    disappearance, and gwshare did not disappear.
--
-- 4. strength = 0.8 * return_score + 0.2 * size_score, where return_score is
--    1.0 when there is NO observed activity after the transaction relative to
--    how long we've had to observe it, decaying to 0 as observed activity
--    approaches the full observation window (i.e. the account stayed as
--    active after the transaction as before it).
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
-- last observed finance activity per team AFTER the flagged transaction
subsequent_activity AS (
  SELECT bt.tx_id, max(ft2.created_at) AS last_subsequent_tx_at
  FROM big_tx bt
  LEFT JOIN finance_transactions ft2
    ON ft2.team_id = bt.team_id AND ft2.created_at > bt.created_at
  GROUP BY bt.tx_id
)
SELECT
  'lifecycle_account_lifetime_after_transaction' AS signal_name,
  bt.team_id,
  u.id AS user_id,
  bt.created_at AS event_at,
  round((
    0.8 * greatest(0, 1 - (
      extract(epoch FROM (greatest(u.last_seen, sa.last_subsequent_tx_at, bt.created_at) - bt.created_at))
      / greatest(extract(epoch FROM (now() - bt.created_at)), 1)
    ))
    + 0.2 * least(1, abs(bt.amount) / 500000.0)
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
    'last_seen', u.last_seen,
    'last_subsequent_finance_tx_at', sa.last_subsequent_tx_at,
    'hours_observed_since_tx', round((extract(epoch FROM (now() - bt.created_at)) / 3600.0)::numeric, 1),
    'hours_of_activity_after_tx', round((
      extract(epoch FROM (greatest(u.last_seen, sa.last_subsequent_tx_at, bt.created_at) - bt.created_at)) / 3600.0
    )::numeric, 1)
  ) AS evidence
FROM big_tx bt
JOIN teams t ON t.id = bt.team_id
JOIN users u ON u.id = t.user_id
LEFT JOIN riders r ON r.id = bt.rider_id
LEFT JOIN subsequent_activity sa ON sa.tx_id = bt.tx_id
WHERE t.is_ai = false AND t.is_test_account = false
  AND u.email NOT ILIKE '%@cyclingzone.dev'
  AND bt.created_at <= now() - interval '3 days'  -- observation-window guard, see note 2
ORDER BY strength DESC;
