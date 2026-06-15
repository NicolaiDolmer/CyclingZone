-- Evne-system v2 / Plan 2 (#1122) — fysiologi-fundament.
-- Tilføj 3 fysiologi-metrics (power_2m_wkg, power_10m_wkg, aero) som NULLABLE; de
-- fyldes af backfillRacePhysiology.js umiddelbart efter migration. MAP = vo2max_power_wkg
-- (allerede korrekt navngivet — INGEN rename). power_5m_wkg + rider_derived_abilities.prolog
-- DEPRECERES (motoren/derivationen holder op med at bruge dem) men DROPPES IKKE her
-- (ejer-valg "deprecér nu, drop senere" — reversibelt; hard-drop i senere cleanup-migration).
-- Udvider desuden source CHECK med 'seeded_archetype' (arketype-seedet launch-population).
--
-- rider_physiology_profiles bruger table-RLS (select_authenticated USING(true)) — nye
-- kolonner er auto-læsbare for authenticated, INGEN per-kolonne-GRANT nødvendig (modsat
-- rider_derived_abilities/riders som bruger kolonne-privilegier, jf. #1162/#1309).
-- Idempotent: ADD COLUMN IF NOT EXISTS. schema_migrations-insert: auto-migrate.yml.

ALTER TABLE public.rider_physiology_profiles
  ADD COLUMN IF NOT EXISTS power_2m_wkg  NUMERIC(4,2),  -- anaerob/puncheur (Hills-loft)
  ADD COLUMN IF NOT EXISTS power_10m_wkg NUMERIC(4,2),  -- VO2/Mid-mountain (TMAP-anker)
  ADD COLUMN IF NOT EXISTS aero          NUMERIC(4,3);  -- 0.000-1.000 aerodynamisk effektivitet (TT/flad)

COMMENT ON COLUMN public.rider_physiology_profiles.power_5m_wkg IS
  'DEPRECERET (Plan 2, #1122): erstattet af vo2max_power_wkg (=MAP, kanonisk 5-min-anker). Beholdes nullable til cleanup-migration; læses ikke længere af abilityDerivation.';
COMMENT ON COLUMN public.rider_physiology_profiles.power_2m_wkg IS 'Plan 2 (#1122): 2-min power W/kg — punch/Hills-loft.';
COMMENT ON COLUMN public.rider_physiology_profiles.power_10m_wkg IS 'Plan 2 (#1122): 10-min power W/kg — tempo/Mid-mountain (TMAP).';
COMMENT ON COLUMN public.rider_physiology_profiles.aero IS 'Plan 2 (#1122): aerodynamisk effektivitet 0-1 — time_trial + flat.';

COMMENT ON COLUMN public.rider_derived_abilities.prolog IS
  'DEPRECERET (Plan 2, #1122): merged ind i time_trial (ITT-split inferes fra profil). Beholdes nullable til cleanup-migration; skrives ikke længere af abilityDerivation (formula_version=3).';

-- Plan 2 (#1122): tillad 'seeded_archetype' som provenance for arketype-seedet
-- fysiologi (fiktiv launch-population). Idempotent (DROP IF EXISTS + ADD).
ALTER TABLE public.rider_physiology_profiles DROP CONSTRAINT IF EXISTS rider_physiology_profiles_source_check;
ALTER TABLE public.rider_physiology_profiles ADD CONSTRAINT rider_physiology_profiles_source_check
  CHECK (source IN ('seeded_from_legacy','manual_admin','import','training_update','seeded_archetype'));

-- PostgREST schema-cache reload (GRANT/kolonne-ændringer trigges normalt af
-- pgrst_ddl_watch, men eksplicit NOTIFY koster intet og fjerner al tvivl).
NOTIFY pgrst, 'reload schema';
