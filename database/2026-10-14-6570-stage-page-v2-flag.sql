-- #6570 · Etapeside 2.0 bag et stadie-flag (off | beta | on).
--
-- EJER 14/10: beta foerst for feedback, alle andre ser den nuvaerende side
-- uaendret. Startstadiet er `off`: intet aendrer sig foer ejeren flytter flaget
-- fra admin-fladen. I `beta` ser kun beta-testere (users.is_beta_tester eller
-- role = 'admin', se isViewerBetaTester i backend/routes/api.js) den nye side.
--
-- Evalueres via GET /api/races/stage-page-v2 (backend/lib/stagePageV2Flag.js)
-- og laeses af RaceDetailPage.jsx. Staar i STAGE_FLAGS, saa ejeren kan flytte
-- den fra admin-fladen.
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren
-- allerede har flyttet. Apply sker post-merge (auto-migrate.yml, #2642).
--
-- Post-verify (read-only):
--   SELECT key, value FROM public.app_config WHERE key = 'stage_page_v2';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'stage_page_v2',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the race stage page 2.0 (#6570): phase-driven stage view, sticky stage strip, Stage/Standings/Team/Tactics tabs. beta = beta testers only; everyone else keeps the current race page.'
)
ON CONFLICT (key) DO NOTHING;
