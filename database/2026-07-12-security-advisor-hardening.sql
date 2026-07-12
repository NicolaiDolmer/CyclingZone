-- =============================================================================
-- 2026-07-12 — Supabase security advisor hærdning (#2258)
-- =============================================================================
-- Kilde: Supabase security advisors (prod ghwvkxzhsbbltzfnuhhz), kørt 2026-07-10.
-- AKTUEL-TILSTAND verificeret mod live DB 2026-07-12 (pg_proc.proacl +
-- has_function_privilege + get_advisors) FØR denne migration blev skrevet —
-- se PR-body / issue-kommentar for fuld tabel.
--
-- #2258-fund 1 (refresh_ranking_matviews kaldbar af anon/authenticated) og
-- fund 2 (get_cohort_retention/get_sprint_metrics admin-gating) er ALLEREDE
-- løst af #2327/#2345 (database/2026-07-11-revoke-rpc-grants-2327.sql) —
-- verificeret: begge har search_path sat, ingen PUBLIC/anon-grant, og
-- get_cohort_retention/get_sprint_metrics har intern
-- `IF NOT (is_admin() OR auth.role()='service_role') THEN RAISE EXCEPTION`-gate.
-- INGEN ændring for dem her.
--
-- Denne migration dækker to ting:
--
-- BLOK A (#2258 fund 3 — function_search_path_mutable):
-- SET search_path på sync_auth_email_to_users + create_emergency_loan_atomic
-- (de 2 funktioner Supabase-linteren stadig flagger uden search_path).
--
-- BLOK B (fundet UNDER #2258-verifikationen, ikke i original fund-liste —
-- RECURRENCE af #1971's rodårsag, se database/2026-06-29-secure-
-- securitydefiner-rpc-grants.sql linje 17-24):
-- #2327/#2345s REVOKE-migration (2026-07-11-revoke-rpc-grants-2327.sql) kørte
-- `REVOKE EXECUTE ... FROM anon, authenticated` på 13 muterende funktioner,
-- MEN glemte PUBLIC. I Postgres er `anon`/`authenticated` almindelige roller
-- der arver EXECUTE via et `GRANT ... TO PUBLIC` uanset eksplicit REVOKE FROM
-- dem selv — så alle 13 funktioner har reelt stadig været kaldbare af
-- uautentificerede callere via PostgREST siden #2345 blev merged, fordi de
-- (formentlig via Supabase' default privileges for supabase_admin, samme
-- mekanisme som #1971) fik PUBLIC-grant ved CREATE/CREATE OR REPLACE.
--
-- Verificeret direkte mod prod (pg_proc.proacl, 2026-07-12): 11 af de 13 har
-- stadig `=X` (PUBLIC) i deres ACL — dvs. has_function_privilege('anon', ...)
-- = true for alle 11, inkl. create_emergency_loan_atomic (opretter reel gæld)
-- og repay_loan_atomic/finalize_academy_acquisition/demote_rider_to_academy
-- (muterer balance/kontrakter). increment_balance_with_audit,
-- refresh_ranking_matviews og submit_race_results har IKKE PUBLIC-grant
-- (korrekt) — ingen ændring for dem.
--
-- Samme mønster som #1971's fix (database/2026-06-29-...): eksplicit
-- REVOKE ... FROM PUBLIC, ikke kun anon/authenticated. Ren grant-ændring,
-- ingen funktionsbody rørt. Backwards-check (frontend/backend .rpc()-kald)
-- er allerede udført af #2327s egen migration-kommentar — alle 13 er enten
-- backend-only (service_role-klient) eller trigger-funktioner; denne
-- migration ændrer ikke den konklusion, den lukker blot PUBLIC-hullet i
-- samme funktionsliste.
--
-- Idempotent: REVOKE/ALTER FUNCTION SET på et allerede korrekt privilegium/
-- config er en no-op, ingen fejl.
--
-- Rollback (ikke anbefalet — gen-åbner PUBLIC-hullet):
--   GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO PUBLIC;
--   ALTER FUNCTION public.sync_auth_email_to_users() RESET search_path;
--   ALTER FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid) RESET search_path;
-- =============================================================================

BEGIN;

-- ── BLOK A: #2258 fund 3 — function_search_path_mutable ────────────────────
ALTER FUNCTION public.sync_auth_email_to_users()
  SET search_path = public, pg_catalog;

ALTER FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid)
  SET search_path = public, pg_catalog;

-- ── BLOK B: fuldfør #2327/#2345 — PUBLIC-grant overlevede REVOKE FROM
--    anon, authenticated. Samme mønster som #1971 (2026-06-29-migration):
--    eksplicit PUBLIC skal med, ellers arver anon/authenticated alligevel.
REVOKE EXECUTE ON FUNCTION public.block_rider_delete_with_inflight_entries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_ineligible_future_entries() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_race_entry(uuid, uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_race_points() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.repay_loan_atomic(uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_rider_owner_is_ai() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_riders_owner_is_ai() FROM PUBLIC;

-- Genbekræft service_role EXECUTE eksplicit (allerede til stede, men gør
-- migrationen selvstændigt læsbar/anvendelig uden at læse #2345 først).
GRANT EXECUTE ON FUNCTION public.block_rider_delete_with_inflight_entries() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_ineligible_future_entries() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_emergency_loan_atomic(uuid, bigint, numeric, numeric, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_race_entry(uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.regenerate_race_points() TO service_role;
GRANT EXECUTE ON FUNCTION public.repay_loan_atomic(uuid, uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_race_selection(uuid, uuid, uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_rider_owner_is_ai() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_riders_owner_is_ai() TO service_role;

COMMIT;

-- =============================================================================
-- Verifikation efter apply (forventet output)
-- =============================================================================
--   SELECT p.proname, p.proacl::text AS acl, p.proconfig
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('sync_auth_email_to_users','create_emergency_loan_atomic',
--       'block_rider_delete_with_inflight_entries','cleanup_ineligible_future_entries',
--       'demote_rider_to_academy','finalize_academy_acquisition','move_race_entry',
--       'regenerate_race_points','repay_loan_atomic','replace_race_selection',
--       'set_rider_owner_is_ai','sync_riders_owner_is_ai')
--   ORDER BY p.proname;
--
-- Forventet: proacl uden `=X` (PUBLIC)-indgang for alle 11 i Blok B; kun
-- `postgres=X` + `service_role=X` tilbage. proconfig for de 2 i Blok A
-- indeholder 'search_path=public, pg_catalog'.
-- =============================================================================
