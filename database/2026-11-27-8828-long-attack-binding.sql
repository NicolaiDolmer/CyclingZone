-- #7884/#8828: "Angrib paa <sted>" i etapeplanen (langt angreb fra foden af den valgte stigning).
-- Kontakten rammer kun loeb, der STARTER efter taending. Samme moenster som #8799/#8180
-- (raceStartStamp.js): stemplet saettes ved loebets foerste etape-claim, og senere etaper laeser det.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- races.long_attack_7884 (boolean, nullable): saettes til true ved loebets FOERSTE etape-claim, naar
-- kontakten er taendt (longAttack7884Flag.bindLongAttack7884). NULL = loebet koerer planerne uden
-- stederne. Et loeb der allerede var startet, faar aldrig stemplet.
--
-- app_config long_attack_7884 oprettes 'off'. Kun 'on' taender ("beta" taeller som slukket:
-- kontakten aendrer loebsresultater). 'stop' er ejerens noedstop for stemplede loeb.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet. Ingen tal her (hard rule 17).
--
-- Verificering:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'long_attack_7884';
--   SELECT key, value FROM public.app_config WHERE key = 'long_attack_7884';

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS long_attack_7884 boolean;

COMMENT ON COLUMN public.races.long_attack_7884 IS
  '#8828: true = this race was bound at its first stage claim to "Attack on <place>" in the stage plan (a long attack from the foot of the chosen climb). NULL = stage plans run without the places.';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'long_attack_7884',
    '"off"'::jsonb,
    'Stage flag (off|on|stop) for #7884/#8828: "Attack on <place>" in the stage plan. A rider attacks from the foot of the climb he picks, from his own group; the speed above his own level is paid from his reserve, and one attempt per climb. Only s5_profiles_v3 races that had not started when the flag was on; stamped per race at the first stage claim. Stop is the owner emergency stop for stamped races. Off = today''s engine, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
