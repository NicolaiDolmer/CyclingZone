-- database/2026-07-06-facilities-app-config-flag.sql
-- A4b (#2220/#1441): migrér FACILITIES_ENABLED (kode-konstant) → app_config-flag.
-- Gate i backend bliver `flag === true/"on" ELLER requester er admin`, så ejeren
-- kan teste HELE faciliteter/staff-featuren på prod mens almindelige brugere
-- intet ser indtil flaget flippes. Default false. Idempotent.
-- Flip til live: UPDATE app_config SET value='true'::jsonb WHERE key='facilities_enabled';
INSERT INTO public.app_config (key, value, description)
VALUES ('facilities_enabled', 'false'::jsonb,
  'Feature flag for faciliteter/staff-systemet (#1441 A4). false = kun admins ser /klub + /staff (preview på prod). true/"on" = live for alle. Refs #2220.')
ON CONFLICT (key) DO NOTHING;
