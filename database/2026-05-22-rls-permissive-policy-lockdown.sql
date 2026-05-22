-- RLS permissive policy lockdown (P0/P1 security fix from audit #548)
-- =============================================================================
--
-- Baggrund:
-- Manual RLS correctness audit 2026-05-22 (docs/RLS_AUDIT_2026-05-22.md) verificerede
-- 6 eksploiterbare permissive policies som klassificerede `TO public USING(true)`.
-- public-role rammer ALLE roller incl. authenticated → random auth user kunne:
--
--   - loans: INSERT/UPDATE/DELETE alle 17 loans (P0 financial tampering)
--   - loan_config: UPDATE → ændre alle teams' interest_rate/debt_ceiling (P0 game economy)
--   - notifications: INSERT fake notification for enhver user (P0 phishing vector)
--   - activity_feed: INSERT fake activity entries (P1 feed spam)
--   - admin_log: INSERT-RLS tilladt (kun CHECK-constraint stopper — P2 defense-in-depth)
--   - users: 'Public read basic user info' returnerer email+discord_id+consent_preferences
--            til ENHVER authenticated user (P1 PII leak — NY FUND uden for advisor)
--
-- Pre-state policies har TO public (alle roller). Fix: TO service_role.
-- service_role bypasser RLS uanset, så TO service_role-policies fungerer korrekt
-- som "kun service-role kan skrive". Authenticated-rolle får default-deny som intended.
--
-- IKKE inkluderet (separate issues):
--   - pending_race_result_rows permissive INSERT — tracked i #518 (kræver atomicity-refactor)
--
-- Frontend impact (verificeret via Grep over frontend/src):
--   - users PII fix: AdminPage.jsx + AdminUsersTab.jsx læser email på tværs af users,
--     men i admin-context — dækkes af ny "Admins can read all users" policy via is_admin().
--     Alle andre frontend-kald er .eq("id", session.user.id) → dækkes af eksisterende
--     "Users can read own profile" policy.
--   - loans/notifications/activity_feed/admin_log/loan_config writes går alle via backend
--     (service_role) — backend kald bypasser RLS uanset.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Safe at replay.

BEGIN;

-- 1. loans — P0 financial tampering exploit
DROP POLICY IF EXISTS "Service role full access loans" ON public.loans;
CREATE POLICY "Service role full access loans" ON public.loans
  AS PERMISSIVE FOR ALL TO service_role USING (true);

-- 2. loan_config — P0 game economy tampering exploit
DROP POLICY IF EXISTS "Service role full access loan_config" ON public.loan_config;
CREATE POLICY "Service role full access loan_config" ON public.loan_config
  AS PERMISSIVE FOR ALL TO service_role USING (true);

-- 3. notifications — P0 phishing vector
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;
CREATE POLICY "Service can insert notifications" ON public.notifications
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

-- 4. activity_feed — P1 feed spam
DROP POLICY IF EXISTS "Service insert activity_feed" ON public.activity_feed;
CREATE POLICY "Service insert activity_feed" ON public.activity_feed
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

-- 5. admin_log — P2 latent defense-in-depth
DROP POLICY IF EXISTS "Service role full access admin_log" ON public.admin_log;
CREATE POLICY "Service role full access admin_log" ON public.admin_log
  AS PERMISSIVE FOR ALL TO service_role USING (true);

-- 6. users — P1 PII leak
-- Drop over-permissive cross-user read (returnerede email+discord_id+consent_preferences
-- til alle auth users). Behold "Users can read own profile" (auth.uid()=id).
-- Tilføj admin-policy via is_admin() SECURITY DEFINER function — undgår RLS-rekursion.
DROP POLICY IF EXISTS "Public read basic user info" ON public.users;
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT TO authenticated
  USING (public.is_admin());

COMMIT;

-- Verifikation efter migration (forventet output):
--
-- 1) Random auth user SELECT mod loans:
--    SET LOCAL role = authenticated; SET LOCAL request.jwt.claim.sub = '<random-uuid>';
--    SELECT COUNT(*) FROM loans;
--    → forventet: 0 (kun "Managers can view own loans" filter aktiv)
--
-- 2) Random auth user INSERT i notifications:
--    INSERT INTO notifications (...) VALUES (...);
--    → forventet: ERROR 42501 (RLS denied)
--
-- 3) Random auth user UPDATE loan_config:
--    UPDATE loan_config SET interest_rate_pct = 0;
--    → forventet: ERROR 42501 (RLS denied)
--
-- 4) Random auth user SELECT email fra users:
--    SELECT email FROM users WHERE id != auth.uid();
--    → forventet: 0 rows (kun is_admin()=true ville se andre brugere)
--
-- 5) Admin user SELECT users:
--    → forventet: alle rows (via is_admin() policy)
