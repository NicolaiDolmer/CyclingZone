-- [#7855] Troejejagt i etapeplanen (Hent point / Hent bjergpoint): kontakten maa kun gaelde loeb der ikke er startet.
--
-- Samme releaseprincip som races.team_chase_7730 (#7730) og races.engine_rules_revision (#5955): ny
-- taktik gaelder kun loeb der starter efter aktiveringen. Et igangvaerende etapeloeb faerdiggoeres
-- med de regler det startede paa.
--
-- races.jersey_hunt_7855 (boolean, nullable):
--   true = loebet startede med kontakten taendt
--   NULL = ikke omfattet. Paa et startet loeb betyder NULL altid ikke omfattet.
--
-- Hvem skriver: KUN backend-runneren (service role) ved loebets foerste etape-claim, med en
-- betinget UPDATE (WHERE jersey_hunt_7855 IS NULL AND stages_completed = 0), jf.
-- jerseyHunt7855Flag.bindJerseyHunt7855, og kun naar app_config jersey_hunt_7855 = 'on'.
--
-- Slukkes kontakten, gaelder det kun nye loeb: et stemplet loeb koerer faerdigt med sine regler.
-- Vaerdien 'stop' er ejerens noedstop og fjerner reglen fra stemplede loeb fra naeste etape.
--
-- Additiv og idempotent: ingen eksisterende kolonne roeres, ingen data flyttes, ingen default.
-- Koden fungerer ogsaa FOER denne migration er applied (fravaer af kolonnen = ikke omfattet).
--
-- Post-verify (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'jersey_hunt_7855';
--   SELECT jersey_hunt_7855, count(*) FROM public.races GROUP BY 1;
--   SELECT value FROM public.app_config WHERE key = 'jersey_hunt_7855';

SET lock_timeout = '3s';

ALTER TABLE public.races ADD COLUMN IF NOT EXISTS jersey_hunt_7855 boolean;

COMMENT ON COLUMN public.races.jersey_hunt_7855 IS '#7855: true = loebet startede med kontakten jersey_hunt_7855 taendt. NULL = ikke omfattet.';

-- Kontakten seedes slukket, saa registret kan se noeglen. Taendes kun af ejeren.
INSERT INTO public.app_config (key, value, description)
VALUES ('jersey_hunt_7855', '"off"'::jsonb, 'Stage flag (off|on|stop) for #7855: jersey hunt tasks in the stage plan (Go for sprint points / Go for KOM points). Only races not started when the flag was on; off only reaches new races, stop is the owner''s emergency stop for bound races. Owner-only flip.')
ON CONFLICT (key) DO NOTHING;
