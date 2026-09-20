-- #4847 (fase B4) — trup-akse paa traeningens loebsdags-noegle
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md §3.2
-- Ejer-beslutning 15/9: docs/TRAINING_RULES.md §13.3 beslutning 5 ("U23-kalenderen
-- (#4620) bygges MED i S4-cutover; EEN loebsdags-akse PR. TRUP (senior/U23/junior),
-- samme 140-maal").
--
-- PROBLEMET. #4846's noegle er (team_id, season_id, game_day) WHERE game_day IS NOT NULL.
-- Den holder saa laenge et hold har PRAECIS EEN loebsdags-akse. Fra #4620 faar det samme
-- hold tre: senior, U23 og junior koerer hver sin kalender, og "loebsdag 37" betyder
-- noget forskelligt paa hver akse. Uden en trup-kolonne ville holdets U23-tick
-- kollidere med senior-ticket paa samme game_day og blive TAVST kasseret som 23505 =
-- alreadyRan — praecis den stille fejlklasse TRAINING_RULES.md §10 beskriver.
--
-- ADDITIV + IDEMPOTENT. Kolonnen har DEFAULT 'senior', saa hver eksisterende raekke
-- beholder sin plads i noeglen: COALESCE(squad,'senior') = 'senior' for alt hvad der
-- allerede staar der, og den udvidede noegle er dermed BIT-IDENTISK for dagens data.
-- Migrationen aendrer INGEN adfaerd af sig selv.
--
-- HVORFOR COALESCE I INDEXET og ikke bare `squad`: en NULL i en unik noegle er ikke lig
-- sig selv i Postgres, saa to raekker med squad IS NULL paa samme (team, season,
-- game_day) ville BEGGE blive accepteret — altsaa et dobbelt-tick. COALESCE'en lukker
-- hullet uanset om en fremtidig skrivesti glemmer kolonnen.
--
-- Refs #4847 #4846 #4620 #4850

-- ── 1) Trup-kolonnen ─────────────────────────────────────────────────────────
ALTER TABLE public.training_day_runs
  ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'training_day_runs_squad_check'
      AND conrelid = 'public.training_day_runs'::regclass
  ) THEN
    ALTER TABLE public.training_day_runs
      ADD CONSTRAINT training_day_runs_squad_check
      CHECK (squad IN ('senior', 'u23', 'junior'));
  END IF;
END $$;

COMMENT ON COLUMN public.training_day_runs.squad IS
  '#4847: hvilken loebsdags-akse ticket hoerer til. Fra #4620 har et hold en akse pr. '
  'trup (senior/u23/junior) og samme game_day-tal betyder forskellige dage paa hver. '
  'DEFAULT ''senior'' — alle raekker fra foer #4847 er senior-ticks.';

-- ── 2) Den unikke loebsdags-noegle udvides med truppen ───────────────────────
-- #4846's index droppes og genskabes med truppen i. DROP ... IF EXISTS er sikker:
-- indexet genskabes i samme transaktion nedenfor, og noeglen er kun i brug naar
-- training_tick_per_race_day er on (i dag off).
DROP INDEX IF EXISTS public.uniq_training_day_runs_team_season_game_day;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_day_runs_team_season_squad_game_day
  ON public.training_day_runs (team_id, season_id, (COALESCE(squad, 'senior')), game_day)
  WHERE game_day IS NOT NULL;

-- Opslags-indexet foelger med, saa sweepens "hvem har allerede koert i dag"-query
-- (season_id + game_day IN (...)) fortsat rammer et index.
CREATE INDEX IF NOT EXISTS idx_training_day_runs_season_squad_game_day
  ON public.training_day_runs (season_id, game_day, (COALESCE(squad, 'senior')))
  WHERE game_day IS NOT NULL;

COMMENT ON TABLE public.training_day_runs IS
  'Daglig traening (#1305) + loebsdags-tick (#4846) + trup-akse (#4847): idempotens-anker. '
  'To partielle unikke indexe deler tabellen: game_day IS NULL → UNIQUE(team_id, tick_date) '
  '(kalenderdag), game_day IS NOT NULL → UNIQUE(team_id, season_id, COALESCE(squad,''senior''), '
  'game_day) (loebsdag pr. trup). executed_by skelner manager- vs. assistent-sweep. '
  'report = JSONB-resume til frontend-visning.';
