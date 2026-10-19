-- #6514 · Kalenderens løbskort, status-prikken og Løbshistorik bag et
-- stadie-flag (off | beta | on).
--
-- EJER 15/10: byg bag beta-flag; kalenderen bevares for alle andre. Startstadiet
-- er `off`: intet ændrer sig før ejeren flytter flaget fra admin-fladen. I
-- `beta` ser kun beta-testere (users.is_beta_tester eller role = 'admin', se
-- isViewerBetaTester i backend/routes/api.js) de nye flader.
--
-- Evalueres via GET /api/races/race-library-v2 (backend/lib/raceLibraryV2Flag.js)
-- og læses af CalendarPage.jsx og ResultaterPage.jsx. Står i STAGE_FLAGS, så
-- ejeren kan flytte den fra admin-fladen.
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren
-- allerede har flyttet. Apply sker post-merge (auto-migrate.yml, #2642).
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'race_library_v2';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'race_library_v2',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for #6514: race card on calendar click, missing-selection dot, and Race history under Results. beta = beta testers only; everyone else keeps the current calendar and archive.'
)
ON CONFLICT (key) DO NOTHING;
