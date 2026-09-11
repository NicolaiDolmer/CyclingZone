-- =============================================================================
-- 2026-09-11 — Supabase security-advisors: hærdning af de WARN der kan lukkes
-- med ren katalog-DDL (#5153)
-- =============================================================================
--
-- KONTEKST: `get_advisors(type: security)` 11/9 kl. 12:51 (read-only MCP) viser
-- 11 WARN (issuets tabel siger 12; den faktiske optælling fra advisoren er 11)
-- plus 117 INFO. Klassifikation + status pr. fund: docs/SUPABASE_SECURITY_ADVISORS.md.
--
--   # | lint                                              | objekt                    | denne migration
--   --|---------------------------------------------------|---------------------------|-----------------
--   1 | 0011_function_search_path_mutable                 | record_forum_thread_view  | LUKKES (§A)
--   2 | 0014_extension_in_public                          | btree_gist                | LUKKES (§B)
--   3 | 0028_anon_security_definer_function_executable    | is_admin()                | LUKKES (§C)
--   4 | 0029_authenticated_..._function_executable        | is_beta_tester()          | LUKKES (§D)
--   5 | 0029_authenticated_..._function_executable        | is_admin()                | IKKE (§F.1)
--   6 | 0029_authenticated_..._function_executable        | is_offered_intake_rider() | IKKE (§F.2)
--   7 | 0029_authenticated_..._function_executable        | founder_public_list()     | IKKE (§F.3)
--  8-11| 0016_materialized_view_in_api                    | 4 matviews                | IKKE (§F.4)
--
-- Forventet effekt: 11 WARN → 7 WARN. De 7 kræver frontend-/policy-ændringer
-- uden for denne migrations ejerskab og er dokumenteret med opskrift i
-- docs/SUPABASE_SECURITY_ADVISORS.md — ikke efterladt som ukendt gæld.
--
-- VERIFICERET read-only mod prod (execute_sql, project ghwvkxzhsbbltzfnuhhz,
-- 11/9 — ingen rækker muteret, ingen DDL kørt):
--   V1. pg_proc for de fem funktioner:
--       - record_forum_thread_view(uuid,uuid): prosecdef=false (INVOKER),
--         proconfig=NULL (→ 0011), proacl = {postgres, service_role} (allerede
--         revoket fra anon/authenticated i #5000).
--       - is_admin(): DEFINER, search_path sat, proacl inkluderer anon.
--       - is_beta_tester(): DEFINER, search_path sat, proacl = {postgres,
--         authenticated, service_role} (ingen anon).
--       - is_offered_intake_rider(uuid): DEFINER, search_path sat, proacl =
--         {postgres, authenticated, service_role} — anon har IKKE EXECUTE.
--       - founder_public_list(): DEFINER, search_path sat, authenticated har
--         EXECUTE.
--   V2. pg_policies: KUN ÉN policy med roles={public} refererer nogen af de
--       fire funktioner: "Public read riders" ON public.riders FOR SELECT
--       USING (is_admin() OR (NOT is_offered_intake_rider(id))).
--   V3. Ingen anden funktion i public med anon-EXECUTE (eller default-PUBLIC
--       ACL) kalder is_admin() i sin krop; ingen view-definition og ingen
--       policy i nogen rolle refererer is_beta_tester().
--   V4. has_table_privilege('anon','public.riders','SELECT') = FALSE. anon har
--       altså ikke bord-niveau-SELECT på riders og når ALDRIG frem til at
--       evaluere policyen i V2 (grant-checket ligger før RLS). Se §C.
--   V5. btree_gist: extrelocatable=true, extnamespace=public, skemaet
--       `extensions` findes. 0 exclusion-constraints i HELE databasen
--       (pg_constraint.contype='x') og 0 indekser bruger en opclass fra
--       btree_gist. Extensionen er i praksis ubrugt i dag.
--   V6. has_table_privilege('anon', <matview>, 'SELECT') = FALSE for
--       rider_rankings_mv (anon-revoke fra #3124 holder), mens
--       has_table_privilege('authenticated', ...) = TRUE. 0016 skyldes altså
--       udelukkende `authenticated` i dag.
--   V7. De fire views der findes i public i dag (ai_active_season_status,
--       ai_race_import_blockers, ai_recent_import_health, roadmap_item_scores)
--       har ALLE reloptions={security_invoker=true}, og ejeren `postgres` har
--       rolbypassrls=true. Se §F.4 for hvorfor det udelukker "view foran
--       matview"-tricket.
--
-- Ingen prod-apply som del af at skrive filen: auto-migrate.yml kører den ved
-- merge (hard rule 9 / #2642), post-verify-sektionen nederst køres efter.
--
-- =============================================================================
-- ROLLBACK (ikke anbefalet — gen-åbner præcis de fund der lukkes her)
-- =============================================================================
--   ALTER FUNCTION public.record_forum_thread_view(uuid, uuid) RESET search_path;
--   ALTER EXTENSION btree_gist SET SCHEMA public;
--   GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
--   GRANT EXECUTE ON FUNCTION public.is_beta_tester() TO authenticated;
-- =============================================================================

BEGIN;

-- ── §A  0011: record_forum_thread_view uden fast search_path ────────────────
-- Funktionen er SECURITY INVOKER og kun service_role-kaldbar (#5000), så en
-- mutable search_path er ikke en privilegie-eskalering i dag. Den er stadig en
-- fælde: kroppen slår op på public.forum_posts + public.forum_thread_views
-- UKVALIFICERET, så en kalder der sætter search_path til et skema med
-- skyggetabeller kan få INSERT/UPDATE til at ramme de forkerte relationer.
-- `public, pg_catalog` er husmønstret (samme som is_admin() og
-- is_offered_intake_rider()). Kroppen bruger ON CONFLICT ON CONSTRAINT +
-- GET DIAGNOSTICS og har ingen behov uden for de to skemaer.
ALTER FUNCTION public.record_forum_thread_view(uuid, uuid)
  SET search_path = public, pg_catalog;

-- ── §B  0014: extension btree_gist i public-skemaet ─────────────────────────
-- Flyttes til `extensions` (Supabase-konventionen; skemaet findes allerede og
-- har USAGE til anon/authenticated som standard). Sikkert fordi extensionen er
-- relocatable OG i praksis ubrugt: 0 exclusion-constraints og 0 indekser
-- bruger dens opclasses (V5). Eksisterende indekser refererer i øvrigt
-- opclasses via OID, ikke navn, så en skema-flytning kan ikke invalidere dem.
--
-- Fremadrettet: en NY `EXCLUDE USING gist (uuid_kolonne WITH =, ...)` skal have
-- `extensions` i search_path (eller skema-kvalificere opclassen), fordi
-- btree_gist-opclasses så ikke længere ligger i public. Det er bevidst:
-- migrationer kører som postgres, hvis search_path i Supabase inkluderer
-- extensions. Noteret i docs/SUPABASE_SECURITY_ADVISORS.md.
--
-- DO-blok fordi ALTER EXTENSION ... SET SCHEMA ikke har en IF-form: anden
-- kørsel skal være en no-op, ikke en fejl.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'btree_gist'
      AND n.nspname = 'public'
  ) AND EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'
  ) THEN
    EXECUTE 'ALTER EXTENSION btree_gist SET SCHEMA extensions';
    RAISE NOTICE '#5153: btree_gist flyttet public → extensions';
  ELSE
    RAISE NOTICE '#5153: btree_gist ikke i public (eller extensions-skema mangler) — no-op';
  END IF;
END
$$;

-- ── §C  0028: is_admin() kaldbar af anon via /rest/v1/rpc ───────────────────
-- anon mister EXECUTE. Det er IKKE en gentagelse af #2671/#2676-incidenten
-- (hvor den manglende anon-EXECUTE gav en løbende 42501-strøm "permission
-- denied for function is_admin" på anon-læsninger af riders), og det
-- gen-åbner den ikke:
--
--   1. Policyen der udløste incidenten — "Public read riders", roles={public},
--      USING (is_admin() OR NOT is_offered_intake_rider(id)) — står stadig
--      (V2). MEN anon har ikke længere bord-niveau-SELECT på public.riders
--      (V4: has_table_privilege = FALSE). GRANT-checket ligger FØR RLS, så
--      anon afvises allerede inden policy-udtrykket evalueres. anon kalder
--      altså ikke is_admin() ad den vej i dag.
--   2. Selv hvis bord-granten kom tilbage, er anon-stien allerede fail-closed
--      på policyens ANDEN operand: anon har ikke EXECUTE på
--      is_offered_intake_rider(uuid) (V1). `false OR NOT f(x)` kan ikke
--      kortslutte, så den operand SKAL evalueres → 42501 uanset is_admin().
--      #3124s begrundelse for at beholde anon-granten (28/7 + 3/8) hviler på en
--      tilstand der ikke længere findes.
--   3. Ingen anden anon-nåelig vej kalder is_admin(): ingen anden funktion med
--      anon-/default-PUBLIC-EXECUTE har den i kroppen, og ingen view-definition
--      bruger den (V3).
--
-- `authenticated` BEHOLDER EXECUTE med vilje: frontend kalder den direkte som
-- RPC (frontend/src/pages/RoadmapPage.jsx:213 og SurveyPage.jsx:155 — begge
-- client-side admin-gates hvor RLS er source of truth), og alle
-- authenticated-role-policies der gater på is_admin() skal kunne kalde den.
-- Derfor bliver 0029-fundet for is_admin() stående (§F.1).
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- ── §D  0029: is_beta_tester() kaldbar af authenticated ─────────────────────
-- Eneste af de fire 0029-funktioner uden en reel kalder på API-fladen:
--   - Ingen RLS-policy i NOGEN rolle refererer den (V3).
--   - Ingen view-definition og ingen anden funktionskrop refererer den (V3).
--   - Ingen frontend-RPC: `grep -rn "is_beta_tester" frontend/src` giver kun
--     users-kolonnen + den genererede database.types.ts.
--   - Backendens beta-gate læser users.is_beta_tester DIREKTE via service_role
--     (backend/routes/api.js:935-945), ikke via denne funktion.
-- service_role beholder EXECUTE, så en fremtidig server-side beta-gate kan
-- bruge den uden ny migration. Skal den igen kaldes fra klienten, er
-- gen-granten én linje (se ROLLBACK).
REVOKE EXECUTE ON FUNCTION public.is_beta_tester() FROM authenticated;

-- ── §E  Defensiv re-assertion: matview-anon-revoke (0016, delvist) ──────────
-- #3124 (3/8) fjernede anon-adgangen til alle fire matviews, og V6 bekræfter
-- at den holder. Supabase' ALTER DEFAULT PRIVILEGES har gen-grantet
-- SELECT/EXECUTE til anon+authenticated på nye objekter før (#1971, #2830,
-- #3124), og et matview gen-skabes ved hver schema-restore. REVOKE på et
-- privilegium der ikke findes er en no-op, så dette er gratis drift-beskyttelse
-- — ikke en adfærdsændring. `authenticated` røres IKKE (§F.4).
REVOKE ALL ON TABLE public.rider_rankings_mv     FROM anon;
REVOKE ALL ON TABLE public.global_rank_mv        FROM anon;
REVOKE ALL ON TABLE public.team_race_points_mv   FROM anon;
REVOKE ALL ON TABLE public.team_standings_ext_mv FROM anon;

-- ── §F  Hvad der IKKE ændres her, og hvorfor ────────────────────────────────
-- F.1 is_admin() / 0029 (authenticated): kan ikke blive SECURITY INVOKER —
--     users-tabellens cross-user-read-policy gater selv på is_admin() (#548),
--     så en INVOKER-udgave der læser public.users ville give
--     "infinite recursion detected in policy for relation users" (42P17).
--     Den kan ikke revokes fra authenticated: to frontend-sider kalder den som
--     RPC, og authenticated-policies skal kunne evaluere den. Resterende vej er
--     at flytte RLS-hjælperen til et ikke-eksponeret skema OG at pege de to
--     frontend-gates om — frontend-filer ejes ikke af denne lane.
-- F.2 is_offered_intake_rider(uuid) / 0029: har ingen direkte RPC-kalder, men
--     "Public read riders" kalder den, og RLS-udtryk evalueres som den KALDENDE
--     rolle — authenticated SKAL derfor beholde EXECUTE, ellers fejler enhver
--     indlogget læsning af riders med 42501. Den kan lukkes ved at flytte
--     funktionen til et privat skema og ALTER POLICY'e riders over på den; det
--     er en ændring af spillets hotteste læse-policy og forudsætter samtidig en
--     ejer-beslutning om hvorvidt anon overhovedet skal kunne læse riders
--     (policyen siger roles={public}, men bord-granten siger nej — V2 vs. V4).
--     Opskrift + spørgsmål: docs/SUPABASE_SECURITY_ADVISORS.md.
-- F.3 founder_public_list() / 0029: kaldes direkte af
--     frontend/src/lib/useFounderTeams.js:22 som authenticated. DEFINER fordi
--     den aggregerer founder-numre på tværs af hold uden at eksponere
--     users-rækker. Kan ikke revokes uden at fjerne founder-mærket i UI'en.
--     anon blev revoket i #4870.
-- F.4 De fire matviews / 0016 (×4): alle fire læses DIREKTE fra frontend som
--     authenticated — global_rank_mv (GlobalRankWidget.jsx, useGlobalRank.js,
--     TeamProfilePage.jsx), rider_rankings_mv (TeamStatsTab.jsx,
--     useRiderRankings.js, ResultaterPage.jsx), team_race_points_mv
--     (useNpsPrompt.js, DashboardPage.jsx, StandingsPage.jsx),
--     team_standings_ext_mv (StandingsPage.jsx). Lint 0016 forsvinder først når
--     HVERKEN anon NOR authenticated har SELECT, så den kræver at alle otte
--     kaldesteder peges om. Det naive trick — flyt matview til privat skema og
--     læg et view med samme navn i public — virker IKKE her: et
--     security_invoker-view kræver at kalderen selv har SELECT på matview'et
--     (altså ingen gevinst), og et view UDEN security_invoker ejet af
--     `postgres` (rolbypassrls=true, V7) ville bare bytte 4× 0016 for 4×
--     0010_security_definer_view — samme WARN-niveau, og det bryder husmønstret
--     hvor alle fire eksisterende public-views er security_invoker=true.
--     Reel vej: RPC'er eller backend-endpoints + REVOKE fra authenticated.
--     Frontend-filer ejes ikke af denne lane → eget issue.

COMMIT;

-- PostgREST cacher skemaet: uden reload slår grant-ændringerne (og den flyttede
-- extension) først igennem ved næste genstart (hard rule 9; samme mønster som
-- #2676/#3013/#3124).
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- POST-VERIFY (køres EFTER apply — forventet output i kommentaren)
-- =============================================================================
-- SELECT
--   (SELECT proconfig::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname = 'record_forum_thread_view')
--     AS forum_search_path,          -- forventet: {"search_path=public, pg_catalog"}
--   (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
--      WHERE e.extname = 'btree_gist')
--     AS btree_gist_schema,          -- forventet: extensions
--   has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
--     AS anon_is_admin,              -- forventet: false
--   has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
--     AS authn_is_admin,             -- forventet: true  (frontend-RPC + policies)
--   has_function_privilege('authenticated', 'public.is_beta_tester()', 'EXECUTE')
--     AS authn_beta,                 -- forventet: false
--   has_function_privilege('service_role', 'public.is_beta_tester()', 'EXECUTE')
--     AS service_beta,               -- forventet: true
--   has_function_privilege('authenticated', 'public.is_offered_intake_rider(uuid)', 'EXECUTE')
--     AS authn_intake,               -- forventet: true  (riders-policyen, §F.2)
--   has_table_privilege('anon', 'public.rider_rankings_mv', 'SELECT')
--     AS anon_mv;                    -- forventet: false
--
-- Derefter: get_advisors(type: security) skal vise 7 WARN (0016 ×4 + 0029 ×3)
-- og 0 fund for 0011, 0014 og 0028.
--
-- Funktionelt smoke-test (authenticated, preview eller prod):
--   /standings, /dashboard, /resultater, /teams/:id  → ranglister loader
--   /roadmap + survey-siden som admin                → admin-flade vises
--   forum-tråd åbnes                                 → view_count tæller op
-- =============================================================================
