-- Race Engine v3 (#2224), slice S1 — roller med pris (#2352).
-- Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md
--   §11.1 (race_stage_roles — S3's per-etape-roller, forward-scaffoldet nu så
--   race_role-enum'en er ét sted) + §11.3 (race_simulation_rider_scores —
--   why-lag/admin-komponent-persistens) + race_role-udvidelse (free_role) på
--   race_entries.
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER MANUELT POST-MERGE (ejer-politik,
-- jf. feedback_migrations_never_auto_apply_via_mcp). Ingen apply_migration/psql
-- er kørt af agenten. Idempotent (CREATE TABLE IF NOT EXISTS, DO-blok for
-- CHECK-constraint-udskiftning, INSERT ... ON CONFLICT DO NOTHING).

-- ── 1) race_role-udvidelse: 'free_role' (S1, spec §6) ─────────────────────────
-- race_entries.race_role fik sin oprindelige CHECK i 2026-06-12-race-entries-
-- roles.sql som en INLINE column-CHECK — Postgres' standard-navngivning for den
-- er '<table>_<column>_check', altså 'race_entries_race_role_check' (samme navn
-- vi giver den udvidede constraint her). DROP CONSTRAINT IF EXISTS + navngivet
-- ADD CONSTRAINT er idempotent (re-run dropper netop DENNE constraint og
-- genskaber den identisk) — jf. scripts/lint-migration-idempotency.mjs.
ALTER TABLE public.race_entries
  DROP CONSTRAINT IF EXISTS race_entries_race_role_check;

ALTER TABLE public.race_entries
  ADD CONSTRAINT race_entries_race_role_check
    CHECK (race_role IN ('captain', 'sprint_captain', 'hunter', 'helper', 'free_role'));

COMMENT ON COLUMN public.race_entries.race_role IS
  '#1307/#2352: captain/sprint_captain/hunter/helper/free_role. Default helper. free_role (S1, #2224) = 0 work-cost, 0 holdbidrag ("kør dit eget løb"). Manager-udtagelse sætter roller; autopick sætter captain (+ evt. sprint_captain).';

-- ── 2) race_stage_roles (§11.1, S3-forward-scaffold) ──────────────────────────
-- Roller + effort PR. ETAPE (#2034). Fallback-kæde ved resolution (S3):
-- stage-række → race_entries.race_role → ingen rolle. Oprettes nu (idempotent,
-- ubrugt indtil S3 wirer API/UI) så S1's race_role-enum + S3's effort-enum er
-- ÉT sted defineret fra starten, jf. "race_role-udvidelser" i S1-scopet.
CREATE TABLE IF NOT EXISTS public.race_stage_roles (
  race_id      uuid    NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  rider_id     uuid    NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  race_role    text    NOT NULL CHECK (race_role IN ('captain', 'sprint_captain', 'helper', 'hunter', 'free_role')),
  effort       text    NOT NULL DEFAULT 'normal' CHECK (effort IN ('protect', 'normal', 'save')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, stage_number, rider_id)
);

ALTER TABLE public.race_stage_roles ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT for holdets ejer (join teams.owner_id via race_entries) + admin;
-- write = service_role (backend) — spejler race_entries-policy-mønsteret.
DROP POLICY IF EXISTS "race_stage_roles_owner_select" ON public.race_stage_roles;
CREATE POLICY "race_stage_roles_owner_select"
  ON public.race_stage_roles FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.race_entries re
      JOIN public.teams t ON t.id = re.team_id
      WHERE re.race_id = race_stage_roles.race_id
        AND re.rider_id = race_stage_roles.rider_id
        AND t.user_id = auth.uid()  -- teams har user_id, ikke owner_id (apply-fejl fanget 12/7)
    )
  );

DROP POLICY IF EXISTS "race_stage_roles_admin_write" ON public.race_stage_roles;
CREATE POLICY "race_stage_roles_admin_write"
  ON public.race_stage_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_stage_roles IS
  '#2034/#2352 (S1-scaffold, S3-forbrug): roller + effort pr. (løb, etape, rytter). Ubrugt indtil S3 wirer API/UI/motor — oprettet nu så race_role/effort-enums er ét sted. Fallback ved manglende række: race_entries.race_role, effort=normal.';

