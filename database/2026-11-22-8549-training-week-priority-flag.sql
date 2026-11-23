-- #8549 PR 2 · Stadie-flaget training_week_priority (off | beta | on), seedet "off".
-- Week blocks i motoren: prioritet pr. felt og ét låst pas pr. dag. Off = motoren og prognosen
-- kører dagens felt-regel (kildefeltet = feltet), også for rækker med plan_kind 'week'.
-- Ingen tabel- eller kolonneændring (plan_kind kom med #8548). Idempotent.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_week_priority',
  '"off"'::jsonb,
  'Stage flag (off|beta|on, #8549): Week blocks priority and one locked session per day. Races take the lowest-priority session, the locked session moves to the nearest free field, the fatigue limit still wins. Only rows with plan_kind week; off = today''s field rule. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
