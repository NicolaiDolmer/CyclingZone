-- #8045: løbsfilmen fortæller angrebet, mens det sker (angrebet, når han kører fra
-- gruppen, forspringet ved motorens grænser, hentet, sat eller holder til toppen/mål).
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- Ejeren flytter flaget fra admin-fladen (off | beta | on), efter preview.
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke, og
-- løbsloggen ændres ikke (filmen læser de hændelser, motoren allerede har gemt).
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.
--
-- POST-VERIFY (read-only): SELECT value FROM public.app_config WHERE key = 'attack_story_8045';  -- "off"
-- Rollback: DELETE FROM public.app_config WHERE key = 'attack_story_8045';
--
-- Refs #8045

INSERT INTO public.app_config (key, value, description)
VALUES (
  'attack_story_8045',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the race film attack story (#8045): an attack on the final climb is told as it happened, from the attack to the gap at real checkpoints and whether the rider is caught, dropped or holds on. Display only.'
)
ON CONFLICT (key) DO NOTHING;
