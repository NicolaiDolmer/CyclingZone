-- #8196 · Midtsaeson-beskeden fra bestyrelsen sendes kun een gang pr. saeson.
--
-- Foer var det eneste vaern mod gentagelse, om beskeden stadig laa i indbakken
-- (notifications). Slettede spilleren den, sendte cronen (hvert 30. minut) en ny.
-- Nu bor "sendt"-maerket paa boardet: board_profiles.mid_season_notified_season
-- = det saesonnummer, beskeden sidst blev leveret for.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- DEPLOY-RAEKKEFOELGE: backend kan naa prod foer migrationen. boardMidSeason.js
-- haandterer en manglende kolonne (42703/PGRST204) ved at falde tilbage til den
-- gamle laesning og skriver saa intet maerke; koerslen vaelter ikke.
--
-- RLS og grants: uaendret. Ingen ny tabel. Kolonnen er et heltal uden privat
-- indhold; den foelger tabellens eksisterende adgang.
--
-- Opfyldning: boards, der har en midtsaeson-besked liggende i indbakken lige nu,
-- faar maerket sat til beskedens saeson, saa en sletning efter deploy ikke
-- udloeser en ny. Saesonnummeret laeses af titlen "Mid-season check (season N)".
-- En besked, der allerede er slettet foer denne migration, kan give EN sidste
-- besked; derefter staar maerket.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT data_type, is_nullable FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'board_profiles'
--         AND column_name = 'mid_season_notified_season';   -- integer, YES
--   2. SELECT mid_season_notified_season, count(*) FROM public.board_profiles
--       WHERE mid_season_notified_season IS NOT NULL GROUP BY 1;

BEGIN;

-- #6342: en migration maa aldrig holde spillerlaesninger tilbage; giv op efter 3 s.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.board_profiles
  ADD COLUMN IF NOT EXISTS mid_season_notified_season integer;

COMMENT ON COLUMN public.board_profiles.mid_season_notified_season IS
  '#8196: saesonnummer, midtsaeson-beskeden sidst blev leveret for. Vaern mod gentagelse, uafhaengigt af indbakken.';

UPDATE public.board_profiles bp
SET mid_season_notified_season = n.season_number
FROM (
  SELECT related_id AS board_id,
         max((substring(title FROM 'season ([0-9]{1,6})\)$'))::integer) AS season_number
  FROM public.notifications
  WHERE type = 'board_critical'
    AND title ~ '^Mid-season check \(season [0-9]{1,6}\)$'
    AND related_id IS NOT NULL
  GROUP BY related_id
) n
WHERE bp.id = n.board_id
  AND n.season_number IS NOT NULL
  AND (bp.mid_season_notified_season IS NULL OR bp.mid_season_notified_season < n.season_number);

COMMIT;
