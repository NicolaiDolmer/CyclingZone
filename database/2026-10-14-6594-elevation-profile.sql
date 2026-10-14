-- [#6594] Højdeprofil pr. etape: ny nullable kolonne race_stage_profiles.elevation_profile.
--
-- Spec: docs/superpowers/specs/2026-10-14-6594-hoejdeprofil-design.md (ejer-go 14/10).
-- Generator: backend/lib/routeElevationProfile.js (kaldt fra toStageS5, kun S5 / generator v6).
--
-- HVAD DEN GØR
--   Tilføjer elevation_profile jsonb NULL: {"v":1,"step_km":0.5,"h":[...]} — én højde (hele meter)
--   pr. 0,5 km fra start til mål. Σ max(0, h[i+1] − h[i]) = elevation_gain_m (håndhævet i kode + test,
--   ikke som CHECK).
--
-- HVAD DEN BEVIDST IKKE GØR
--   · Ingen række ændres (ingen UPDATE/INSERT/DELETE, ingen backfill). S1-S4 forbliver NULL, og
--     flader falder tilbage til dagens tegning.
--   · Motoren læser ikke kolonnen (den læser segments/climbs/distance_km som før).
--   · Ingen CHECK-constraint og ingen default.
--
-- Additiv og idempotent (ADD COLUMN IF NOT EXISTS). Apply sker POST-MERGE via auto-migrate.yml (#2642);
-- Claude post-verificerer.
--
-- Post-verify (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'race_stage_profiles' AND column_name = 'elevation_profile';
--   SELECT count(*) FILTER (WHERE elevation_profile IS NOT NULL) FROM public.race_stage_profiles;  -- 0 lige efter apply

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.race_stage_profiles
  ADD COLUMN IF NOT EXISTS elevation_profile jsonb;

COMMENT ON COLUMN public.race_stage_profiles.elevation_profile IS
  '#6594: højdeprofil {"v":1,"step_km":..,"h":[heltal meter pr. 0,5 km, h[0]=start, h[n]=mål]}; sum af positive deltaer = elevation_gain_m. NULL = ingen serie (S1-S4). Læses ikke af motoren.';

COMMIT;
