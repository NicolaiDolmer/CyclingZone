-- Race Engine v3 (#2224), slice S6 (#2355) — why-rapport + story-tags.
-- Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md §10
--   + docs/superpowers/specs/2026-07-11-narrative-systems-design.md §"System A" (A1-A2,
--   Tier 0/1-kontrakten race_stage_moments blev designet til — genbrugt her, IKKE en
--   paralleltabel, så narrativ-S2/#2356 kan bygge videre på samme substrat).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS + genskab).

-- ── race_stage_moments — AFLEDTE forklarings-momenter pr. (løb, etape) ────────
-- Bevidst IKKE de rå score-komponenter (dem persisterer race_simulation_rider_scores
-- allerede, admin-only RLS) — kun narrativt meningsfulde, fog-gate-sikre momenter:
-- rangeringer, tælletal, allerede-offentlige gaps, og "fyrede/ikke-fyrede"-boolske
-- afledninger af mekanikker. ALDRIG rå tal for skjulte konstanter (#1791).
--
-- To brug-mønstre af SAMME tabel (backend/lib/raceNarrative.js):
--   1) "Beats" — etape-fortællingens byggesten (sprint_win, gc_takeover, ...).
--   2) "Story-tags" — per-rytter badges (moment_key starter med 'tag_', fx
--      tag_jour_sans, tag_helper_sacrifice) til resultat-tabellens rytter-rækker.
-- Idempotent delete-then-insert pr. (race_id, stage_number) — samme mønster som
-- race_incidents/persistIncidents (backend/lib/raceRunner.js).
CREATE TABLE IF NOT EXISTS public.race_stage_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  moment_key text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  significance smallint NOT NULL DEFAULT 0,
  rider_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  team_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_race_stage_moments_race_stage
  ON public.race_stage_moments(race_id, stage_number);

ALTER TABLE public.race_stage_moments ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT for alle authenticated (offentlig løbsinformation — spejler
-- race_incidents_read, IKKE race_stage_roles' ejer-scopede taktik-policy).
-- Write = admin/service_role (backend bypasser RLS ved persistering).
DROP POLICY IF EXISTS "race_stage_moments_read" ON public.race_stage_moments;
CREATE POLICY "race_stage_moments_read"
  ON public.race_stage_moments FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "race_stage_moments_admin_write" ON public.race_stage_moments;
CREATE POLICY "race_stage_moments_admin_write"
  ON public.race_stage_moments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_stage_moments IS
  '#2224/#2355 (S6): afledte why-rapport-momenter + story-tags pr. (løb, etape). Skrives KUN når race_engine_v3_scoring er ON (backend/lib/raceRunner.js persistStageMoments, spejler persistIncidents). moment_key med tag_-præfiks = per-rytter story-tag (rider_ids har præcis 1 element); øvrige = etape-fortællingens beats. Ingen rå score-komponenter — kun fog-gate-sikre afledninger (backend/lib/raceNarrative.js).';
