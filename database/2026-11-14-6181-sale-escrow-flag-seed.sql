-- #6181: kontakten for saelgers laaste penge (sale_escrow_enabled) faar sin raekke.
--
-- Koden for pengelaasen er merget bag kontakten (#8138, #8159), men ingen migration
-- oprettede raekken, saa kontakten kunne ikke flyttes fra admin-fladen uden at blive
-- oprettet i haanden. Manglende raekke laeses allerede som slukket; startstadiet her
-- er derfor `off`, og intet aendrer sig for spillerne, naar migrationen er applied.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et stadie,
-- ejeren allerede har flyttet. Ingen eksisterende raekke aendres.
--
-- POST-VERIFY (read-only): SELECT value FROM public.app_config WHERE key = 'sale_escrow_enabled';  -- "off"
-- Rollback: DELETE FROM public.app_config WHERE key = 'sale_escrow_enabled';
--
-- Refs #6181

BEGIN;
SET LOCAL lock_timeout = '5s';
INSERT INTO public.app_config (key, value, description)
VALUES (
  'sale_escrow_enabled',
  '"off"'::jsonb,
  'Binary flag (off|on) for the sale lock (#6181): with on, the seller''s money from a sale is locked until the rider actually changes team. Read server-side as binary; beta counts as off.'
)
ON CONFLICT (key) DO NOTHING;
COMMIT;