-- ── 3) race_simulation_rider_scores (§11.3) — why-lag/admin-komponent-persistens ──
-- Komponenterne (terrain/noise/form/fatigue/team/breakaway/finale/work_cost m.fl.)
-- pr. rytter pr. etape-run. Skrives KUN når race_engine_v3_scoring er ON
-- (backend/lib/raceRunner.js persistRuns) — admin-formål (why-rapport, S6).
-- run_id → race_simulation_runs.id (PK, verificeret 2026-06-07-race-engine-
-- slice2.sql). ON DELETE CASCADE: race_simulation_runs' idempotente
-- delete-then-insert pr. (race_id, stage_number) rydder automatisk gamle
-- rider_scores op sammen med deres run.
CREATE TABLE IF NOT EXISTS public.race_simulation_rider_scores (
  run_id     uuid    NOT NULL REFERENCES public.race_simulation_runs(id) ON DELETE CASCADE,
  rider_id   uuid    NOT NULL,
  rank       integer NOT NULL,
  components jsonb   NOT NULL, -- {terrain,noise,form,fatigue,team,breakaway,finale,work_cost,...}
  PRIMARY KEY (run_id, rider_id)
);

CREATE INDEX IF NOT EXISTS idx_race_simulation_rider_scores_run ON public.race_simulation_rider_scores(run_id);

ALTER TABLE public.race_simulation_rider_scores ENABLE ROW LEVEL SECURITY;

-- RLS: ADMIN-ONLY (natbølge-review 12/7) — rå komponent-dekomponering
-- (terrain/dagsform/jour_sans/work_cost pr. rytter) er skjult "why"-info; en
-- bred SELECT-authenticated ville lade enhver spiller læse rivalers dagsform
-- via PostgREST den dag flaget flippes. Spejler søster-tabellen
-- race_simulation_runs' policy-mønster (admin-only; service_role/backend
-- bypasser RLS ved skrivning). S6's spillervendte why-rapport læser via et
-- API-lag (service_role) der oversætter rå tal → kvalitative bånd — det
-- kræver INGEN authenticated-SELECT på selve tabellen.
DROP POLICY IF EXISTS "race_simulation_rider_scores_select_authenticated" ON public.race_simulation_rider_scores;
DROP POLICY IF EXISTS "race_simulation_rider_scores_admin_write" ON public.race_simulation_rider_scores;
DROP POLICY IF EXISTS "race_simulation_rider_scores_admin_all" ON public.race_simulation_rider_scores;
CREATE POLICY "race_simulation_rider_scores_admin_all"
  ON public.race_simulation_rider_scores FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.race_simulation_rider_scores IS
  '#2224/#2352 (S1): komponenter pr. rytter pr. etape-run (why-lag, S6-forbrug). Skrives KUN når race_engine_v3_scoring er ON (backend/lib/raceRunner.js). ~200 rækker/etape. ADMIN-ONLY RLS (rå tal afslører rivalers dagsform); spillervendt why læser bånd via service_role-API (S6).';

-- ── 4) Flag: race_engine_v3_scoring kill-switch (default off) ────────────────
-- Tre-tilstands-skema (off|beta|on), samme mønster som race_engine_v2_enabled
-- (2026-06-13-beta-access.sql). Ejer-politik: kill-switch, ingen beta-gates —
-- 'beta' understøttes teknisk men bruges ikke i praksis.
INSERT INTO public.app_config (key, value, description) VALUES
  ('race_engine_v3_scoring', '"off"'::jsonb,
   'Race Engine v3 (#2224) dominans/varians-dybde (S1 roller-med-pris, S2 dagsform, ...). off|beta|on. off (default) = motoren scorer bit-identisk med dagens (v1). Kræver race_engine_v2_enabled=on/beta for overhovedet at køre.')
ON CONFLICT (key) DO NOTHING;
