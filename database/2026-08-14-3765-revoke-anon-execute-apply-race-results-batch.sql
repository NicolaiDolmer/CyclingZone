-- #3765 — luk anon/authenticated-EXECUTE på apply_race_results_batch.
--
-- Baggrund: funktionen er SECURITY DEFINER, har INGEN autorisations-guard i
-- kroppen, og gør DELETE + INSERT på public.race_results. Den stod live med
-- EXECUTE grantet til anon og authenticated:
--
--   postgres=X | anon=X | authenticated=X | service_role=X
--
-- Dermed kunne den kaldes over /rest/v1/rpc/apply_race_results_batch med den
-- publicerbare anon-nøgle (som pr. definition ligger i frontend-bundtet) og
-- omskrive resultaterne for et vilkårligt løb. SECURITY DEFINER kører som
-- ejeren, så RLS på race_results beskytter ikke.
--
-- Rod-årsag = klassen i #2858: Supabase' ALTER DEFAULT PRIVILEGES granter
-- EXECUTE eksplicit til anon + authenticated ved ENHVER funktions-oprettelse,
-- og de grants overlever et REVOKE ... FROM PUBLIC. Migrationsforslaget der
-- oprettede funktionen (database/proposals/2026-08-05-race-results-batch-write-
-- atomic-rpc.sql:129-130) havde kun PUBLIC-revoke + service_role-grant, og de
-- to linjer nåede aldrig produktion.
--
-- Målbilledet er paritet med søsterfunktionerne, der begge står korrekt:
--   apply_stage_result      → postgres=X | service_role=X
--   dashboard_rider_ranking → postgres=X | service_role=X
--
-- Risiko: ingen. Eneste kaldested er backend/lib/stageResultRpc.js:86, og
-- backend-klienten bruger SUPABASE_SERVICE_KEY (cron.js:105, server.js:70).
-- Ingen frontend-kaldere. Integrationstesten i backend/lib/testdb/
-- raceResultsEntrantUnique.integration.test.js kalder som DB-ejer og rammes
-- ikke af role-grants. apply_stage_result har heller ingen intern guard —
-- husmønsteret for disse skrive-RPC'er er grant-lockdown alene.
--
-- Idempotent: REVOKE på en allerede-fjernet grant er en no-op.

REVOKE ALL     ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) TO service_role;

-- compute_daily_growth_snapshot: samme advisor-fund (0028), men kroppen har
-- allerede IF NOT (auth.role() = 'service_role') THEN RAISE EXCEPTION 'forbidden'.
-- Grant-lockdown alligevel — forsvar i dybden, så advisoren bliver ren og en
-- fremtidig CREATE OR REPLACE ikke kan tabe den interne gate ubemærket.
REVOKE ALL     ON FUNCTION public.compute_daily_growth_snapshot(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_daily_growth_snapshot(date) TO service_role;

-- is_admin() beholder BEVIDST sin anon-grant (jf. #2858): den returnerer false
-- for anon og fjerner 42501-støj fra RLS-policies. Rør den ikke.

COMMENT ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) IS
  'Atomisk delete-af-berørte-etaper + insert i race_results (#3022). SECURITY DEFINER '
  'UDEN intern guard — EXECUTE er derfor service_role-only (#3765). Grant den ALDRIG '
  'til anon/authenticated: funktionen kan omskrive ethvert løbs resultater.';

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
--
--   select p.proname, array_to_string(p.proacl,' | ') as acl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('apply_race_results_batch','compute_daily_growth_snapshot');
--
--   → forventet for BEGGE: 'postgres=X/postgres | service_role=X/postgres'
--     (ingen anon, ingen authenticated)
--
--   select has_function_privilege('anon',
--     'public.apply_race_results_batch(uuid,integer[],jsonb)', 'EXECUTE');
--   → forventet: false
--
-- Rollback (kun hvis en legitim authenticated-kaldesti skulle dukke op —
-- den findes ikke i dag):
--   GRANT EXECUTE ON FUNCTION public.apply_race_results_batch(uuid, integer[], jsonb) TO authenticated;
