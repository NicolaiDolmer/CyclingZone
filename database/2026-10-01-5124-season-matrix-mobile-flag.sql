-- #5124 · Saesonmatrixens nye mobilvisning (retning A) bag et stadie-flag.
--
-- EJER 1/10 om PR #5829: "start paa beta og tjek for AI-slop". Startstadiet er
-- derfor `beta`: beta-testere (users.is_beta_tester eller role = 'admin', se
-- isViewerBetaTester i backend/routes/api.js) ser den nye visning med ét loeb og
-- tre loebsdage ad gangen paa smalle skaerme. ALLE andre ser praecis den matrix
-- der staar i prod i dag (fuld tabel med vandret scroll). Desktop er uberoert i
-- begge stadier.
--
-- Evalueres via GET /api/feature-flags (PLAYER_VISIBLE_FLAG_KEYS i
-- backend/lib/stageFlagCatalog.js) og laeses af SeasonMatrix.jsx. Staar i
-- STAGE_FLAGS, saa ejeren kan flytte den fra admin-fladen.
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren
-- allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'season_matrix_mobile',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for the season matrix mobile view (#5124, direction A): one race and three race days at a time below 640px. beta = beta testers only; everyone else keeps the current full matrix. Desktop is unaffected either way.'
)
ON CONFLICT (key) DO NOTHING;
