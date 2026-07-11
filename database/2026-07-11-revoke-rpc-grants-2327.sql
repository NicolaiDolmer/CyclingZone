-- #2327: fjern anon/authenticated EXECUTE-grants på muterende/backend-only RPC'er.
--
-- Baggrund: PostgREST eksponerer som udgangspunkt ALLE public-funktioner via
-- /rest/v1/rpc/<fn>. Ældre migrationer GRANTede rutinemæssigt "authenticated"
-- (og i nogle tilfælde "anon") på nye funktioner uden at spørge om frontend
-- rent faktisk kalder dem med bruger-JWT. Værste fund: increment_balance_with_audit
-- fik "GRANT ... TO authenticated" i 2026-05-09-balance-rpc.sql OG blev
-- re-granted i 2026-05-26-backend-message-codes.sql (CREATE OR REPLACE
-- FUNCTION nulstiller ikke grants — et efterfølgende GRANT-statement lægger
-- dem bare oveni). En autentificeret spiller kunne dermed i teorien kalde
-- /rest/v1/rpc/increment_balance_with_audit direkte på sit eget team-id og
-- ændre sin egen balance uden om backend-validering.
--
-- Backwards-check (11/7, grep af hele frontend/ + backend/ for ".rpc("):
--   - ALLE 13 muterende funktioner nedenfor kaldes UDELUKKENDE fra backend
--     via en service_role-klient (backend/routes/api.js:498,
--     backend/lib/loanEngine.js:48) eller er trigger-funktioner
--     (block_rider_delete_with_inflight_entries, cleanup_ineligible_future_entries,
--     set_rider_owner_is_ai, sync_riders_owner_is_ai — kaldes aldrig via RPC,
--     kun via CREATE TRIGGER ... EXECUTE FUNCTION).
--   - is_admin, get_sprint_metrics, get_cohort_retention kaldes DIREKTE fra
--     frontend (SurveyBanner.jsx, RoadmapPage.jsx, AdminSprintMetricsPage.jsx)
--     med bruger-JWT → authenticated-grant BEVARES for disse tre. De er
--     SECURITY DEFINER og admin-gater selv (is_admin-checks internt), så
--     eksponering er tilsigtet.
--   - is_beta_tester, is_offered_intake_rider: ingen frontend .rpc()-kald
--     fundet i denne backwards-check, men de er allerede kun grantet til
--     authenticated (ikke anon) og er lette read-only lookup-funktioner —
--     revokes IKKE her for at undgå at bryde et kald denne grep ikke fangede
--     (fx dynamisk opbygget rpc-navn). Følg op separat hvis en dybere audit
--     bekræfter de er ubrugte.
--   - refresh_ranking_matviews (SECURITY DEFINER): kendt advisor-fund fra
--     #2258 — anon skal ikke kunne trigge matview-refresh. Kaldes kun fra
--     backend (refreshRankingMatviews.js, cron.js) med injiceret klient →
--     revoke anon + authenticated.
--
-- Idempotent: REVOKE på et allerede-manglende privilegium er en no-op.
--
-- MØNSTER FOR NYE RPC'ER (forward-guard): enhver ny public-funktion skal
-- eksplicit tage stilling til PostgREST-eksponering. Er den IKKE tiltænkt
-- kaldt direkte af en spiller-session (dvs. den muterer state udenom
-- backend-validering, eller er en intern trigger/cron-funktion): tilføj
--   REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO service_role;
-- i samme migration som CREATE FUNCTION. Er den spiller-vendt (kaldes
-- direkte fra frontend med bruger-JWT), skal den enten være SECURITY
-- INVOKER (RLS håndhæver adgang) eller SECURITY DEFINER med eksplicit
-- intern autorisation (a la is_admin-mønsteret). "authenticated" er IKKE
-- en sikker default-grant.

-- Backend-only muterende funktioner: revoke anon + authenticated, sikr service_role.
REVOKE EXECUTE ON FUNCTION public.block_rider_delete_with_inflight_entries() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_rider_delete_with_inflight_entries() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_ineligible_future_entries() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_ineligible_future_entries() TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_race_entry(uuid, uuid, uuid, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_race_entry(uuid, uuid, uuid, uuid, integer) TO service_role;

-- #2258: anon/authenticated skal ikke kunne trigge matview-refresh (SECURITY DEFINER).
REVOKE EXECUTE ON FUNCTION public.refresh_ranking_matviews() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ranking_matviews() TO service_role;

REVOKE EXECUTE ON FUNCTION public.regenerate_race_points() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_race_points() TO service_role;

REVOKE EXECUTE ON FUNCTION public.repay_loan_atomic(uuid, uuid, bigint, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repay_loan_atomic(uuid, uuid, bigint, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_rider_owner_is_ai() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_rider_owner_is_ai() TO service_role;

REVOKE EXECUTE ON FUNCTION public.submit_race_results(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_race_results(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_riders_owner_is_ai() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_riders_owner_is_ai() TO service_role;

-- BEVARES (frontend kalder direkte med bruger-JWT, admin-gater internt):
--   is_admin(), get_sprint_metrics(text), get_cohort_retention(integer)
-- INGEN ændring for disse.
