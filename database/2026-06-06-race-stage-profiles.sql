-- Race Engine light-motor (#1102), slice 1 — stage-profil-lag.
-- ADR: docs/decisions/race-engine-architecture-v1.md §"race_stage_profiles".
--
-- Hvert løb får én række pr. etape (endagsløb: stage_number=1) med et terræn
-- (profile_type) + en normaliseret demand_vector som race-simulatoren (#1102
-- slice 2) scorer rider_derived_abilities mod. Genereret deterministisk af
-- backend/lib/raceStageProfileGenerator.js (seed = race.id), persisteret af
-- backend/scripts/backfillRaceStageProfiles.js. Spiller-synlig (slice 3) →
-- RLS select = authenticated.
--
-- LET subset af ADR-tabellen: rute-detaljer (distance/elevation/vejr m.m.) er
-- bevidst udeladt til den fulde engine (#1021), som ALTER'er dem på. Kolonne-
-- navnene matcher ADR'en, så light → fuld er en additiv migration, ikke en
-- omskrivning. is_manual beskytter håndredigerede etaper mod regenerering.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

CREATE TABLE IF NOT EXISTS public.race_stage_profiles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id           UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number      INTEGER NOT NULL DEFAULT 1 CHECK (stage_number >= 1),

  profile_type      TEXT NOT NULL CHECK (profile_type IN
                      ('flat','rolling','hilly','mountain','high_mountain','itt','ttt','cobbles','classic')),
  finale_type       TEXT CHECK (finale_type IS NULL OR finale_type IN
                      ('bunch_sprint','reduced_sprint','punch','long_climb','descent','solo_tt','breakaway')),
  demand_vector     JSONB NOT NULL,  -- normaliserede vægte (10 abilities + randomness), sum ~1.0

  generator_version INTEGER NOT NULL DEFAULT 1,  -- bump ved generator-/vægt-ændring → regenerér
  is_manual         BOOLEAN NOT NULL DEFAULT FALSE,  -- håndredigeret → backfill rører den ikke
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (race_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_race_stage_profiles_race ON public.race_stage_profiles(race_id);

ALTER TABLE public.race_stage_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_stage_profiles_select_authenticated" ON public.race_stage_profiles;
CREATE POLICY "race_stage_profiles_select_authenticated"
  ON public.race_stage_profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "race_stage_profiles_admin_write" ON public.race_stage_profiles;
CREATE POLICY "race_stage_profiles_admin_write"
  ON public.race_stage_profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_stage_profiles IS
  'Race Engine light-motor (#1102): terræn + demand_vector pr. etape. Genereret deterministisk (raceStageProfileGenerator.js, seed=race.id). Let subset af ADR-tabellen; rute-detaljer kommer i #1021. Read=authenticated (spiller-synlig), write=admin.';
