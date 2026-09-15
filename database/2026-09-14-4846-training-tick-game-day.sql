-- #4846 (fase B2) — Traeningstickets noegle flyttes fra dansk kalenderdato til loebsdagen
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
--       §3.1 (tick-noeglen), §3.2 ("Skema og idempotens"), §6 fase B2, §7 G1/G2/G7.
--
-- ADDITIV + IDEMPOTENT. Migrationen fjerner INTET og aendrer INGEN adfaerd af sig selv:
-- den nye noegle er tom indtil feature-flaget `training_tick_per_race_day` er on.
-- `tick_date` bliver staaende (bindende krav i #4846) — den er stadig den datoakse
-- som racePeakPlans.js, api.js' today-status og hele historik-fladen laeser paa.
--
-- DE TO UNIKKE NOEGLER LEVER SIDE OM SIDE, adskilt af `game_day IS NULL`:
--   game_day IS NULL      → gammel sti. UNIQUE (team_id, tick_date)         = mutex pr. kalenderdag.
--   game_day IS NOT NULL  → ny sti.     UNIQUE (team_id, season_id, game_day) = mutex pr. loebsdag.
-- Partielle indexe, ikke tabel-constraints, fordi to loebsdage paa SAMME kalenderdato
-- ellers ville kollidere paa den gamle noegle (praecis den stille fejlklasse spec §3.2
-- beskriver). Motoren INSERTer bart (ingen ON CONFLICT), saa et partielt unique-index
-- rejser 23505 praecis som constrainten gjorde — arbiter-inferens er ikke i spil.

-- ── 1) training_day_runs: loebsdags-noeglen ──────────────────────────────────
ALTER TABLE public.training_day_runs
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES public.seasons(id) ON DELETE CASCADE;

ALTER TABLE public.training_day_runs
  ADD COLUMN IF NOT EXISTS game_day INTEGER;

COMMENT ON COLUMN public.training_day_runs.game_day IS
  '#4846: 0-baseret loebsdag (races.game_day_start / race_stage_schedule.game_day-rummet). '
  'NULL = raekken kom fra den gamle kalenderdags-sti. Aldrig udledt af scheduled_at (CALENDAR_RULES §0).';

COMMENT ON COLUMN public.training_day_runs.season_id IS
  '#4846: sæsonen loebsdagen hoerer til. Obligatorisk sammen med game_day — game_day er '
  'saeson- OG divisions-relativ og nulstilles hver saeson, saa den kan ikke baere noeglen alene.';

-- Gammel noegle → partielt index paa praecis samme kolonner. DO-blokken finder
-- constrainten paa (team_id, tick_date) uanset navn, saa migrationen ikke afhaenger
-- af Postgres' auto-navngivning.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'training_day_runs'
    AND c.contype = 'u'
    -- Sammenlign NAVNE-MAENGDEN, ikke conkey direkte: conkey baerer kolonnerne i
    -- den raekkefoelge constrainten erklaerer dem. Var den skrevet
    -- UNIQUE (tick_date, team_id), ville en attnum-sammenligning ikke matche,
    -- con_name forblive NULL, DROP'en udeblive — og den gamle constraint ville
    -- saa tavst afvise loebsdag 2 paa samme kalenderdato med 23505 (alreadyRan).
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM pg_attribute a
      WHERE a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
    ) = ARRAY['team_id', 'tick_date']
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.training_day_runs DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_day_runs_team_tick_date
  ON public.training_day_runs (team_id, tick_date)
  WHERE game_day IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_day_runs_team_season_game_day
  ON public.training_day_runs (team_id, season_id, game_day)
  WHERE game_day IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_day_runs_season_game_day
  ON public.training_day_runs (season_id, game_day)
  WHERE game_day IS NOT NULL;

COMMENT ON TABLE public.training_day_runs IS
  'Daglig traening (#1305) + loebsdags-tick (#4846): idempotens-anker. To partielle unikke '
  'indexe deler tabellen: game_day IS NULL → UNIQUE(team_id, tick_date) (kalenderdag), '
  'game_day IS NOT NULL → UNIQUE(team_id, season_id, game_day) (loebsdag). executed_by '
  'skelner manager- vs. assistent-sweep. report = JSONB-resume til frontend-visning.';

-- ── 2) Historik-snapshot pr. loebsdag ────────────────────────────────────────
-- rider_derived_ability_history har UNIQUE (rider_id, snapshot_date, source) og
-- upsertes med ignoreDuplicates: loebsdag 2 og 3 paa samme kalenderdato ville blive
-- TAVST kasseret (spec §3.2). Laese-siden af den tabel er stoerre end skrive-siden
-- (riderValueTrend, proRiderHistory, marketValueSundaySweep, riderRatingTrajectory),
-- saa dens noegle roeres IKKE. I stedet faar loebsdags-snapshottet sin egen tabel med
-- loebsdags-noeglen; den gamle tabel faar fortsat ÉT punkt pr. kalenderdato som i dag.
CREATE TABLE IF NOT EXISTS public.rider_ability_race_day_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  season_id     UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  game_day      INTEGER NOT NULL,
  source        TEXT NOT NULL DEFAULT 'daily_training'
                  CHECK (source IN ('daily_training', 'race_development')),
  season_number INTEGER,
  snapshot_date DATE NOT NULL,
  abilities     JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, season_id, game_day, source)
);

CREATE INDEX IF NOT EXISTS idx_rider_ability_race_day_history_rider
  ON public.rider_ability_race_day_history (rider_id, season_id, game_day);

COMMENT ON TABLE public.rider_ability_race_day_history IS
  '#4846: fuld evne-vektor pr. (rytter, saeson, loebsdag). Soesterbord til '
  'rider_derived_ability_history, som bliver paa kalenderdags-aksen fordi hele '
  'vaerditrend-/rating-laesesiden haenger paa den. Skrives kun naar '
  'training_tick_per_race_day er on. Best-effort: en fejl her vaelter aldrig traeningsdagen.';

-- RLS: kun service-role, praecis som rider_derived_ability_history (ingen public policy).
ALTER TABLE public.rider_ability_race_day_history ENABLE ROW LEVEL SECURITY;

-- ── 3) Feature-flag (default OFF) ────────────────────────────────────────────
-- OFF = bit-identisk med kalenderdags-ticket. Flippes FOERST naar B4 (udloeseren
-- "loebsdagen lukker") er i mål — foer da har en kalenderdag stadig kun ét tick,
-- og den rekalibrerede rate ville undertraene alle hold.
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'training_tick_per_race_day',
    'false'::jsonb,
    'When true, the daily training tick is keyed on (team_id, season_id, game_day) instead of the Danish calendar date: race-day mutex, race-day noise seeds, race-day history snapshot, recalibrated rates and the +1 per ability cap per race day (#4846). Flip only after the race-day-close trigger (#4846 phase B4) is live.'
  )
  ON CONFLICT (key) DO NOTHING;
