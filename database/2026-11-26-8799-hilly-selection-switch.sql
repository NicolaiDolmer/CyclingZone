-- #8799 (ejer 26/11): én kontakt for selektionen paa kuperet og mellembjerg (#7645, variant 3)
-- og afslutningerne paa kuperet og boelget (#8189, variant C). De taendes sammen foer S6's
-- foerste loeb og rammer kun loeb, der STARTER efter taending. Samme moenster som #7557/#7730.
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes.
--
-- races.hilly_selection_8799 (boolean, nullable): saettes til true ved loebets FOERSTE
-- etape-claim, naar kontakten er taendt (raceStartStamp.js). NULL = loebet koerer uden reglen.
-- Et loeb der allerede var startet, faar aldrig stemplet.
--
-- app_config hilly_selection_8799 oprettes 'off'. Kun 'on' taender ("beta" taeller som slukket:
-- kontakten aendrer loebsresultater). 'stop' er ejerens noedstop for stemplede loeb.
-- ON CONFLICT DO NOTHING: overskriver aldrig et stadie ejeren har flyttet. Ingen tal her (hard rule 17).
--
-- Verificering:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'hilly_selection_8799';
--   SELECT key, value FROM public.app_config WHERE key = 'hilly_selection_8799';

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS hilly_selection_8799 boolean;

COMMENT ON COLUMN public.races.hilly_selection_8799 IS
  '#8799: true = this race was bound at its first stage claim to the hilly-stage rules (selection on hilly and medium mountain stages, finishes on hilly and rolling stages decided by how hard the day was). NULL = the race runs without them.';

INSERT INTO public.app_config (key, value, description)
VALUES
  (
    'hilly_selection_8799',
    '"off"'::jsonb,
    'Stage flag (off|on|stop) for #8799: one switch for #7645 (on hilly and medium mountain stages a group dropped on a climb only comes back when a team with a contender in it chases, and the front can defend) and #8189 (a flat sprint on hilly and rolling stages is decided by how hard the day was: breakaways get their chance and the sprint is reduced). Only s5_profiles_v3 races that had not started when the flag was on; stamped per race at the first stage claim. Stop is the owner emergency stop for stamped races. Off = today''s engine, bit-identical. Owner-only flip.'
  )
ON CONFLICT (key) DO NOTHING;
