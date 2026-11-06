-- #7726 (ejer 5/11): kontakt der fjerner enkeltstartens ekstra terning i v4-motoren
-- (kun s5_profiles_v3), og det stempel der holder aendringen vaek fra startede loeb.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- races.itt_no_day_roll_7726 (boolean, nullable): saettes til true ved loebets FOERSTE
-- etape-claim, naar kontakten er taendt (ittNoDayRoll7726Flag.js). NULL = loebet beholder
-- terningen. Et loeb der allerede var startet, da kontakten blev taendt, faar aldrig stemplet.
--
-- app_config oprettes 'off'. Kun 'on' taender (beta taeller som slukket: kontakten aendrer
-- loebsresultater). Off = motoren som i dag, bit-identisk. Ingen tal her (hard rule 17).
-- Taendes af ejeren efter foer/efter-billedet.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Verificering:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'itt_no_day_roll_7726';
--   SELECT value FROM public.app_config WHERE key = 'itt_no_day_roll_7726';

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS itt_no_day_roll_7726 boolean;

COMMENT ON COLUMN public.races.itt_no_day_roll_7726 IS
  '#7726: true = this race was bound to the time trial rule without the extra day roll at its first stage claim. NULL = the race keeps the roll.';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'itt_no_day_roll_7726',
    '"off"'::jsonb,
    'Stage flag (off|on) for #7726: individual time trials run without the extra day roll, so ability, form, fatigue, weather, route and day form decide them. Only s5_profiles_v3 races that had not started when the flag was on; started races keep the roll. Off = today''s engine, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
