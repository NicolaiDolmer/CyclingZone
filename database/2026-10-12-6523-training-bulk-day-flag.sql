-- #6523 — traeningssidens "saet dagen for flere ryttere paa een gang" bag et stadie-flag.
--
-- Ejer-go 12/10 efter mockup. Startstadiet er `off` (ikke `beta`): ejeren skal
-- se aegte billeder paa preview foer beta-testere faar fladen. Ingen spiller
-- ser noget nyt foer ejeren selv flytter flaget.
--
-- Evalueres af backend/lib/trainingBulkDayFlag.js via evaluateFlagStage
-- (off | beta | on, featureStage.js) og leveres som en bar boolean (`bulkDay`)
-- i GET /api/training/me. Flaget staar i STAGE_FLAGS
-- (backend/lib/stageFlagCatalog.js), saa ejeren kan flytte det fra admin-fladen.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie
-- ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_bulk_day',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for setting today''s day for several riders at once on the Training page, Today tab (#6523): an always-visible bulk bar (all riders in view when none are selected), a Set for group button on each group header, and a short explanation on the Today / race day column header. off = the Today tab as it is. Nothing is removed at any stage.'
)
ON CONFLICT (key) DO NOTHING;
