-- #1236: plan_start_season_number ruller ikke frem ved plan-udløb.
--
-- Bug: economyEngine.processSeasonEnd nulstillede seasons_completed/cumulative_*
-- og satte negotiation_status='pending' ved plan-udløb, men rullede IKKE
-- plan_start_season_number frem til den nye cyklus. /board/status filtrerer
-- snapshots på season_number >= plan_start_season_number (NULL behandles som 0
-- via `|| 0`-fallback i api.js), så den udløbne plans gamle sæsoner talte med
-- i den nye plan-cyklus. Koden ruller nu vinduet frem ved udløb
-- (economyEngine.js, planIsComplete-branchen).
--
-- Denne backfill retter KUN boards der beviseligt er i den forkerte state:
--   1. negotiation_status='pending' med udløbs-reset-signaturen
--      (seasons_completed=0, cumulative_stage_wins=0, cumulative_gc_wins=0)
--      — præcis det aftryk processSeasonEnd's udløbs-reset efterlader,
--   2. plan_start_season_number er NULL eller peger på en tidligere sæson,
--   3. OG mindst ét snapshot fra en TIDLIGERE sæson fanges stadig af
--      /board/status-filteret (EXISTS) — dvs. forrige cyklus lækker observerbart
--      ind i den nye plan.
--
-- Verificeret mod prod 2026-06-10 (aktiv sæson = 2): rammer præcis 3 rows —
-- 1yr-boards for test-a/test-b/test-seller, alle pending med plan_start NULL
-- og ét sæson-1-snapshot fra den udløbne cyklus. Aktive planer
-- (negotiation_status='completed'), baseline-rows og pending boards uden
-- lækkende snapshots røres ikke. En plan der reelt startede i sæson 1 og
-- stadig kører beholder sæson 1 (design-note i #1236).
--
-- Idempotent: efter kørslen er plan_start_season_number = aktiv sæson, så
-- hverken stale-betingelsen (start < aktiv) eller EXISTS-betingelsen
-- (snapshot >= start OG < aktiv) kan matche rowen igen — heller ikke ved
-- senere re-runs i fremtidige sæsoner.

UPDATE board_profiles bp
SET plan_start_season_number = act.number,
    plan_end_season_number = act.number
      + CASE bp.plan_type WHEN '5yr' THEN 5 WHEN '3yr' THEN 3 WHEN '1yr' THEN 1 END
      - 1,
    updated_at = now()
FROM (
  SELECT number
  FROM seasons
  WHERE status = 'active'
  ORDER BY number DESC
  LIMIT 1
) act
WHERE bp.negotiation_status = 'pending'
  AND COALESCE(bp.is_baseline, false) = false
  AND bp.plan_type IN ('1yr', '3yr', '5yr')
  AND COALESCE(bp.seasons_completed, 0) = 0
  AND COALESCE(bp.cumulative_stage_wins, 0) = 0
  AND COALESCE(bp.cumulative_gc_wins, 0) = 0
  AND (bp.plan_start_season_number IS NULL OR bp.plan_start_season_number < act.number)
  AND EXISTS (
    SELECT 1
    FROM board_plan_snapshots sn
    WHERE sn.board_id = bp.id
      AND sn.season_number < act.number
      AND sn.season_number >= COALESCE(bp.plan_start_season_number, 0)
  );
