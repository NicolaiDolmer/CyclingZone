-- =============================================================================
-- 2026-10-11 — PostgREST-timeouts: maaling, rodaarsag og advisor-rest (#6184)
-- =============================================================================
--
-- MAALING (prod, read-only 11/10, vindue 10/10 10:00 - 11/10 10:00 UTC; kun
-- SELECT mod pg_stat_*/pg_settings/pg_policies og ClickHouse-logforespoergsler):
--
--   * postgrest_logs: "Warp server error: Thread killed by timeout manager"
--     117-381 linjer pr. time, hele doegnet, ogsaa om natten. Linjerne kommer i
--     klumper med SAMME mikrosekund-tidsstempel (1-25 pr. klump) = timeout-
--     managerens oprydnings-tik, ikke enkelte forespoergsler.
--   * edge_logs, samme vindue: ca. 718k kald til /rest/v1, heraf 3 med 5xx og
--     0 med 502/504/544. Ingen forespoergsel er blevet afbrudt med en gateway-
--     timeout. Kald med Envoy-genforsoeg (x_envoy_attempt_count > 1) foelger
--     trafikken (0 kl. 01-02 UTC), mens "Thread killed" ligger fladt (142-188
--     samme timer): de to haenger ikke sammen.
--   * postgres_logs: 2 statement timeouts og 1 lock timeout paa 24 timer.
--   * Antal "Thread killed" pr. time foelger hverken kaldsmaengde (6,7k til 93k
--     pr. time) eller langsomme kald (timen med flest kald over 5 s havde faerrest
--     "Thread killed").
--
-- RODAARSAG (Thread killed): Warp (PostgREST's HTTP-server) pauser sin timeout
-- mens en forespoergsel koerer og tikler den ved hvert svar; timeout-manageren
-- draeber altsaa ikke en langsom databaseforespoergsel, men en HTTP-forbindelse
-- der staar stille (tomgangs-keep-alive mellem Supabase-gatewayen og PostgREST).
-- Det er en forbindelses-oprydning paa Supabase-siden, ikke tabte spiller- eller
-- cron-kald, og den kan ikke rettes fra vores kode eller database. "Thread
-- killed" er derfor et forkert maal for trin 4 i #6184; det rigtige maal er
-- edge 5xx/544 pr. time + statement/lock timeouts i postgres_logs.
-- (Antagelse uden Supabase-bekraeftelse: at forbindelserne netop er gatewayens
-- tomgangs-pool. Konklusionen "ingen tabte kald" hviler paa edge-tallene.)
--
-- DE AEGTE TIMEOUTS i vinduet (samme kilder):
--   1. Ca. to minutters fuld opbremsning 10/10 18:08-18:10 UTC under aften-
--      traeningens lukning (~50 traeningstik i minuttet): selv trivielle GET's
--      tog op til 45 s, realtime's WAL-aflaesning 20,8 s, og en optaelling af
--      realtime.subscription 10,6 s. Ingen laaseventer i loggen i det vindue
--      (log_lock_waits = on), saa det er ressource-maetning, ikke laase. Samme
--      moenster som #5878 (28/9 og 2/10). Ejes af traenings-/kapacitets-sporet.
--   2. Akademi-signering 10-13 s med laase-timeout: rettet i #6450
--      (2026-10-11-academy-sign-latency.sql, merget 11/10 08:04 UTC).
--   3. Rangliste-matviews (#5692): refresh koerer nu ved haendelse (43 gange i
--      vinduet, 1,8-3,4 s), og HEAD-count paa team_race_points_mv (Sentry
--      race-count) svarer i snit paa 6 ms. Ingen timeouts.
--
-- FORDELING (samme vindue): 99 REST-kald over 5 s, heraf 68 i timen 18 UTC
-- (opbremsningen, spredt over ~25 tabeller) og 15 paa
-- rpc/finalize_academy_acquisition (#6450). Resten er enkeltstaaende.
-- EFTER #6450 (11/10 08:05-10:55 UTC): 139k REST-kald, 1 over 5 s, 0 x 5xx,
-- 0 statement/lock timeouts, akademi-signering 8 kald og 0 over 5 s. "Thread
-- killed" 590 (ca. 210 pr. time, uaendret niveau) - bekraefter at det tal ikke
-- foelger de aegte timeouts.
--
-- DENNE FIL: den ene resterende auth_rls_initplan-WARN fra performance-
-- advisors (opgavens trin 3). forum_category_mutes' politik evaluerede
-- auth.uid() pr. raekke; (select auth.uid()) evalueres een gang pr. forespoergsel.
-- Samme semantik: samme rolle, samme kommando, samme betingelse.
-- multiple_permissive_policies-WARN'erne (5 tabeller) rammer ingen varme
-- tabeller og roeres ikke her (sammenlaegning af politikker er en semantik-
-- aendring der kraever sin egen gennemgang).
--
-- Apply: post-merge under #2642-rammer (idempotent + post-verify).
-- Rollback: koer CREATE POLICY-blokken fra 2026-09-08-5013-forum-category-mutes.sql.

-- #6342: kort laase-ventetid, saa en DDL-laas aldrig staar i koe foran
-- spillernes laesninger (auto-migrate kan koeres igen).
SET lock_timeout = '3s';

BEGIN;

DROP POLICY IF EXISTS "forum_category_mutes_own_rows" ON public.forum_category_mutes;
-- policy-grant-ok: toggle-tabel; 2026-09-08-5013 giver bevidst kun SELECT/INSERT/DELETE (ingen UPDATE-brug), uaendret her
CREATE POLICY "forum_category_mutes_own_rows" ON public.forum_category_mutes
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;

-- Post-verify (koer efter apply):
--   1. select policyname, roles, cmd, qual, with_check from pg_policies
--        where schemaname = 'public' and tablename = 'forum_category_mutes';
--      -> een raekke, roles {authenticated}, cmd ALL,
--         qual og with_check = (user_id = ( SELECT auth.uid() AS uid)).
--   2. Supabase performance-advisors: auth_rls_initplan er vaek.
