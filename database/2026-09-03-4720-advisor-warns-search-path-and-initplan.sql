-- 2026-09-03 · #4720 — Supabase advisor WARNs (maalt 3/9, sikkerheds-boelge):
--
-- A) function_search_path_mutable paa public.guard_academy_offer_ownership
--    (trigger-funktion fra #4213, 2026-08-29-4213-academy-offer-ownership-guard.sql).
--    Funktionen fik aldrig search_path sat da den blev oprettet. Samme moenster +
--    vaerdi som phase-a/phase-b haerdning (`public, pg_catalog`) — funktionen
--    bruger ukvalificerede tabelnavne (riders, academy_intake) som skal kunne
--    findes via search_path, saa den ikke saettes til tom streng.
--
-- B) auth_rls_initplan paa tre tabellers policies: `auth.uid()` re-evalueres
--    PR. RAEKKE naar den staar direkte i en policy. Wrappet som
--    `(SELECT auth.uid())` bliver en InitPlan der evalueres ÉN gang pr. query.
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--    - forum_reactions_own_rows        (ALL,    2026-08-25-3517-forum-reactions.sql)
--    - forum_thread_reads_own_rows     (ALL,    2026-08-25-3451-forum-thread-reads.sql)
--    - market_value_level_correction_rider_receipts_owner_read (SELECT, 2026-08-19-3449-level-correction-gate.sql)
--
-- Adfaerdsgaranti: ingen semantisk aendring, kun perf-form. Policy-logik er
-- bevaret 1:1 mod nuvaerende pg_policies (laest read-only via Supabase MCP
-- foer denne migration blev skrevet):
--   forum_reactions_own_rows:    USING/WITH CHECK (user_id = auth.uid())
--   forum_thread_reads_own_rows: USING/WITH CHECK (user_id = auth.uid())
--   market_value_..._owner_read: USING (EXISTS (... AND t.user_id = auth.uid()))
--
-- IKKE i denne migration (ejer-info, ingen kode-aendring her):
--   - materialized_view_in_api (global_rank_mv, rider_rankings_mv,
--     team_race_points_mv, team_standings_ext_mv) — matviews er bevidst i
--     API'et, laeses direkte af frontend/backend.
--   - anon/authenticated_security_definer_function_executable (is_admin,
--     is_beta_tester, is_offered_intake_rider, founder_public_list,
--     get_cohort_retention, get_retention_scorecard_activity,
--     get_sprint_metrics) — SECURITY DEFINER RPC'er der SKAL have EXECUTE for
--     alle roller jf. #2671; ingen revokes.
--   - extension_in_public (btree_gist) — se PR-body for brug.
--
-- Idempotent: ALTER FUNCTION + DROP POLICY IF EXISTS/CREATE POLICY, kan
-- koeres flere gange uden effekt-forskel. APPLIES IKKE her (owner-gated,
-- Claude applier selv post-merge under #2642-rammer).
--
-- Rollback:
--   ALTER FUNCTION public.guard_academy_offer_ownership() RESET search_path;
--   (policy-rollback: genskab med bar `auth.uid()` per uddragene ovenfor)

BEGIN;

-- =====================================================================
-- A. function_search_path_mutable
-- =====================================================================

ALTER FUNCTION public.guard_academy_offer_ownership()
  SET search_path = public, pg_catalog;

-- =====================================================================
-- B. auth_rls_initplan — 3 policies genskabes med (SELECT auth.uid())
-- =====================================================================

-- forum_reactions
DROP POLICY IF EXISTS forum_reactions_own_rows ON public.forum_reactions;
CREATE POLICY forum_reactions_own_rows ON public.forum_reactions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- forum_thread_reads
DROP POLICY IF EXISTS forum_thread_reads_own_rows ON public.forum_thread_reads;
CREATE POLICY forum_thread_reads_own_rows ON public.forum_thread_reads
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- market_value_level_correction_rider_receipts
DROP POLICY IF EXISTS market_value_level_correction_rider_receipts_owner_read
  ON public.market_value_level_correction_rider_receipts;
CREATE POLICY market_value_level_correction_rider_receipts_owner_read
  ON public.market_value_level_correction_rider_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.riders r
      JOIN public.teams t ON t.id = r.team_id
      WHERE r.id = market_value_level_correction_rider_receipts.rider_id
        AND t.user_id = (SELECT auth.uid())
    )
  );

-- Sanity: bekraeft search_path er sat foer commit.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'guard_academy_offer_ownership'
    AND p.proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg
      WHERE cfg LIKE 'search_path=%'
    );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Forventede search_path sat paa guard_academy_offer_ownership, fandt %', v_count;
  END IF;
END $$;

COMMIT;

-- Registrer migration i auto-migrate state-table.
INSERT INTO schema_migrations (filename, applied_at) VALUES
  ('database/2026-09-03-4720-advisor-warns-search-path-and-initplan.sql', NOW())
ON CONFLICT (filename) DO NOTHING;

-- POST-VERIFY (koer efter apply):
--   select proconfig from pg_proc where proname='guard_academy_offer_ownership';
--     -> forventet: {search_path=public,pg_catalog}
--   select tablename, policyname, qual, with_check from pg_policies
--     where tablename in ('forum_reactions','forum_thread_reads','market_value_level_correction_rider_receipts');
--     -> forventet: alle tre indeholder "( SELECT auth.uid() AS uid)" i qual/with_check
--   select * from pg_advisor... (get_advisors performance) -> de tre auth_rls_initplan-WARNs vaek.
