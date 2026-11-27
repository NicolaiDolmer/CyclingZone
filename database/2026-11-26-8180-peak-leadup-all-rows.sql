-- #8180 (ejer 26/11): formtoppens optakt laeser alle traeningsraekker for alle hold, kun i loeb der
-- starter efter taending. Samme stempel-moenster som #7733 (raceStartStamp.js).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- races.peak_leadup_all_rows_8180 (boolean, nullable): saettes til true ved loebets FOERSTE
-- etape-claim, naar kontakten er taendt. NULL = loebet koerer med den gamle optakt. Et loeb der
-- allerede var startet, faar aldrig stemplet, saa et igangvaerende etapeloeb skifter aldrig input.
--
-- peak_leadup_all_rows_8180 oprettes 'off' i app_config. Kun 'on' taender (beta taeller som
-- slukket: kontakten aendrer motorens input). 'stop' er ejerens noedstop for stemplede loeb.
-- Off = motoren som i dag, bit-identisk. Ingen tal her (hard rule 17).
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet.
--
-- Verificering:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'peak_leadup_all_rows_8180';
--   SELECT key, value FROM public.app_config WHERE key = 'peak_leadup_all_rows_8180';

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS peak_leadup_all_rows_8180 boolean;

COMMENT ON COLUMN public.races.peak_leadup_all_rows_8180 IS
  '#8180: true = this race was bound at its first stage claim to reading the whole form-peak lead-up (every training row of every team). NULL = the race runs with the old read.';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'peak_leadup_all_rows_8180',
    '"off"'::jsonb,
    'Stage flag (off|on|stop) for #8180: the form-peak lead-up reads every training row of every team, so no team in a large field gets an empty lead-up from the row cap. Stamped per race at the first stage claim; a race already running never changes input. Stop is the owner emergency stop for stamped races. Off = today''s engine, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
