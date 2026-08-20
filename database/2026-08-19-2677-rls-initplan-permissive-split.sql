-- 2026-08-19 · #2677 — RLS perf-tuning: auth_rls_initplan (8 policies) +
-- multiple_permissive_policies (7 tabeller)
--
-- To mekaniske mønstre fra Supabase performance-advisors, ingen funktionel ændring:
--
-- A) auth_rls_initplan: `auth.uid()` direkte i en policy re-evalueres PR. RÆKKE.
--    Wrappet som `(SELECT auth.uid())` bliver kaldet en InitPlan der evalueres én
--    gang pr. query. Samme mønster anvendes på `public.is_admin()` hvor den indgår.
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- B) multiple_permissive_policies: admin-policies oprettet som FOR ALL dækker også
--    SELECT og overlapper read-policyen, så Postgres evaluerer to permissive policies
--    pr. række. Fix: split admin-ALL i separate INSERT/UPDATE/DELETE-policies, så
--    SELECT kun har én policy.
--
-- Adfærdsgaranti (acceptkriterie i #2677): admin kan stadig alt, ejere ser stadig eget.
--   · Tabeller med read-policy `USING (true)` dækker admin-SELECT allerede.
--   · race_stage_roles_owner_select havde allerede is_admin() OR-gren — bevaret.
--   · rider_peak_plans_owner_select havde IKKE admin-gren; admin-SELECT kom fra
--     admin_write(ALL)-policyen der fjernes her. Derfor tilføjes (SELECT public.is_admin())
--     OR eksplicit i den nye owner_select, så admin-læsning bevares 1:1.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY i én transaktion; kan re-runnes.

BEGIN;

-- =====================================================================
-- A. auth_rls_initplan — 8 policies genskabes med (SELECT auth.uid())
-- =====================================================================

-- scout_assignments
DROP POLICY IF EXISTS scout_assignments_owner_select ON public.scout_assignments;
CREATE POLICY scout_assignments_owner_select ON public.scout_assignments
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

-- training_week_plans (select/insert/update/delete)
DROP POLICY IF EXISTS training_week_plans_own_select ON public.training_week_plans;
CREATE POLICY training_week_plans_own_select ON public.training_week_plans
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_week_plans_own_insert ON public.training_week_plans;
CREATE POLICY training_week_plans_own_insert ON public.training_week_plans
  FOR INSERT TO authenticated
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_week_plans_own_update ON public.training_week_plans;
CREATE POLICY training_week_plans_own_update ON public.training_week_plans
  FOR UPDATE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())))
  WITH CHECK (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS training_week_plans_own_delete ON public.training_week_plans;
CREATE POLICY training_week_plans_own_delete ON public.training_week_plans
  FOR DELETE TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

-- wage_daily_runs
DROP POLICY IF EXISTS wage_daily_runs_select ON public.wage_daily_runs;
CREATE POLICY wage_daily_runs_select ON public.wage_daily_runs
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid())));

-- race_stage_roles (bevarer eksisterende is_admin() OR-gren, nu initplan-wrappet)
DROP POLICY IF EXISTS race_stage_roles_owner_select ON public.race_stage_roles;
CREATE POLICY race_stage_roles_owner_select ON public.race_stage_roles
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.race_entries re
      JOIN public.teams t ON t.id = re.team_id
      WHERE re.race_id = race_stage_roles.race_id
        AND re.rider_id = race_stage_roles.rider_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

-- rider_peak_plans (admin-gren TILFØJET — erstatter admin-SELECT fra den ALL-policy
-- der fjernes i sektion B, så admin-adgang er uændret)
DROP POLICY IF EXISTS rider_peak_plans_owner_select ON public.rider_peak_plans;
CREATE POLICY rider_peak_plans_owner_select ON public.rider_peak_plans
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.riders r
      JOIN public.teams t ON t.id = r.team_id
      WHERE r.id = rider_peak_plans.rider_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

-- =====================================================================
-- B. multiple_permissive_policies — split admin FOR ALL i insert/update/delete
--    (7 tabeller; read-policies røres ikke)
-- =====================================================================

