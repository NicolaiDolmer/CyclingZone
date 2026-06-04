-- Race Engine V1 — fundament-schema (#676). Fysiologi-først ryttermodel.
-- ADR: docs/decisions/race-engine-architecture-v1.md §"Database schema proposal".
--
-- To nye tabeller, INGEN ændring af eksisterende race-afvikling:
--   * rider_physiology_profiles — kanonisk fysiologi-kilde (watt/W·kg/zoner).
--     Seedes fra de 14 legacy stat_*-felter via backend/lib/physiologySeeding.js
--     (formula_version=1), kørt af backend/scripts/backfillRacePhysiology.js.
--   * rider_derived_abilities — 0-99 game-abilities UDLEDT fra physiology, til
--     hurtig UI-visning. Fuldt reproducérbar fra physiology + formula_version.
--
-- Faseplan: engine styrer IKKE sæson 2 (PCM kører videre). Dette er fundamentet;
-- selve simulatoren + stage-profiler er #1021 (sæson 3-overgang).
--
-- ID-type: UUID (riders.id er UUID — ADR's "uuid/bigint"-hedge løses til UUID).
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

-- ── rider_physiology_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rider_physiology_profiles (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rider_id                    UUID NOT NULL UNIQUE REFERENCES public.riders(id) ON DELETE CASCADE,

  -- Sustained power
  ftp_wkg                     NUMERIC(4,2) NOT NULL,  -- W/kg @ FTP (elite 3.00-6.80)
  ftp_watts                   INTEGER      NOT NULL,  -- = ftp_wkg * weight_kg (lagret for query/debug)
  vo2max_power_wkg            NUMERIC(4,2) NOT NULL,  -- ~3-5 min power W/kg
  zone2_power_wkg             NUMERIC(4,2) NOT NULL,  -- LT1/aerob endurance proxy

  -- Short-duration / neuromuscular
  pmax_watts                  INTEGER      NOT NULL,  -- ~1s peak (absolut)
  power_5s_wkg                NUMERIC(4,2) NOT NULL,  -- sprint launch
  power_15s_wkg               NUMERIC(4,2) NOT NULL,  -- sprint sustain
  power_1m_wkg                NUMERIC(4,2) NOT NULL,  -- anaerob/punch
  power_5m_wkg                NUMERIC(4,2) NOT NULL,  -- VO2/puncheur/kort klatring

  -- Capacity / durability
  high_intensity_energy_kj    NUMERIC(5,1) NOT NULL,  -- W'/HIE/FRC (finit arbejde > threshold)
  time_to_exhaustion_ftp_min  INTEGER      NOT NULL,  -- TTE @ FTP (TT + lange stigninger)
  fatigue_resistance          NUMERIC(4,3) NOT NULL,  -- 0.000-1.000 durability
  recovery_rate               NUMERIC(4,3) NOT NULL,  -- 0.000-1.000 mellem-effort reconstitution

  -- Body snapshot (til relativ/absolut power + aero)
  height_cm                   NUMERIC(5,2) NOT NULL,
  weight_kg                   NUMERIC(5,2) NOT NULL,

  -- Provenance
  source                      TEXT    NOT NULL DEFAULT 'seeded_from_legacy'
                                CHECK (source IN ('seeded_from_legacy','manual_admin','import','training_update')),
  version                     INTEGER NOT NULL DEFAULT 1,  -- bump ved formel-/kilde-ændring
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rider_physiology_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_physiology_select_authenticated" ON public.rider_physiology_profiles;
CREATE POLICY "rider_physiology_select_authenticated"
  ON public.rider_physiology_profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rider_physiology_admin_write" ON public.rider_physiology_profiles;
CREATE POLICY "rider_physiology_admin_write"
  ON public.rider_physiology_profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.rider_physiology_profiles IS
  'Race Engine V1 (#676): kanonisk fysiologi pr. rytter (watt/W·kg/zoner). Seedet fra legacy stat_* via physiologySeeding.js (formula_version=1). Read=authenticated, write=admin; mutationer via service_role-backfill.';

-- ── rider_derived_abilities ──────────────────────────────────────────────────
-- 0-99 game-abilities udledt deterministisk fra physiology. Én række pr. rytter
-- (rider_id = PK). Regenereres via abilityDerivation.js — aldrig source of truth.
CREATE TABLE IF NOT EXISTS public.rider_derived_abilities (
  rider_id        UUID PRIMARY KEY REFERENCES public.riders(id) ON DELETE CASCADE,
  formula_version INTEGER  NOT NULL DEFAULT 1,

  climbing        SMALLINT NOT NULL CHECK (climbing        BETWEEN 0 AND 99),
  time_trial      SMALLINT NOT NULL CHECK (time_trial      BETWEEN 0 AND 99),
  sprint          SMALLINT NOT NULL CHECK (sprint          BETWEEN 0 AND 99),
  punch           SMALLINT NOT NULL CHECK (punch           BETWEEN 0 AND 99),
  endurance       SMALLINT NOT NULL CHECK (endurance       BETWEEN 0 AND 99),
  cobble_classics SMALLINT NOT NULL CHECK (cobble_classics BETWEEN 0 AND 99),
  acceleration    SMALLINT NOT NULL CHECK (acceleration    BETWEEN 0 AND 99),
  recovery        SMALLINT NOT NULL CHECK (recovery        BETWEEN 0 AND 99),
  tactics         SMALLINT NOT NULL CHECK (tactics         BETWEEN 0 AND 99),
  positioning     SMALLINT NOT NULL CHECK (positioning     BETWEEN 0 AND 99),

  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.rider_derived_abilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rider_derived_abilities_select_authenticated" ON public.rider_derived_abilities;
CREATE POLICY "rider_derived_abilities_select_authenticated"
  ON public.rider_derived_abilities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rider_derived_abilities_admin_write" ON public.rider_derived_abilities;
CREATE POLICY "rider_derived_abilities_admin_write"
  ON public.rider_derived_abilities FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.rider_derived_abilities IS
  'Race Engine V1 (#676): 0-99 game-abilities udledt fra rider_physiology_profiles (abilityDerivation.js). Reproducérbar fra physiology + formula_version — ikke source of truth.';
