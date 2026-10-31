-- #7003 · Taktik: etapeplan langs ruten bag et stadie-flag (off | beta | on).
--
-- EJER 25/10 (spec 2026-10-25-taktik-roller-design.md §11 punkt 2): hver rytter
-- faar en kort kaede af opgaver, der skifter ved rutens punkter eller "naar han er
-- sat". Startstadiet er `off`: intet aendrer sig foer ejeren flytter flaget fra
-- admin-fladen. Planen virker desuden kun i loeb paa motor-revisionen
-- s5_profiles_v3 (slukket), saa et flag-flip alene aendrer ingen etape i dag.
--
-- Additiv: kun en app_config-raekke. Kaeden gemmes i den eksisterende jsonb-kolonne
-- race_team_orders.riders (felt `plan` pr. rytter), saa ingen tabel aendres.
-- Evalueres af backend/lib/stagePlanApi.js (isStagePlanEnabled) i GET/PUT
-- /api/races/:raceId/team-orders. Staar i STAGE_FLAGS (backend/lib/stageFlagCatalog.js).
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren
-- allerede har flyttet. Apply sker post-merge (auto-migrate.yml, #2642).
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'stage_plan_v1';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'stage_plan_v1',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the tactics stage plan along the route (#7003): a short chain of tasks per rider that switches at the route''s climbs, the last km or when the rider is dropped. Only used by races on rules revision s5_profiles_v3. beta = beta testers only.'
)
ON CONFLICT (key) DO NOTHING;
