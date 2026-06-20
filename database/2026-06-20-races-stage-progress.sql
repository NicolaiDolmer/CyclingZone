-- 2026-06-20 · Stage-by-stage race-afvikling (WS1 Fase 3).
-- Plan: docs/superpowers/plans/2026-06-20-ws1-fase3-stage-by-stage-race.md
--
-- Ejer-direktiv (20/6): "Afviklinger fra nu af er altid én etape ad gangen."
-- Et løb afvikles én etape pr. dag på et synligt, fast tidspunkt. Denne migration
-- tilføjer:
--   1. races.stages_completed — hvor langt løbet er afviklet (0 = ikke startet).
--   2. races.scheduled_for     — løbets startdag (audit/display; etape-tider bor i tabellen nedenfor).
--   3. race_stage_schedule     — player-facing kalender: ét tidspunkt pr. (race, etape).
--
-- BEHAVIOUR-NEUTRAL: ingen kode læser kolonnerne automatisk endnu. Stage-scheduleren
-- er gated bag runtime-flag stage_scheduler_enabled (fail-safe OFF) — denne migration
-- ændrer derfor INGEN afvikling. Sikker at merge før aktivering.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS · CREATE TABLE/INDEX IF NOT EXISTS ·
-- DROP POLICY IF EXISTS før CREATE. schema_migrations-insert håndteres af
-- .github/workflows/auto-migrate.yml (ingen manuel insert her — mirror nyere migrations).

-- ── races: stage-progress + startdag ─────────────────────────────────────────
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS stages_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_for    TIMESTAMPTZ;

-- Scheduleren scanner ikke-completede løb på startdag → partial index.
CREATE INDEX IF NOT EXISTS races_scheduled_for_active_idx
  ON public.races (scheduled_for, season_id) WHERE status <> 'completed';

-- Beslutning E: korrekt audit-semantik for allerede-afviklede løb — et completed
-- løb har per definition kørt alle sine etaper. COALESCE(stages, 1): stages_completed
-- er NOT NULL, så en completed-række med NULL stages (ældre/ufuldstændig data) ville
-- ellers krænke NOT NULL-constraintet og vælte migrationen.
UPDATE public.races SET stages_completed = COALESCE(stages, 1) WHERE status = 'completed';

-- RLS-NOTE (verificeret mod schema.sql:576): races har TABLE-level RLS
--   CREATE POLICY "Public read races" ON races FOR SELECT USING (true);
-- → nye kolonner stages_completed/scheduled_for er allerede klient-læsbare via den
-- eksisterende policy. En kolonne-GRANT (som #1162-mønstret for riders, der bruger
-- kolonne-privilegier) er her REDUNDANT og udelades bevidst — races styres af row-RLS,
-- ikke kolonne-privilegier. Ingen "permission denied"-risiko (modsat #1309).

-- ── race_simulation_runs: source-diskriminator til daglig stage-cap ──────────
-- Stage-scheduleren har en hard-cap (maks 5 etaper/dag, loop-prævention). Den cap
-- må KUN tælle scheduler-drevne etape-runs — ikke runs skrevet af en admin-fuld-
-- simulering (simulateRace skriver én run-række pr. etape, så ét admin-fuld-sim af
-- et 5-etapers løb ville ellers opbruge hele dagsbudgettet). source-kolonnen lader
-- countStagesDoneToday filtrere på source='scheduler'. NULL = ældre/admin-runs (tælles
-- ikke i cap'en). Nullable + uden default → behaviour-neutral for eksisterende rækker.
ALTER TABLE public.race_simulation_runs
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Hot-path: scheduler-cap'en tæller source='scheduler'-rækker siden dansk midnat.
CREATE INDEX IF NOT EXISTS idx_race_simulation_runs_source_created
  ON public.race_simulation_runs (source, created_at);

COMMENT ON COLUMN public.race_simulation_runs.source IS
  'WS1 Fase 3: hvem skrev denne run-række. ''scheduler'' = stage-scheduler-cron (tælles i daglig cap). NULL = admin-fuld-sim / manuel afvikling (tælles IKKE i cap).';

-- ── race_stage_schedule: synlig etape-kalender (Beslutning A+B) ───────────────
-- Ét scheduled_at pr. (race, etape). Player-facing: spillerne kan se 'Etape 3 kl. 15:00'.
-- Scheduleren finder forfaldne etaper via scheduled_at <= now() AND
-- stage_number = races.stages_completed + 1 (ikke deterministisk offset).
CREATE TABLE IF NOT EXISTS public.race_stage_schedule (
  race_id      UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL CHECK (stage_number >= 1),
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, stage_number)
);

-- Scheduler-hot-path: forfaldne etaper sorteret på tid.
CREATE INDEX IF NOT EXISTS race_stage_schedule_due_idx
  ON public.race_stage_schedule (scheduled_at);

ALTER TABLE public.race_stage_schedule ENABLE ROW LEVEL SECURITY;

-- Player-facing kalender → read for authenticated (mirror race_entries-mønstret).
DROP POLICY IF EXISTS "race_stage_schedule_select_authenticated" ON public.race_stage_schedule;
CREATE POLICY "race_stage_schedule_select_authenticated"
  ON public.race_stage_schedule FOR SELECT TO authenticated USING (true);

-- Write kun admin; backfill/scheduler skriver via service_role (bypasser RLS).
DROP POLICY IF EXISTS "race_stage_schedule_admin_write" ON public.race_stage_schedule;
CREATE POLICY "race_stage_schedule_admin_write"
  ON public.race_stage_schedule FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_stage_schedule IS
  'WS1 Fase 3 (stage-by-stage): synlig etape-kalender — ét scheduled_at pr. (race, etape). Read=authenticated (player-facing), write=admin (backfill/scheduler via service_role). Scheduleren afvikler etape N når scheduled_at <= now() AND stage_number = races.stages_completed + 1.';

COMMENT ON COLUMN public.races.stages_completed IS
  'WS1 Fase 3: antal afviklede etaper (0 = ikke startet). status forbliver scheduled under afvikling; skifter til completed når stages_completed = stages.';
COMMENT ON COLUMN public.races.scheduled_for IS
  'WS1 Fase 3: løbets startdag (audit/display). Etape-tider bor i race_stage_schedule.';
