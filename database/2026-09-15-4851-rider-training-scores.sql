-- #4851 (fase A1) — Traeningsscoren 1-99: egen tabel pr. (rytter, pas)
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
--       §2 beslutning 4-6, §2.1 A1-A3, §4.3 (datamodel), §4.4 (visning), §7 G3/G4.
-- SSOT:  docs/TRAINING_RULES.md §13 beslutning 4-6.
--
-- ADDITIV + IDEMPOTENT. Migrationen fjerner INTET og aendrer INGEN eksisterende
-- adfaerd: en ny tabel, en RLS-politik og ét feature-flag (default OFF).
--
-- ── HVORFOR EGEN TABEL OG IKKE report-JSON (arkitekt-beslutning A2) ─────────
-- Scoren skal kunne SORTERES (kolonnen paa traeningssidens rytterliste),
-- AGGREGERES (gennemsnit + bedste over 30 loebsdage paa profilkortet) og
-- TEGNES som kurve. `training_day_runs.report` er JSONB pr. HOLD pr. dag; en
-- rytter-kolonne derfra kan ikke indekseres billigt, og den arver
-- unikheds-problemet spec §3.2 beskriver.
--
-- ── NOEGLEN: FASE A NU, FASE B SENERE (spec §4.3 "Fase A-variant") ──────────
-- Indtil tick-enheden skifter (#4846) noegles raekken paa kalenderdagen. Naar
-- loebsdagen bliver tick-enheden, noegles den paa loebsdagen. De to lever side
-- om side adskilt af `game_day IS NULL` — PRAECIS samme moenster som
-- database/2026-09-14-4846-training-tick-game-day.sql bruger paa
-- training_day_runs, saa de to tabeller skifter akse sammen og paa samme maade.
--
-- ── HVILE OG LOEBSDAGE ─────────────────────────────────────────────────────
-- Hviledag  ⇒ INGEN raekke (der var intet pas at maale).
-- Loebsdag  ⇒ raekke med `was_race_day = true` og `score IS NULL`: fladen viser
--             "loeb" uden tal, og kurven har hul (spec §4.4). Om en loebsdag
--             SKAL have et tal paa samme skala er et AABENT punkt (spec §5) —
--             kolonnen er nullable netop for at holde det aabent uden migration.

-- ── 1) Tabellen ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rider_training_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id      UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  -- Holdet der EJEDE rytteren da passet blev koert. Baerer RLS-politikken (samme
  -- team-baserede moenster som training_day_runs_select) og fryser dermed
  -- ejerskabet paa skrivetidspunktet: en ny ejer laeser ikke den forrige ejers
  -- private historik. Beslutning 5 (6/9) gaelder "rytterens egen manager".
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id     UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  -- Fase A-aksen. Bliver staaende naar fase B kommer: hele historik-fladen
  -- (useTrainingHistory, TrainingHistory, RiderTrainingTab) laeser paa datoen.
  tick_date     DATE NOT NULL,
  -- Fase B-aksen (#4846). NULL = raekken kom fra kalenderdags-stien.
  game_day      INTEGER,
  -- 1-99. NULL = loebsdag (fladen viser "loeb", ikke et tal).
  score         SMALLINT CHECK (score IS NULL OR (score BETWEEN 1 AND 99)),
  -- Sessionen der blev koert (trainingDayTypes.SESSION_INTENSITY-noeglen), fx
  -- 'vo2max'. NULL paa dagstyper uden session (aktiv restitution).
  session       TEXT,
  -- 'rest' | 'recovery' | 'skill' | 'training' (trainingDayTypes.DAY_TYPES).
  day_type      TEXT,
  was_race_day  BOOLEAN NOT NULL DEFAULT false,
  -- #4632's loebsdags-intention naar den findes (grupetto/normal/attack/all_out).
  -- race_entries har ingen intentions-kolonne endnu, saa den er NULL i fase A.
  intention     TEXT,
  -- De 3-4 stoerste bidrag op/ned, som score-POINT: [{key, points, direction}].
  -- Det er den ene linje "hvad traekker op/ned" paa profilkortet (spec §4.4).
  contributions JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2) Noeglerne ─────────────────────────────────────────────────────────────
