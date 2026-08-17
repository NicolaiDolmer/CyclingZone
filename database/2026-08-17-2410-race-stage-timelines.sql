-- Event-loggen: etape-tidslinjen som førsteklasses artefakt (#2410), S1.
-- Spec: docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md
--   §2 (kontrakt), §4 valg 1 (lagringsform, ejer-besluttet 17/8: JSONB-artefakt
--   pr. etape, IKKE række-pr-event).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER/ARKITEKT MANUELT POST-MERGE (#2642-
-- rammer, ejer-politik jf. feedback_migrations_never_auto_apply_via_mcp). Ingen
-- apply_migration/execute_sql er kørt af agenten. Idempotent (CREATE TABLE IF
-- NOT EXISTS, DROP POLICY IF EXISTS + genskab).

-- ── race_stage_timelines — ÉN deterministisk genereret event-tidslinje pr. ────
-- (race_id, stage_number). Genereres af backend/lib/raceTimeline.js
-- (buildStageTimeline, REN funktion) i samme build-trin som race_stage_moments/
-- race_stage_passages, persisteres bag flag `race_stage_timeline`
-- (backend/lib/raceEngineFlag.js). `events` er en ordnet JSONB-array af
-- {km, type, params} — km ∈ [0, distance_km], sorteret på km. Se spec §2.2 for
-- event-taksonomi og §2.3 for konsistensreglerne tidslinjen er bundet af.
--
-- `timeline_version` bumpes når generator-logikken ændrer sig; gamle artefakter
-- re-genereres IKKE automatisk (spec §2.1) — en aftager kan derfor se forskellige
-- versioner for forskellige etaper i samme løb, og skal håndtere det.
--
-- Idempotent delete-then-insert pr. (race_id, stage_number) — SAMME mønster som
-- race_stage_moments/race_incidents (backend/lib/raceRunner.js persistStageTimelines).
CREATE TABLE IF NOT EXISTS public.race_stage_timelines (
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  timeline_version integer NOT NULL DEFAULT 1,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, stage_number)
);

ALTER TABLE public.race_stage_timelines ENABLE ROW LEVEL SECURITY;

-- RLS: SPEJLER race_stage_moments PRÆCIS (spec §2.4: "Spillervendt RLS (samme
-- model som race_stage_moments)") — SELECT for alle authenticated (offentlig
-- løbsinformation, ren renderer af allerede-offentlige resultater/passager).
-- Write = admin/service_role (backend bypasser RLS ved persistering).
DROP POLICY IF EXISTS "race_stage_timelines_read" ON public.race_stage_timelines;
CREATE POLICY "race_stage_timelines_read"
  ON public.race_stage_timelines FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "race_stage_timelines_admin_write" ON public.race_stage_timelines;
CREATE POLICY "race_stage_timelines_admin_write"
  ON public.race_stage_timelines FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_stage_timelines IS
  '#2410 (event-log S1): deterministisk genereret etape-tidslinje pr. (race_id, stage_number). Skrives KUN når flag race_stage_timeline er ON (backend/lib/raceRunner.js persistStageTimelines, spejler persistStageMoments — graceful degradation hvis tabellen mangler). events = ordnet JSONB-array {km, type, params}, km ∈ [0, distance_km]. Genereret af backend/lib/raceTimeline.js (buildStageTimeline) — ren renderer, aldrig en kilde (konsistensregel 1: modsiger ALDRIG race_results/race_stage_passages/race_stage_moments). Fog-gate (#1791): ingen rå score-komponenter/vægte/sandsynligheder i params.';
