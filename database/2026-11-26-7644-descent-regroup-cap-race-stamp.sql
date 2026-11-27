-- #7644 (ejer 26/11, "Byg stempel, taend ved S6"): nedkoersels-loftet bindes til loebsstart,
-- saa et igangvaerende etapeloeb aldrig skifter regler midt i loebet. Samme moenster som
-- #7557/#7733 (raceStartStamp.js).
--
-- ADDITIV OG IDEMPOTENT. Ingen eksisterende raekke aendres, intet slettes. app_config-raekken
-- descent_regroup_cap_7644 findes allerede (2026-11-04-7644-descent-regroup-cap-flag.sql) og
-- roeres ikke: kontakten forbliver slukket.
--
-- races.descent_regroup_cap_7644 (boolean, nullable): saettes til true ved loebets FOERSTE
-- etape-claim, naar kontakten er taendt. NULL = loebet koerer uden loftet. Et loeb der allerede
-- var startet, faar aldrig stemplet. Foer kolonnen findes, laeser koden alle loeb som ikke
-- stemplet (slukket).
--
-- Verificering:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'descent_regroup_cap_7644';
--   SELECT count(*) FROM public.races WHERE descent_regroup_cap_7644 IS NOT NULL;  -- forventet 0

SET lock_timeout = '3s';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS descent_regroup_cap_7644 boolean;

COMMENT ON COLUMN public.races.descent_regroup_cap_7644 IS
  '#7644: true = this race was bound at its first stage claim to the cap on how much time a group behind can gain per km on a long descent after the last climb. NULL = the race runs without it.';