-- To PARTIELLE unikke indexe, ikke tabel-constraints: to loebsdage paa samme
-- kalenderdato ville ellers kollidere paa kalenderdags-noeglen (den stille
-- fejlklasse spec §3.2 beskriver). Motoren INSERTer bart og sluger 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rider_training_scores_rider_season_date
  ON public.rider_training_scores (rider_id, season_id, tick_date)
  WHERE game_day IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rider_training_scores_rider_season_game_day
  ON public.rider_training_scores (rider_id, season_id, game_day)
  WHERE game_day IS NOT NULL;

-- Laese-stien: holdets seneste N dage (kolonnen + profilkortet henter begge
-- pr. hold og skaerer selv pr. rytter).
CREATE INDEX IF NOT EXISTS idx_rider_training_scores_team_date
  ON public.rider_training_scores (team_id, tick_date DESC);

CREATE INDEX IF NOT EXISTS idx_rider_training_scores_rider_date
  ON public.rider_training_scores (rider_id, tick_date DESC);

COMMENT ON TABLE public.rider_training_scores IS
  '#4851: traeningsscoren 1-99 pr. rytter pr. pas — passets KVALITET, ikke udbyttet. '
  'Cap-uafhaengig (backend/lib/trainingScore.js); udviklingen udledes AF scoren. '
  'Hviledag = ingen raekke. Loebsdag = raekke med score NULL og was_race_day true. '
  'Noeglen er (rider_id, season_id, tick_date) i fase A og (rider_id, season_id, game_day) '
  'naar #4846 flipper — to partielle unikke indexe, samme moenster som training_day_runs.';

COMMENT ON COLUMN public.rider_training_scores.score IS
  '#4851: 1-99. NULL naar dagen var en loebsdag (fladen viser "loeb", kurven har hul).';

COMMENT ON COLUMN public.rider_training_scores.contributions IS
  '#4851: de 3-4 stoerste bidrag til scoren som score-point: [{key, points, direction}]. '
  'key er en faktor-noegle fra trainingScore.SCORE_FACTOR_KEYS (intensity, focusMatch, '
  'condition, coach, facility, potential, youth, noise).';

-- ── 3) RLS: kun rytterens egen manager (ejer-beslutning 5, 6/9) ──────────────
-- Samme team-baserede moenster som training_day_runs_select. Fremmede ryttere er
-- dermed STRUKTURELT lukkede: scouting-oraklet (#1162/#2798) kan ikke naa scoren,
-- og markedsvaerdi/fremmede ryttere er uroerte.
ALTER TABLE public.rider_training_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_training_scores_select" ON public.rider_training_scores;
CREATE POLICY "rider_training_scores_select" ON public.rider_training_scores
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT id FROM public.teams WHERE user_id = (SELECT auth.uid())));

-- SELECT er auto-grantet til authenticated for enhver ny tabel (se
-- database/2026-08-14-2830-revoke-truncate-og-default-privileges.sql: "SELECT
-- revokes ikke"), men vi skriver det eksplicit saa politikken ovenfor ikke kan
-- rende ind i 42501 hvis default-privilegierne strammes senere (#4943).
GRANT SELECT ON public.rider_training_scores TO authenticated;

-- INGEN INSERT/UPDATE/DELETE-grants: kun service-role (motoren) skriver.

-- ── 4) Feature-flag for VISNINGEN (default OFF) ──────────────────────────────
-- Flaget gater KUN fladerne (kolonnen + profilkortet). Motoren skriver raekker
-- fra dag ét, saa der ER historik at vise naar flaget taendes — uden det ville
-- den foerste sparkline vaere et enkelt punkt og 30-dages-aggregatet tomt.
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'training_score_visible',
    'false'::jsonb,
    'When true, the 1-99 training score is shown to managers: a sortable Score column with a 7-day sparkline on the training roster, and a score card on the rider profile training tab (#4851). The engine writes rider_training_scores rows regardless of this flag, so history exists before the flag is flipped.'
  )
  ON CONFLICT (key) DO NOTHING;
