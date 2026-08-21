-- 2026-08-21 · #4030 #3855 — race_team_orders: ENESTE sandhed for taktik-
-- ordrer (rolle + effort + udbrud) pr. (team, race, stage), ejer-beslutning
-- 21/8 (docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md).
--
-- AFLØSER race_stage_roles (S1-forward-scaffold, 2026-07-12-race-v3-s1-work-
-- cost.sql). race_stage_roles har INTET team_id (kræver join via race_entries)
-- og INGEN udbruds-/effort-koncept ud over per-rytter effort — race_team_orders
-- er team-scopet fra bunden og bærer HELE T1-T4-taktik-kontrakten i én række
-- pr. (team, race, stage):
--   · riders (jsonb)       [{rider_id, race_role, effort, try_break}, ...]
--   · breakaway_stance     T3 hold-stance: chase/neutral/let_go
--   · locked_at            T2: udfyldes ved etapestart-snapshot (F3/raceRunner-
--                           ansvar, IKKE denne migration eller CRUD-endpointet —
--                           API'et afviser blot writes efter lock, se
--                           backend/lib/raceTeamOrdersApi.js#isStageLocked).
--
-- UDFASNING (ejer-mandat 21/8): race_stage_roles droppes IKKE her — det er
-- ejer-gated efter v4-flippet (destruktiv klasse). v3-læsestien
-- backend/lib/raceStageRolesApi.js/raceStageRoles.js peger STADIG på
-- race_stage_roles indtil da (se PR-noten for #4030).
--
-- COMMITTES SOM .sql — ANVENDES KUN AF EJER/CLAUDE POST-MERGE under #2642-
-- rammer (idempotent + post-verify). Ingen apply_migration er kørt af agenten.
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE INDEX IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.race_team_orders (
  team_id           uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  race_id           uuid        NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number      integer     NOT NULL CHECK (stage_number >= 1),
  breakaway_stance  text        NOT NULL DEFAULT 'neutral'
                                CHECK (breakaway_stance IN ('chase', 'neutral', 'let_go')),
  -- [{rider_id: uuid, race_role: 'captain'|'sprint_captain'|'helper'|'hunter'|'free_role',
  --   effort: 'protect'|'normal'|'save', try_break: boolean}, ...]. Shape håndhæves i
  -- API-laget (raceTeamOrdersApi.js's validateTeamOrder), ikke som DB-CHECK — samme
  -- konvention som race_simulation_rider_scores.components (ingen JSONB-shape-CHECK i repoet).
  riders            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  locked_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, race_id, stage_number)
);

COMMENT ON TABLE public.race_team_orders IS
  '#4030/#3855 (F3 taktik-ordrer v1, ejer-beslutning 21/8): eneste sandhed for rolle+effort+udbrud pr. (team, race, stage). Afløser race_stage_roles (udfases efter v4-flippet, ejer-gated DROP). GET/PUT: backend/routes/api.js /races/:raceId/team-orders?stage=N. Adapter til motor-kontrakten: backend/lib/engine/v4/orders/teamOrdersAdapter.ts.';
COMMENT ON COLUMN public.race_team_orders.riders IS
  'Per-rytter taktik: rider_id, race_role, effort, try_break (T3, #4030). Validering i API-laget, ikke DB-CHECK.';
COMMENT ON COLUMN public.race_team_orders.locked_at IS
  'T2 (taktik-spec): tidsstempel for etapestart-snapshot. NULL indtil F3/raceRunner snapshotter ved lock — denne kolonne udfyldes IKKE af CRUD-endpointet selv (det afviser blot writes efter lock via race_stage_schedule.scheduled_at-sammenligning, se isStageLocked).';

-- Bulk-læsning for motoren (ALLE hold for ét løb+etape, samme adgangsmønster
-- som race_stage_roles.loadStageRoleOverrides) — PK starter med team_id, så en
-- separat (race_id, stage_number)-indgang er nødvendig.
CREATE INDEX IF NOT EXISTS idx_race_team_orders_race_stage
  ON public.race_team_orders (race_id, stage_number);

ALTER TABLE public.race_team_orders ENABLE ROW LEVEL SECURITY;

-- RLS-mønster efter #2677-splitten (docs: 2026-08-19-2677-rls-initplan-permissive-
-- split.sql) — auth.uid()/is_admin() InitPlan-wrappet, SELECT og skrive-policies
-- separate (undgår multiple_permissive_policies). Skrivning sker i praksis via
-- backend service_role (RLS bypasses) — admin-policies dækker direkte Studio-/
-- MCP-adgang, ligesom race_stage_roles/rider_peak_plans.
DROP POLICY IF EXISTS race_team_orders_owner_select ON public.race_team_orders;
CREATE POLICY race_team_orders_owner_select ON public.race_team_orders
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS race_team_orders_admin_write ON public.race_team_orders;
DROP POLICY IF EXISTS race_team_orders_admin_insert ON public.race_team_orders;
CREATE POLICY race_team_orders_admin_insert ON public.race_team_orders
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS race_team_orders_admin_update ON public.race_team_orders;
CREATE POLICY race_team_orders_admin_update ON public.race_team_orders
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS race_team_orders_admin_delete ON public.race_team_orders;
CREATE POLICY race_team_orders_admin_delete ON public.race_team_orders
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

COMMIT;

-- ── Post-apply sanity (kør manuelt, ikke en del af transaktionen) ────────────
-- select count(*) from public.race_team_orders;                          -- forventes 0 lige efter denne fil
-- select * from pg_policies where tablename = 'race_team_orders';        -- forventes 4 policies (1 select + 3 write)
