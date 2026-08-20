-- #3546 D (S3-kalender-pakke, ejer-beslutning 17/8): ny stage-profiltype "itt_hilly"
-- (kuperet enkeltstart: GT'ens ANDEN tidskørsel, i stedet for en strukturelt identisk
-- flad itt, se raceStageProfileGenerator.js's markSecondIttAsHilly). Udvider
-- profile_type-CHECK'en fra database/2026-06-06-race-stage-profiles.sql.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT kan køres flere gange uden fejl.
-- Constraint-navnet er verificeret mod PROD 17/8 (pg_get_constraintdef, read-only):
-- 'race_stage_profiles_profile_type_check' (Postgres' default unnamed-CHECK-navngivning).
--
-- IKKE anvendt under implementeringen af #3546 (ejer-mandat 18/7, #2642: migrationer
-- appliceres af Claude EFTER merge, aldrig under selve PR-arbejdet). Kalenderregenerering
-- der rent faktisk PRODUCERER itt_hilly-etaper er separat ejer-gated (samme PR-body).

ALTER TABLE public.race_stage_profiles DROP CONSTRAINT IF EXISTS race_stage_profiles_profile_type_check;
ALTER TABLE public.race_stage_profiles ADD CONSTRAINT race_stage_profiles_profile_type_check
  CHECK (profile_type IN ('flat','rolling','hilly','mountain','high_mountain','itt','itt_hilly','ttt','cobbles','classic'));
