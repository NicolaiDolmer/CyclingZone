-- #2009: hover-miniprofil på rytternavne (FM-stil). Hover på desktop, tryk på mobil.
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Ejeren flytter flaget fra admin-fladen (off | beta | on), beta-testere først (ejer 7/11).
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'rider_hover_card',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the rider mini profile (#2009): hover a rider name on desktop or tap it on mobile to see identity, rating and abilities; potential only for own riders. Display only.'
)
ON CONFLICT (key) DO NOTHING;
