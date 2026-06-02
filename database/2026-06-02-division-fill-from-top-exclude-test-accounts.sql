-- #962 opfølgning: den første fyld-fra-toppen-migration
-- (2026-06-02-division-fill-from-top.sql) ekskluderede AI og frosne hold, men
-- IKKE test-konti (is_test_account). Test-konti er usynlige på ranglisten
-- (StandingsPage filtrerer is_ai/is_test_account/is_frozen), men de spiste alligevel
-- pladser i div 1 og skubbede rigtige hold ned i div 2 — så div 1 viste 17 hold
-- mens 3 rigtige hold lå i div 2 trods ledig plads.
--
-- Denne migration kører fyld-fra-toppen igen med samme "rigtige hold"-filter som
-- ranglisten, så kun aktive ikke-test menneske-hold tæller mod kapaciteten.
-- Test-konti (og AI/frosne) beholder deres nuværende division og tæller ikke med.
--
-- Grænserne 20/40 = DIVISION_CAPACITY (20) hhv. 2×DIVISION_CAPACITY (se
-- backend/lib/economyConstants.js). Hold dem i sync hvis kapaciteten ændres.
--
-- Idempotent: kun rækker hvis division faktisk skifter opdateres.
--
-- Rollback (sætter alle rigtige hold tilbage i div 3):
--   UPDATE teams SET division = 3
--   WHERE is_ai = false AND is_test_account = false AND is_frozen = false;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM teams
  WHERE is_ai = false AND is_test_account = false AND is_frozen = false
)
UPDATE teams t
SET division = CASE
  WHEN r.rn <= 20 THEN 1
  WHEN r.rn <= 40 THEN 2
  ELSE 3
END
FROM ranked r
WHERE t.id = r.id
  AND t.division IS DISTINCT FROM (CASE
    WHEN r.rn <= 20 THEN 1
    WHEN r.rn <= 40 THEN 2
    ELSE 3
  END);
