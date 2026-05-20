-- Security hardening phase A (Refs #516, #525 partial).
--
-- Baggrund:
-- Supabase advisor 2026-05-20 fandt 33 fund. Denne migration adresserer mekaniske
-- fixes med lav blast-radius — ingen produkt-beslutninger, ingen brugerrettede
-- flows ændres:
--   1. #516 — DROP legacy public.increment_balance(uuid, integer) (orphan-bekræftet).
--   2. Stable search_path på 8 functions (advisor 0011_function_search_path_mutable).
--   3. REVOKE EXECUTE på SECURITY DEFINER functions der ikke skal kaldes via REST
--      (advisor 0028/0029_anon|authenticated_security_definer_function_executable).
--   4. Rebuild 3 ai_* views uden SECURITY DEFINER (advisor 0010_security_definer_view).
--
-- IKKE inkluderet (separate PRs):
--   - #517 discord_settings RLS lockdown (kræver backend route)
--   - #518 pending_race_result_rows RLS (kræver atomicity-refactor)
--   - Leaked password protection (Auth-dashboard handling)
--   - RLS-enabled-no-policy på 6 tabeller (advisor INFO, kræver klassificering)
--
-- Verifikation udført 2026-05-21:
--   - increment_balance: rg fandt kun increment_balance_with_audit — bekræftet orphan
--   - is_admin: bruges af 2 RLS-policies (app_config, founder_supporter_waitlist)
--                  + SurveyBanner.jsx → authenticated SKAL kunne kalde
--   - get_sprint_metrics: bruges af AdminSprintMetricsPage.jsx (auth)
--                  + snapshot-sprint-metrics.mjs (service_role) → authenticated SKAL kunne kalde
--   - reject_late_auction_bid, handle_new_user, sync_user_language_to_auth_meta,
--     fill_finance_tx_season: kun trigger-brug, ingen RPC-kald i kode → revoke begge
--   - create_loan_atomic, increment_balance_with_audit: kun backend service_role → revoke begge
--   - rls_auto_enable: migration-helper, ingen app-kald → revoke begge
--   - ai_* views: kun referenced i database.types.ts (typegen) → behold authenticated SELECT
--
-- Rollback:
--   1. CREATE FUNCTION increment_balance(...) — definition i issue #516
--   2. ALTER FUNCTION ... RESET search_path
--   3. GRANT EXECUTE TO anon, authenticated på de revoked functions
--   4. DROP VIEW + CREATE VIEW uden security_invoker hint (gør dem SECURITY DEFINER igen)

-------------------------------------------------------------------------------
-- 1. Drop legacy increment_balance RPC (#516)
-------------------------------------------------------------------------------
-- Live definition: UPDATE teams SET balance = balance + amount WHERE id = team_id
-- (uden audit trail). Bypass-vektor for økonomi-invariants. SECURITY DEFINER med
-- execute for anon+authenticated+service_role+PUBLIC.
DROP FUNCTION IF EXISTS public.increment_balance(uuid, integer);

-------------------------------------------------------------------------------
-- 2. Stable search_path på funktioner med mutable search_path
-------------------------------------------------------------------------------
ALTER FUNCTION public.create_loan_atomic(uuid, text, bigint, bigint, numeric, integer, bigint)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.sync_user_language_to_auth_meta()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.fill_finance_tx_season()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.is_admin()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.reject_late_auction_bid()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.rls_auto_enable()
  SET search_path = public, pg_catalog;

-------------------------------------------------------------------------------
-- 3. Revoke EXECUTE på SECURITY DEFINER functions
-------------------------------------------------------------------------------

-- 3a. Trigger-only functions (ingen legitim RPC-vektor):
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_user_language_to_auth_meta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_late_auction_bid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_finance_tx_season() FROM PUBLIC, anon, authenticated;

-- 3b. Service-role-only functions (kun backend kalder med service_role-key):
REVOKE EXECUTE ON FUNCTION public.increment_balance_with_audit(uuid, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_loan_atomic(uuid, text, bigint, bigint, numeric, integer, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- 3c. Authenticated-callable functions (anon revoked, authenticated bevares):
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_sprint_metrics(text) FROM PUBLIC, anon;

-------------------------------------------------------------------------------
-- 4. Rebuild ai_* views uden SECURITY DEFINER
-------------------------------------------------------------------------------
-- SECURITY DEFINER på views bypasser RLS på underlying tables. Disse views er
-- read-only inspector-views (referencet kun i database.types.ts typegen), så
-- rebuild med security_invoker = true (Postgres 15+ feature) og strip CRUD-grants
-- som var oprettet som side-effekt af tidligere CREATE VIEW.

DROP VIEW IF EXISTS public.ai_recent_import_health CASCADE;
CREATE VIEW public.ai_recent_import_health
WITH (security_invoker = true) AS
SELECT id,
       import_type,
       rows_processed,
       rows_updated,
       rows_inserted,
       jsonb_array_length(COALESCE(errors, '[]'::jsonb)) AS error_count,
       created_at
FROM public.import_log
ORDER BY created_at DESC
LIMIT 25;

DROP VIEW IF EXISTS public.ai_active_season_status CASCADE;
CREATE VIEW public.ai_active_season_status
WITH (security_invoker = true) AS
SELECT s.id AS season_id,
       s.number AS season_number,
       s.status,
       s.race_days_total,
       s.race_days_completed,
       count(DISTINCT r.id) AS race_count,
       count(DISTINCT rr.id) AS race_result_count,
       count(DISTINCT ss.id) AS standings_count,
       count(DISTINCT ft.id) FILTER (WHERE (ft.type = 'prize'::text)) AS prize_transaction_count
FROM public.seasons s
LEFT JOIN public.races r ON r.season_id = s.id
LEFT JOIN public.race_results rr ON rr.race_id = r.id
LEFT JOIN public.season_standings ss ON ss.season_id = s.id
LEFT JOIN public.finance_transactions ft ON ft.season_id = s.id
WHERE s.status = 'active'
GROUP BY s.id, s.number, s.status, s.race_days_total, s.race_days_completed;

DROP VIEW IF EXISTS public.ai_race_import_blockers CASCADE;
CREATE VIEW public.ai_race_import_blockers
WITH (security_invoker = true) AS
SELECT id AS import_log_id,
       created_at,
       rows_processed,
       rows_updated,
       rows_inserted,
       CASE
         WHEN rows_processed > 0 AND rows_inserted = 0 THEN 'processed_rows_but_inserted_zero'
         WHEN jsonb_array_length(COALESCE(errors, '[]'::jsonb)) > 0 THEN 'import_errors_present'
         ELSE 'ok'
       END AS status,
       COALESCE(errors, '[]'::jsonb) AS errors
FROM public.import_log
WHERE import_type = 'race_results_sheets'
ORDER BY created_at DESC
LIMIT 10;

-- Strip default anon CRUD-grants på views (kun SELECT er meningsfuld; CRUD-grants
-- på views er ineffektive men oprettes default af Supabase). authenticated +
-- service_role + codex_readonly beholder SELECT for app/admin/inspector adgang.
REVOKE ALL ON public.ai_recent_import_health FROM anon;
REVOKE ALL ON public.ai_active_season_status FROM anon;
REVOKE ALL ON public.ai_race_import_blockers FROM anon;

GRANT SELECT ON public.ai_recent_import_health TO authenticated, service_role, codex_readonly;
GRANT SELECT ON public.ai_active_season_status TO authenticated, service_role, codex_readonly;
GRANT SELECT ON public.ai_race_import_blockers TO authenticated, service_role, codex_readonly;
