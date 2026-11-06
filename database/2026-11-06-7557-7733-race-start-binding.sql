-- #7557 og #7733 (ejer 6/11): to kontakter bindes til loebsstart, saa et loeb koeres faerdigt
-- med de regler, det startede med. Samme moenster som #7726 og #7730.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- races.let_go_order_7557 og races.started_field_lock_7733 (boolean, nullable): saettes til
-- true ved loebets FOERSTE etape-claim, naar kontakten er taendt (raceStartStamp.js). NULL =
-- loebet koerer uden reglen. Et loeb der allerede var startet, faar aldrig stemplet.
--
-- started_field_lock_7733 oprettes 'off' i app_config (let_go_order_7557 findes allerede).
-- Kun 'on' taender. ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Verificering:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races'
--      AND column_name IN ('let_go_order_7557', 'started_field_lock_7733');
--   SELECT key, value FROM public.app_config WHERE key IN ('let_go_order_7557', 'started_field_lock_7733');

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS let_go_order_7557 boolean,
  ADD COLUMN IF NOT EXISTS started_field_lock_7733 boolean;

COMMENT ON COLUMN public.races.let_go_order_7557 IS
  '#7557: true = this race was bound at its first stage claim to the rule that a saved Leave the chase to others order always wins. NULL = the race runs without it.';

COMMENT ON COLUMN public.races.started_field_lock_7733 IS
  '#7733: true = this race was bound at its first stage claim to a locked start field: pool and squad no longer decide who stays in the race. NULL = the race runs without it.';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'started_field_lock_7733',
    '"off"'::jsonb,
    'Stage flag (off|on|stop) for #7733: in a stage race that had not started when the flag was on, pool and squad no longer decide who stays in the race from stage 2. Stamped per race at the first stage claim. Stop is the owner emergency stop for stamped races. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
