-- #6156 (ejer 19/10) · Eget flag til formtoppe/dyk i v4.
--
-- Formtoppene var hardkoblet til regel-revisionen s5_profiles_v2. Ejeren vil
-- taende v2 for nye loeb nu og formtoppene foerst ved saesonskiftet 25/10, og
-- have en kill-switch, hvis toppene viser sig at afgoere for meget.
-- off (start) = v2 bruger formen alene; on = form + top/dyk som designet.
-- Laeses een gang pr. afvikling (raceRunner.resolveRaceEngineV4); fejl = off.
--
-- Idempotent: ON CONFLICT DO NOTHING. Applies af auto-migrate.yml (#2642).
-- Post-verify: SELECT key, value FROM app_config WHERE key = 'race_form_peaks';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'race_form_peaks',
  '"off"'::jsonb,
  'Stage flag (off|on) for #6156: form peaks and the dip after them in race engine v4 under rules revision s5_profiles_v2. off = form alone. Owner flips at the S5 season change (25/10).'
)
ON CONFLICT (key) DO NOTHING;
