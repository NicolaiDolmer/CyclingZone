-- #6110 S26 - traeningssidens "Dagens beslutning"-kort bag et stadie-flag.
--
-- Startstadiet er `off`: ejeren ser aegte billeder foer beta-testere faar kortet.
-- Evalueres af backend/lib/trainingDecisionFlag.js (off | beta | on) og leveres
-- som en bar boolean (`decisionCard`) i GET /api/training/me.
--
-- Idempotent (ON CONFLICT DO NOTHING): overskriver aldrig et stadie ejeren har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_decision_card',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the Today''s decision card at the top of the Training page, Today tab (#6110 S26): one to three assistant suggestions with a Use button each. off = the Today tab as it is. Nothing is removed at any stage.'
)
ON CONFLICT (key) DO NOTHING;
