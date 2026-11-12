-- #7778: løbssiden v6 trin 1. Resultater for en kørt etape i den nye ramme
-- (T3-hoved med handlingsrække, bred side, rute i højre kolonne, "Skjul rute").
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Ejeren flytter flaget fra admin-fladen (off | beta | on), beta-testere først.
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.
--
-- POST-VERIFY (read-only): SELECT value FROM public.app_config WHERE key = 'race_page_v6';  -- "off"
-- Rollback: DELETE FROM public.app_config WHERE key = 'race_page_v6';
--
-- Refs #7778

INSERT INTO public.app_config (key, value, description)
VALUES (
  'race_page_v6',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the race page v6 step 1 (#7778): a ridden stage opens on Results in a wide frame with the route next to the list and a remembered Hide route choice. Display only.'
)
ON CONFLICT (key) DO NOTHING;