-- race_incidents
DROP POLICY IF EXISTS race_incidents_admin_write ON public.race_incidents;
DROP POLICY IF EXISTS race_incidents_admin_insert ON public.race_incidents;
CREATE POLICY race_incidents_admin_insert ON public.race_incidents
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_incidents_admin_update ON public.race_incidents;
CREATE POLICY race_incidents_admin_update ON public.race_incidents
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_incidents_admin_delete ON public.race_incidents;
CREATE POLICY race_incidents_admin_delete ON public.race_incidents
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- race_stage_moments
DROP POLICY IF EXISTS race_stage_moments_admin_write ON public.race_stage_moments;
DROP POLICY IF EXISTS race_stage_moments_admin_insert ON public.race_stage_moments;
CREATE POLICY race_stage_moments_admin_insert ON public.race_stage_moments
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_moments_admin_update ON public.race_stage_moments;
CREATE POLICY race_stage_moments_admin_update ON public.race_stage_moments
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_moments_admin_delete ON public.race_stage_moments;
CREATE POLICY race_stage_moments_admin_delete ON public.race_stage_moments
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- race_stage_roles
DROP POLICY IF EXISTS race_stage_roles_admin_write ON public.race_stage_roles;
DROP POLICY IF EXISTS race_stage_roles_admin_insert ON public.race_stage_roles;
CREATE POLICY race_stage_roles_admin_insert ON public.race_stage_roles
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_roles_admin_update ON public.race_stage_roles;
CREATE POLICY race_stage_roles_admin_update ON public.race_stage_roles
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_roles_admin_delete ON public.race_stage_roles;
CREATE POLICY race_stage_roles_admin_delete ON public.race_stage_roles
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- race_stage_timelines
DROP POLICY IF EXISTS race_stage_timelines_admin_write ON public.race_stage_timelines;
DROP POLICY IF EXISTS race_stage_timelines_admin_insert ON public.race_stage_timelines;
CREATE POLICY race_stage_timelines_admin_insert ON public.race_stage_timelines
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_timelines_admin_update ON public.race_stage_timelines;
CREATE POLICY race_stage_timelines_admin_update ON public.race_stage_timelines
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS race_stage_timelines_admin_delete ON public.race_stage_timelines;
CREATE POLICY race_stage_timelines_admin_delete ON public.race_stage_timelines
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- rider_career_events
DROP POLICY IF EXISTS rider_career_events_admin_write ON public.rider_career_events;
DROP POLICY IF EXISTS rider_career_events_admin_insert ON public.rider_career_events;
CREATE POLICY rider_career_events_admin_insert ON public.rider_career_events
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS rider_career_events_admin_update ON public.rider_career_events;
CREATE POLICY rider_career_events_admin_update ON public.rider_career_events
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS rider_career_events_admin_delete ON public.rider_career_events;
CREATE POLICY rider_career_events_admin_delete ON public.rider_career_events
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- rider_peak_plans (admin-SELECT bevaret via owner_select-policyen i sektion A)
DROP POLICY IF EXISTS rider_peak_plans_admin_write ON public.rider_peak_plans;
DROP POLICY IF EXISTS rider_peak_plans_admin_insert ON public.rider_peak_plans;
CREATE POLICY rider_peak_plans_admin_insert ON public.rider_peak_plans
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS rider_peak_plans_admin_update ON public.rider_peak_plans;
CREATE POLICY rider_peak_plans_admin_update ON public.rider_peak_plans
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS rider_peak_plans_admin_delete ON public.rider_peak_plans;
CREATE POLICY rider_peak_plans_admin_delete ON public.rider_peak_plans
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- season_documentaries (read-policyen er roles={public} USING(true) — urørt)
DROP POLICY IF EXISTS season_documentaries_admin_write ON public.season_documentaries;
DROP POLICY IF EXISTS season_documentaries_admin_insert ON public.season_documentaries;
CREATE POLICY season_documentaries_admin_insert ON public.season_documentaries
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS season_documentaries_admin_update ON public.season_documentaries;
CREATE POLICY season_documentaries_admin_update ON public.season_documentaries
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS season_documentaries_admin_delete ON public.season_documentaries;
CREATE POLICY season_documentaries_admin_delete ON public.season_documentaries
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

COMMIT;

-- Post-verify (manuelt efter apply):
-- 1) Ingen policy på de 10 tabeller må have naked auth.uid() (alle skal være initplan-wrappet):
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('training_week_plans','scout_assignments','race_stage_roles',
--                        'rider_peak_plans','wage_daily_runs','race_incidents','race_stage_moments',
--                        'race_stage_timelines','rider_career_events','season_documentaries')
--      AND (coalesce(qual,'') || coalesce(with_check,'')) ~ 'auth\.uid\(\)'
--      AND (coalesce(qual,'') || coalesce(with_check,'')) !~ '\( ?SELECT auth\.uid\(\)';
--    -- forventet: 0 rækker
-- 2) Max én permissive SELECT-policy pr. tabel/rolle:
--    SELECT tablename, count(*) FROM pg_policies
--    WHERE schemaname='public' AND cmd IN ('SELECT','ALL') GROUP BY tablename HAVING count(*) > 1;
-- 3) get_advisors(type=performance): auth_rls_initplan + multiple_permissive_policies = 0 fund.
