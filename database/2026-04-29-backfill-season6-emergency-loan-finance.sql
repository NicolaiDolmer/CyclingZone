-- Backfill season_id for season 6 emergency-loan finance rows created by
-- season-end repair before createEmergencyLoan wrote season_id.
--
-- Expected live rows before this migration: 3 rows, for the season 6
-- emergency loans created on 2026-04-29.

WITH target_season AS (
  SELECT id
  FROM seasons
  WHERE number = 6
  LIMIT 1
)
UPDATE finance_transactions ft
SET season_id = (SELECT id FROM target_season)
WHERE ft.type = 'emergency_loan'
  AND ft.season_id IS NULL
  AND ft.created_at >= TIMESTAMPTZ '2026-04-29 00:00:00+00'
  AND ft.created_at < TIMESTAMPTZ '2026-04-30 00:00:00+00'
  AND EXISTS (
    SELECT 1
    FROM loans l
    WHERE l.team_id = ft.team_id
      AND l.loan_type = 'emergency'
      AND l.status = 'active'
  );
