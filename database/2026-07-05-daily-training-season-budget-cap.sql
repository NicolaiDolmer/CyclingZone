-- =============================================================================
-- 2026-07-05 — Sæson-budget-cap for akademi-daglig-træning (#2082, #1938)
-- =============================================================================
-- PROBLEM: dailyTrainingEngine.js brugte livstids-loftet (ability_caps) DIREKTE
-- som den daglige tick-grænse, med en dage-baseret rate. Sæsonlængde er IKKE en
-- fast konstant (transfer-vinduet lukkes administrativt, ikke efter et fast
-- dagtal — sæson 1 var stadig åben efter 57+ dage, jf. #2082-diskussionen), så
-- væksten voksede ubegrænset jo længere en sæson rent faktisk varede.
-- Prod-empiri (#2082/#1938, Discord-feedback 24/6): akademi-ryttere fik +4 i en
-- signatur-evne på ÉN session; +25,3 pt/10 dage i snit, værste +156 pt/10 dage.
--
-- FIX (ejer-godkendt 5/7): sæson-budget-loft der MÆTTER ved sæsonens andel af
-- gappet (afkoblet fra sæsonlængde) + en dedikeret, aftagende akademi-rate
-- (0.16→0.11→0.08 v/alder) + en hård dags-cap (+1/evne/dag). Se
-- backend/lib/dailyTraining.js (computeAcademySeasonCeiling, hardDailyCap) +
-- backend/lib/academyFlag.js (SEASON_FRAC_BY_AGE, HARD_DAILY_CAP) +
-- backend/lib/dailyTrainingEngine.js (wiring).
--
-- Denne migration tilføjer KUN de 2 kolonner motoren bruger til at spore hvilken
-- sæson den nuværende budget-baseline hører til:
--   season_budget_baseline: snapshot af rytterens VISIBLE_ABILITIES ved sæsonens
--     første daglige tick (samme synligheds-niveau som de eksisterende evne-
--     kolonner — INGEN ny information udover hvad klienten allerede kan se).
--   season_budget_season: hvilket sæson-nummer baseline'n hører til (bruges til
--     at opdage sæsonskifte og re-snapshotte).
--
-- Kun akademi-alder-ryttere får disse felter sat (voksne rører dem aldrig — se
-- engine-koden). NULL for alle eksisterende rækker indtil deres næste tick.
--
-- Client-SELECT: BEVIDST INGEN grant (fail-closed, jf. 2026-07-02-migrationen
-- der revokede ability_caps af samme grund — season_budget_baseline er ren
-- backend-bogføring, ingen spiller-vendt flade læser den).
--
-- Idempotent: IF NOT EXISTS på begge kolonner.

ALTER TABLE public.rider_derived_abilities
  ADD COLUMN IF NOT EXISTS season_budget_baseline jsonb,
  ADD COLUMN IF NOT EXISTS season_budget_season integer;

COMMENT ON COLUMN public.rider_derived_abilities.season_budget_baseline IS
  'Snapshot af VISIBLE_ABILITIES ved indeværende sæsons første daglige træningstick (akademi-alder only). #2082/#1938.';
COMMENT ON COLUMN public.rider_derived_abilities.season_budget_season IS
  'Sæson-nummer season_budget_baseline hører til — bruges til at opdage sæsonskifte. #2082/#1938.';

NOTIFY pgrst, 'reload schema';

-- VERIFIKATION (efter apply):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='rider_derived_abilities' AND column_name LIKE 'season_budget%';
--   → 2 rækker (jsonb, integer).
--   SELECT grantee, privilege_type FROM information_schema.column_privileges
--   WHERE table_name='rider_derived_abilities' AND column_name LIKE 'season_budget%';
--   → 0 rækker for anon/authenticated (fail-closed, kun service_role).
