-- [#6369] S5-etapeprofiler, Fase 0: de nye etapetyper og afslutninger bliver LOVLIGE værdier.
--
-- Spec: docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md (design-go ejer 12/10).
-- Ordforrådet bor i backend/lib/stageProfileTypes.js (STAGE_PROFILE_TYPES / STAGE_FINALE_TYPES);
-- listerne herunder SKAL være de samme (stageProfileLegacyMapping.test.js låser det).
--
-- HVAD DEN GØR
--   1. race_stage_profiles.profile_type: + 'medium_mountain' (mellembjerg, #6360).
--   2. race_stage_profiles.finale_type:  + 'flat_sprint' (flad spurt, afløser bunch/reduced som
--      S5-navn), 'uphill_sprint' (stigende spurt, #6362), 'wall_finish' (mur, #6363).
--
-- HVAD DEN BEVIDST IKKE GØR
--   · Ingen række ændres (ingen UPDATE/INSERT/DELETE). Gamle værdier (S1-S4) forbliver gyldige.
--   · Ingen ny kolonne til underlag: underlaget bor i den eksisterende `sectors`-jsonb
--     (kind cobbles/gravel), som motoren allerede læser (se stageProfileTypes.js SECTOR_KINDS).
--   · races.engine_rules_revision røres ikke: regel-revisionen 's5_profiles_v1' er tom og slukket;
--     dens CHECK-udvidelse hører til tænd-PR'en (samme mønster som official_times_v4).
--
-- Additiv og idempotent: hver constraint droppes og genskabes bredere i samme transaktion.
-- Apply sker POST-MERGE via auto-migrate.yml (#2642); Claude post-verificerer.
--
-- Post-verify (read-only):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.race_stage_profiles'::regclass
--      AND conname IN ('race_stage_profiles_profile_type_check', 'race_stage_profiles_finale_type_check');
--   SELECT profile_type, finale_type, count(*) FROM public.race_stage_profiles GROUP BY 1, 2 ORDER BY 1, 2;

-- Lock-timeout: ADD CONSTRAINT ... CHECK tager et kort ACCESS EXCLUSIVE-lock mens eksisterende
-- rækker valideres. Fejl hurtigt (og kør igen) frem for at stå i kø bag en lang transaktion.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.race_stage_profiles
  DROP CONSTRAINT IF EXISTS race_stage_profiles_profile_type_check;

ALTER TABLE public.race_stage_profiles
  ADD CONSTRAINT race_stage_profiles_profile_type_check
  CHECK (profile_type IN ('flat', 'rolling', 'hilly', 'medium_mountain', 'mountain', 'high_mountain', 'itt', 'itt_hilly', 'ttt', 'cobbles', 'gravel', 'classic'));

ALTER TABLE public.race_stage_profiles
  DROP CONSTRAINT IF EXISTS race_stage_profiles_finale_type_check;

ALTER TABLE public.race_stage_profiles
  ADD CONSTRAINT race_stage_profiles_finale_type_check
  CHECK (finale_type IS NULL OR finale_type IN ('bunch_sprint', 'reduced_sprint', 'punch', 'long_climb', 'descent', 'solo_tt', 'breakaway', 'flat_sprint', 'uphill_sprint', 'wall_finish'));

-- Verify i samme transaktion: begge constraints kender de nye værdier, ellers rulles alt tilbage.
DO $$
DECLARE
  profile_def text;
  finale_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO profile_def
    FROM pg_constraint
   WHERE conname = 'race_stage_profiles_profile_type_check'
     AND conrelid = 'public.race_stage_profiles'::regclass;
  SELECT pg_get_constraintdef(oid) INTO finale_def
    FROM pg_constraint
   WHERE conname = 'race_stage_profiles_finale_type_check'
     AND conrelid = 'public.race_stage_profiles'::regclass;
  IF profile_def IS NULL OR position('medium_mountain' IN profile_def) = 0 OR position('classic' IN profile_def) = 0 THEN
    RAISE EXCEPTION '#6369 verify: race_stage_profiles_profile_type_check mangler medium_mountain eller en gammel værdi (%).', profile_def;
  END IF;
  IF finale_def IS NULL OR position('uphill_sprint' IN finale_def) = 0 OR position('wall_finish' IN finale_def) = 0
     OR position('flat_sprint' IN finale_def) = 0 OR position('breakaway' IN finale_def) = 0 THEN
    RAISE EXCEPTION '#6369 verify: race_stage_profiles_finale_type_check mangler en S5-værdi eller en gammel værdi (%).', finale_def;
  END IF;
  -- Ingen anden (anderledes navngiven) CHECK på samme kolonne må stå tilbage og afvise de nye værdier.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.race_stage_profiles'::regclass
       AND contype = 'c'
       AND conname NOT IN ('race_stage_profiles_profile_type_check', 'race_stage_profiles_finale_type_check')
       AND (pg_get_constraintdef(oid) LIKE '%profile_type%' OR pg_get_constraintdef(oid) LIKE '%finale_type%')
  ) THEN
    RAISE EXCEPTION '#6369 verify: en ekstra CHECK på profile_type/finale_type ville stadig afvise S5-værdierne.';
  END IF;
END $$;

COMMIT;

-- pgrst_ddl_watch reloader normalt ved DDL; eksplicit NOTIFY koster intet.
NOTIFY pgrst, 'reload schema';
