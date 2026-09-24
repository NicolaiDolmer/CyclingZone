-- #5462 — Skadesvarighed i LOEBSDAGE (ejer-laast 15/9, TRAINING_RULES §13.3 pkt. 7)
-- ============================================================================
-- ADDITIV + IDEMPOTENT + IKKE-DESTRUKTIV. Migrationen aendrer INGEN adfaerd af sig
-- selv: de tre kolonner er NULL for hver eneste eksisterende raekke, og ingen af dem
-- skrives foer feature-flaget `training_tick_per_race_day` er on.
--
-- `injured_until` (DATE) BLIVER staaende og bliver ved med at vaere udtagelses-gaten
-- (riderEligibility.applyInjuredFilter's `.gte("injured_until", todayStr)`,
-- raceSelection.js, raceEntryGenerator.js, raceRunner, racePeakPlans.js og hele
-- frontend-kernen). Loebsdagen lægges VED SIDEN AF, og `injured_until` UDLEDES af den.
-- Begrundelsen i fuld laengde: backend/lib/injuryRaceDays.js' header.
--
-- OVERGANGEN (bindende, #5462 leverance 4): en skade der allerede loeber naar flaget
-- flippes, har ingen af de tre kolonner sat. `isInjuredOnRaceDay` falder derfor
-- tilbage til dato-sammenligningen for netop de raekker, og de loeber faerdige paa
-- KALENDERDAGE praecis som de blev skrevet. Ingen skade skifter betydning tavst;
-- kun skader der opstaar EFTER flippet taeller i loebsdage.

ALTER TABLE public.rider_condition
  ADD COLUMN IF NOT EXISTS injury_end_game_day INTEGER;

ALTER TABLE public.rider_condition
  ADD COLUMN IF NOT EXISTS injury_season_id UUID REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE public.rider_condition
  ADD COLUMN IF NOT EXISTS injury_race_days_left INTEGER;

COMMENT ON COLUMN public.rider_condition.injury_end_game_day IS
  '#5462: SIDSTE skadede loebsdag, 0-baseret som race_stage_schedule.game_day '
  '(CALENDAR_RULES §0b — flader viser +1). NULL = skaden er skrevet paa kalenderdags-'
  'stien (flag off, eller foer flippet) og ejes af injured_until alene.';

COMMENT ON COLUMN public.rider_condition.injury_season_id IS
  '#5462: saesonen injury_end_game_day hoerer til. Obligatorisk sammen med den — '
  'game_day er saeson- OG divisions-relativ og nulstilles hver saeson, saa den kan '
  'ikke baere betydningen alene.';

COMMENT ON COLUMN public.rider_condition.injury_race_days_left IS
  '#5462: resterende loebsdage INKLUSIV den indevaerende (samme inklusiv-semantik som '
  'frontendens injuryDaysLeft, #1672). Denormaliseret af traenings-motoren ved hvert '
  'loebsdags-tick, saa fladerne kan skrive "tilbage om N loebsdage" uden at kende '
  'holdets divisions-akse. Sandheden er injury_end_game_day; dette felt er afledt.';

-- ── POST-VERIFY (koeres MANUELT efter auto-migrate.yml, read-only) ───────────
--
--   -- 1) De tre kolonner findes, alle nullable, ingen default:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'rider_condition'
--      AND column_name IN ('injury_end_game_day','injury_season_id','injury_race_days_left')
--    ORDER BY column_name;
--   -- forventet: 3 raekker, is_nullable = 'YES', column_default IS NULL.
--
--   -- 2) Migrationen har ikke roert data (flag off ⇒ alt er NULL):
--   SELECT count(*) AS raekker,
--          count(injury_end_game_day)   AS med_slut_loebsdag,
--          count(injury_season_id)      AS med_saeson,
--          count(injury_race_days_left) AS med_rest
--     FROM public.rider_condition;
--   -- forventet: med_* = 0 indtil training_tick_per_race_day flippes.
--
--   -- 3) Aktive skader paa flip-dagen (overgangs-maalingen, #5462 leverance 4).
--   --    Ingen navne, ingen id'er — kun antal:
--   SELECT count(*) AS aktive_skader
--     FROM public.rider_condition
--    WHERE injured_until >= (now() AT TIME ZONE 'Europe/Copenhagen')::date;
