-- #8580 / #8550 del 3 · Stadie-flaget training_week_forecast (off | beta | on), seedet "off".
-- GET /api/training/programs/forecast/week svarer { available: false, reason: "disabled" } med flaget off.
-- Ingen tabel- eller kolonneændring. Idempotent: ON CONFLICT DO NOTHING rører aldrig en eksisterende værdi.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_week_forecast',
  '"off"'::jsonb,
  'Stage flag (off|beta|on, #8580): the rolling training week (today + 6 days) for the day picker. Day 0 equals GET /forecast; later days carry race and rest slots only, no fatigue. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;
