-- Race Engine v3 (#2224), slice S4 (#1176) — styrt/mekaniske uheld + DNF.
-- Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md
--   (incident-mekanikken udvider §11's why-lag/admin-tabeller med en fjerde:
--   race_incidents, samme mønster som race_stage_roles/race_simulation_rider_scores).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/
-- execute_sql er kørt af agenten. Idempotent (CREATE TABLE IF NOT EXISTS,
-- DROP POLICY IF EXISTS + genskab).

-- ── race_incidents — uheld pr. (løb, etape, rytter) ───────────────────────────
-- outcome='time_loss': sekunder lagt til rytterens stageGap (gap-space, se
--   backend/lib/raceSimulator.js's components.incident). outcome='abandon':
--   rytteren udgår resten af løbet (DNF = ingen etape-række fra denne etape og
--   frem — raceClassifications.filterCompletedEntrants ekskluderer ham
--   automatisk fra ALLE klassementer, ingen ny kolonne på race_results).
-- UNIQUE (race_id, stage_number, rider_id): højst ét uheld pr. rytter pr. etape
-- — matcher persistIncidents' delete-then-insert-idempotens (backend/lib/raceRunner.js).
CREATE TABLE IF NOT EXISTS public.race_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('crash', 'mechanical')),
  outcome text NOT NULL CHECK (outcome IN ('time_loss', 'abandon')),
  time_loss_seconds integer,
  injury_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id, stage_number, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_race_incidents_race ON public.race_incidents(race_id);

ALTER TABLE public.race_incidents ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT for holdets ejer (join teams.owner_id via race_entries) + admin;
-- write = service_role (backend, bypasser RLS) — spejler race_stage_roles'
-- RETTET 12/7 før apply: uheld er OFFENTLIG løbsinformation (DNF-sektion,
-- recap, Discord) — læs-policy spejler race_results (læs for alle authenticated),
-- IKKE race_stage_roles (taktik = hemmelig pr. hold). Ejer-scoped SELECT ville
-- have gjort DNF-listen tom for alle andres ryttere.
DROP POLICY IF EXISTS "race_incidents_owner_select" ON public.race_incidents;
DROP POLICY IF EXISTS "race_incidents_read" ON public.race_incidents;
CREATE POLICY "race_incidents_read"
  ON public.race_incidents FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "race_incidents_admin_write" ON public.race_incidents;
CREATE POLICY "race_incidents_admin_write"
  ON public.race_incidents FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_incidents IS
  '#2224/#1176 (S4): styrt/mekaniske uheld pr. (løb, etape, rytter). outcome=time_loss tilføjer sekunder til stageGap (gap-space, rører ikke finalScore); outcome=abandon = DNF (ingen etape-række resten af løbet) + sætter rider_condition.injured_until/injury_cause=race_crash. Skrives KUN når race_engine_v3_scoring er ON (backend/lib/raceRunner.js persistIncidents).';
