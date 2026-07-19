-- =============================================================================
-- 2026-07-19 — Drop ubrugte kolonner season_budget_baseline/season_budget_season (#2590)
-- =============================================================================
-- BAGGRUND: 2026-07-05-daily-training-season-budget-cap.sql (#2082/#1938)
-- tilfoejede de to kolonner paa rider_derived_abilities til at spore akademi-
-- ryttarnes saeson-budget-loft. #2437 (interim-modellen, rate/3) fjernede
-- saeson-loftet helt — motoren (backend/lib/dailyTrainingEngine.js) skriver
-- dem IKKE laengere (se kommentaren ved abilityPatch-opbygningen). #2437-
-- close-out 15/7 noterede drop som opfoelgning; noten faldt ud af NOW.md ved
-- 16/7-close-out og blev fanget igen ved session-audit 17/7 (#2590).
--
-- BACKWARDS-CHECK (17/7, grep + runtime): INGEN backend/frontend/scripts-kode
-- laeser season_budget_baseline/season_budget_season laengere. De eneste
-- resterende referencer er (a) den oprindelige ADD COLUMN-migration (historik,
-- roeres ikke), (b) et forward-guard-lint-allowlist + dets test-fixtures
-- (scripts/lint-riders-column-grant.mjs — skal blive staaende, ellers fejler
-- linten paa den historiske ADD COLUMN i (a)), og (c) test-assertions i
-- backend/lib/dailyTrainingEngine.test.js der bekraefter motoren IKKE skriver
-- felterne (adfaerds-test, ikke en skema-afhaengighed — forbliver korrekte
-- efter drop).
--
-- KLIENT-GRANT: ingen — kolonnerne blev BEVIDST aldrig grantet til
-- anon/authenticated (fail-closed, jf. header i 2026-07-05-migrationen).
-- DROP COLUMN kraever derfor ingen REVOKE-oprydning.
--
-- BACKUP (konvention for destruktive kolonne-drops, jf. #2590-issue-teksten):
-- 571 af 6918 raekker har ikke-NULL vaerdier i dag (stale foer #2437-cutover).
-- Snapshot til en dedikeret backup-tabel foer drop, saa data kan tilgaas hvis
-- der alligevel skulle vaere behov (lav sandsynlighed — ren backend-bogfoering,
-- ingen spiller-vendt flade nogensinde laest den).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + backfill kun naar backup-tabellen
-- er tom; DROP COLUMN IF EXISTS paa begge kolonner (re-run = no-op).
-- Rollback: ALTER TABLE public.rider_derived_abilities ADD COLUMN
--   season_budget_baseline jsonb, ADD COLUMN season_budget_season integer;
--   derefter genindsaet fra backup_2590_season_budget_20260719 paa rider_id.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.backup_2590_season_budget_20260719 (
  rider_id uuid PRIMARY KEY,
  season_budget_baseline jsonb,
  season_budget_season integer,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.backup_2590_season_budget_20260719
  (rider_id, season_budget_baseline, season_budget_season)
SELECT rider_id, season_budget_baseline, season_budget_season
FROM public.rider_derived_abilities
WHERE (season_budget_baseline IS NOT NULL OR season_budget_season IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.backup_2590_season_budget_20260719 LIMIT 1);

ALTER TABLE public.rider_derived_abilities
  DROP COLUMN IF EXISTS season_budget_baseline,
  DROP COLUMN IF EXISTS season_budget_season;

NOTIFY pgrst, 'reload schema';

-- VERIFIKATION (efter apply):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='rider_derived_abilities' AND column_name LIKE 'season_budget%';
--   → 0 raekker.
--   SELECT count(*) FROM public.backup_2590_season_budget_20260719;
--   → 571 (antal raekker der havde data foer droppet).
