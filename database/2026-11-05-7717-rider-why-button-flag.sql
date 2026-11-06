-- #7717: Hvorfor?-knappen ved rytterne i "Your day".
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Ejeren flytter flaget fra admin-fladen (off | beta | on).
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'rider_why_button',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the Why? button beside riders in Your day (#7717): one tap shows the true explanation of a result from the race events, in words only. Display only.'
)
ON CONFLICT (key) DO NOTHING;
