-- [#7730] Jagten afgoeres af de hold der jager: kontakten maa kun gaelde loeb der ikke er startet.
--
-- Samme releaseprincip som races.engine_rules_revision (#5955): ny taktik/balance gaelder kun
-- loeb der starter efter aktiveringen. Et igangvaerende etapeloeb faerdiggoeres med de regler
-- det startede paa.
--
-- races.team_chase_7730 (boolean, nullable):
--   true = loebet startede med kontakten taendt
--   NULL = ikke omfattet. Paa et startet loeb betyder NULL altid ikke omfattet.
--
-- Hvem skriver: KUN backend-runneren (service role) ved loebets foerste etape-claim, med en
-- betinget UPDATE (WHERE team_chase_7730 IS NULL AND stages_completed = 0), jf.
-- raceRunner.bindRaceTeamChase7730, og kun naar app_config team_chase_7730 = 'on'.
--
-- Additiv og idempotent: ingen eksisterende kolonne roeres, ingen data flyttes, ingen default.
-- Koden fungerer ogsaa FOER denne migration er applied (fravaer af kolonnen = ikke omfattet).
--
-- Post-verify (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'team_chase_7730';
--   SELECT team_chase_7730, count(*) FROM public.races GROUP BY 1;

ALTER TABLE public.races ADD COLUMN IF NOT EXISTS team_chase_7730 boolean;

COMMENT ON COLUMN public.races.team_chase_7730 IS '#7730: true = loebet startede med kontakten team_chase_7730 taendt. NULL = ikke omfattet.';
