-- Race Engine light-motor (#1102), slice 2 — startfelt + sim-run-audit + flag.
-- ADR: docs/decisions/race-engine-architecture-v1.md. Ejer-besluttede forks 2026-06-07:
--   F1=B race_entries (eksplicit startfelt, manager-agency), F4=C race_simulation_runs
--   (repro-snapshot pr. run; per-rytter dekomponering returneres in-memory).
--
-- INGEN ændring af eksisterende race-afvikling: motoren er bag RACE_ENGINE_V2_ENABLED
-- (seedet OFF nedenfor). flag-off = PCM-import-stien er præcis uændret (nød-fallback).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS før CREATE.
-- schema_migrations-insert håndteres af .github/workflows/auto-migrate.yml.

-- ── race_entries — startfeltet pr. løb (F1=B) ─────────────────────────────────
-- Hvem stiller op. Auto-fyldes deterministisk af raceRunner.loadEntrantsForRace
-- når tomt (alle aktive ryttere på rigtige+AI-hold); manager-udtagnings-UI er slice 3.
-- team_id = det deltagende hold (autoritativt "hvem startede for hvem").
CREATE TABLE IF NOT EXISTS public.race_entries (
  race_id        UUID NOT NULL REFERENCES public.races(id)  ON DELETE CASCADE,
  rider_id       UUID NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id        UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  is_auto_filled BOOLEAN NOT NULL DEFAULT FALSE,  -- false = manager-udtaget (slice 3)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_race_entries_race ON public.race_entries(race_id);

ALTER TABLE public.race_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "race_entries_select_authenticated" ON public.race_entries;
CREATE POLICY "race_entries_select_authenticated"
  ON public.race_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "race_entries_admin_write" ON public.race_entries;
CREATE POLICY "race_entries_admin_write"
  ON public.race_entries FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_entries IS
  'Race Engine light-motor (#1102 slice 2): startfelt pr. løb. Auto-fyldt af raceRunner når tomt; manager-udtagning = slice 3. Read=authenticated, write=admin (auto-fill via service_role).';

-- ── race_simulation_runs — repro-audit pr. afvikling (F4=C) ───────────────────
-- Én række pr. (løb, etape): seed + entrant-snapshot + input-checksum → en afvikling
-- kan reproduceres OGSÅ efter abilities/demand_vectors er re-backfilled. Per-rytter
-- score-komponenter persisteres IKKE i slice 2 (returneres in-memory; #1021 tilføjer
-- race_simulation_rider_scores additivt). seed/input_checksum er FNV-32 → BIGINT.
CREATE TABLE IF NOT EXISTS public.race_simulation_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  race_id          UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number     INTEGER NOT NULL DEFAULT 1 CHECK (stage_number >= 1),
  seed             BIGINT  NOT NULL,
  engine_version   INTEGER NOT NULL DEFAULT 1,
  entrant_snapshot JSONB   NOT NULL,  -- rider_ids der startede (sorteret)
  input_checksum   BIGINT  NOT NULL,  -- hash af entrants + demand_vector + profil
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (race_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_race_simulation_runs_race ON public.race_simulation_runs(race_id);

ALTER TABLE public.race_simulation_runs ENABLE ROW LEVEL SECURITY;

-- Intern debug/audit → kun admin (service_role bypasser RLS ved skrivning fra runneren).
DROP POLICY IF EXISTS "race_simulation_runs_admin_all" ON public.race_simulation_runs;
CREATE POLICY "race_simulation_runs_admin_all"
  ON public.race_simulation_runs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_simulation_runs IS
  'Race Engine light-motor (#1102 slice 2): repro-snapshot pr. afvikling (seed + entrant-snapshot + checksum). Per-rytter komponenter = in-memory i slice 2; #1021 tilføjer race_simulation_rider_scores. Admin-only.';

-- ── Feature-flag (seedet OFF) ─────────────────────────────────────────────────
-- Læses af backend/lib/raceEngineFlag.js. OFF = PCM-stien er eneste resultat-kilde.
INSERT INTO public.app_config (key, value, description)
VALUES (
  'race_engine_v2_enabled',
  'false'::jsonb,
  'Race Engine light-motor (#1102). true = raceRunner/raceSimulator afvikler løb; false (default) = PCM-import-stien er præcis uændret (nød-fallback). Flip kun efter golden/distributions-verifikation + fiktiv population (#677/#669).'
)
ON CONFLICT (key) DO NOTHING;
