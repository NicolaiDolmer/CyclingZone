-- #3643 — traeningssidens nye mobil-visning bag et stadie-flag.
--
-- EJER-BESLUTNING 19/9 (ordret): "Jeg vil have det kun live for beta testere i
-- starten, saadan at vi kan snakke om det og tilpasse, hvor vi derefter goer
-- den bedre og bedre loebende".
--
-- Derfor er startstadiet `beta` og ikke `off`: beta-testere (users.is_beta_tester
-- eller role = 'admin', se isViewerBetaTester i backend/routes/api.js) ser den
-- nye tabel fra det oejeblik migrationen er applied, og ALLE andre ser praecis
-- den mobil-visning der staar i prod i dag (#5124's D-047-gren i
-- TrainingPage.jsx). Desktop er uberoert i begge stadier.
--
-- Evalueres af backend/lib/trainingMobileTableFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js) og leveres som en bar boolean
-- (`mobileTable`) i GET /api/training/me. Flaget staar i STAGE_FLAGS
-- (backend/lib/stageFlagCatalog.js), saa ejeren kan flytte det fra admin-fladen.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.
--
-- NAAR MAA DEN GAA TIL `on`? Naar ejeren har set fladen paa sin egen telefon og
-- sagt ja. Foerst DA slettes den gamle D-047-gren i TrainingPage.jsx (den staar
-- markeret i koden med en note der peger paa #3643).

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_mobile_table',
  '"beta"'::jsonb,
  'Stage flag (off|beta|on) for the new mobile training page: rows are riders, columns are the day''s race days, and the tapped rider gets a full card below the table (#3643, owner call 2026-09-18 mockup 2). beta = beta testers only; everyone else keeps the current mobile view (#5124 D-047 branch). Desktop is unaffected either way.'
)
ON CONFLICT (key) DO NOTHING;
