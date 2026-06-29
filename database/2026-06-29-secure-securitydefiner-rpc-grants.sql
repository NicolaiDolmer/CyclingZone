-- =============================================================================
-- 2026-06-29 — Hærd over-eksponerede SECURITY DEFINER-RPC'er (#1971)
-- =============================================================================
-- PROBLEM (verificeret mod live DB 2026-06-29 via routine_privileges-query):
-- Supabase advisor 0028/0029 + direkte grant-inspektion viste at flere
-- SECURITY DEFINER-funktioner var EXECUTE-bare af `anon` og/eller `authenticated`
-- trods tidligere REVOKE i deres egne migrationer.
--
-- Mest alvorlig: `apply_stage_result` — en write-RPC der bumper
-- races.stages_completed + overskriver race_results — havde live
-- anon=EXECUTE + authenticated=EXECUTE og INGEN intern auth-guard. Det gjorde
-- det muligt for en uautoriseret PostgREST-kalder (med den offentlige anon-apikey)
-- at injicere/overskrive løbsresultater (selvvalgt rank/points_earned/prize_money)
-- og forstyrre etape-progression. SECURITY DEFINER bypasser RLS, så row-policies
-- beskytter ikke.
--
-- ROD-ÅRSAG (live ≠ migration):
-- `apply_stage_result`-migrationen (database/2026-06-21-stage-write-atomic-rpc.sql)
-- gjorde det rigtige: REVOKE ALL FROM PUBLIC + GRANT service_role. Men live havde
-- alligevel anon/authenticated. Ingen eksplicit `GRANT ... TO anon` findes i repoet.
-- Mest sandsynlige mekanisme: Supabase' default privileges
-- (`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ... GRANT EXECUTE ON FUNCTIONS
-- TO anon, authenticated`) gen-granter ved schema-restore/rebuild — flere reset/
-- rebuild-operationer kørte 27-28/6.
--
-- HVAD DENNE MIGRATION GØR:
-- REVOKE-only (ingen funktionsbody røres → race-motoren er urørt). `service_role`
-- (backend: cron-scheduler + admin-sti via stageResultRpc.js) beholder EXECUTE, så
-- løbsafvikling er uændret. Spiller-vendte read-RPC'er beholder `authenticated`.
--
-- Matrix:
--   apply_stage_result     → REVOKE anon, authenticated, PUBLIC (write-RPC: backend-only)
--   sync_auth_email_to_users → REVOKE anon, authenticated, PUBLIC (trigger-funktion: ingen direkte kald)
--   get_cohort_retention   → REVOKE anon (analytics: behold authenticated indtil admin-scope afklaret)
--   is_offered_intake_rider → REVOKE anon (frontend kalder kun authenticated)
--   is_admin / is_beta_tester → REVOKE anon (boolean-checks; frontend kalder authenticated)
--   get_sprint_metrics     → ingen ændring (allerede ikke anon; behold authenticated)
--
-- BEVIDST IKKE GJORT:
-- Intern `service_role`-guard i apply_stage_result (defense-in-depth mod restore-
-- regrant) er udeladt her: den afhænger af PostgREST-rolle-detektion og kan IKKE
-- verificeres af de eksisterende (mockede) tests — en forkert guard ville bryde
-- løbsafvikling. Hvis ønsket, leveres den som separat migration med SQL-test mod
-- en Supabase-branch. Restore-regrant fanges i mellemtiden af den ugentlige advisor.
--
-- ROLLBACK (ikke anbefalet — gen-åbner sårbarheden):
--   GRANT EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.sync_auth_email_to_users() TO anon, authenticated;
--   -- (m.fl. efter behov)
-- =============================================================================

BEGIN;

-- ── apply_stage_result: write-RPC, backend-only ─────────────────────────────
REVOKE EXECUTE ON FUNCTION public.apply_stage_result(uuid, integer, integer, integer, jsonb) FROM anon, authenticated, PUBLIC;

-- ── sync_auth_email_to_users: trigger-funktion, intet legitimt direkte kald ──
REVOKE EXECUTE ON FUNCTION public.sync_auth_email_to_users() FROM anon, authenticated, PUBLIC;

-- ── Read-RPC'er: fjern kun anon (behold authenticated til indloggede flows) ──
REVOKE EXECUTE ON FUNCTION public.get_cohort_retention(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_beta_tester() FROM anon;

COMMIT;

-- =============================================================================
-- Verifikation efter migration (forventet output)
-- =============================================================================
-- Kør efter apply for at bekræfte at REVOKE landede (og senere: at den HOLDER
-- efter en evt. restore — gentag denne query periodisk / efter reset-operationer):
--
--   SELECT p.proname,
--          (SELECT array_agg(grantee::text || '=' || privilege_type ORDER BY grantee::text)
--           FROM information_schema.routine_privileges rp
--           WHERE rp.specific_schema = 'public' AND rp.routine_name = p.proname) AS grants
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('apply_stage_result','sync_auth_email_to_users',
--                       'get_cohort_retention','is_offered_intake_rider',
--                       'is_admin','is_beta_tester')
--   ORDER BY p.proname;
--
-- Forventet:
--   apply_stage_result        → {postgres=EXECUTE, service_role=EXECUTE}        (INGEN anon/authenticated)
--   sync_auth_email_to_users  → {postgres=EXECUTE, service_role=EXECUTE}        (INGEN anon/authenticated/PUBLIC)
--   get_cohort_retention      → {postgres=EXECUTE, authenticated=EXECUTE, service_role=EXECUTE}
--   is_offered_intake_rider   → {postgres=EXECUTE, authenticated=EXECUTE, service_role=EXECUTE}
--   is_admin                  → {postgres=EXECUTE, authenticated=EXECUTE, service_role=EXECUTE}
--   is_beta_tester            → {postgres=EXECUTE, authenticated=EXECUTE, service_role=EXECUTE}
-- =============================================================================
