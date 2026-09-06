-- =============================================================================
-- 2026-09-06 — #4870: luk de tre interne metrics-RPC'er for spillere
-- =============================================================================
-- Supabase security advisor (5/9) fandt at get_cohort_retention(int),
-- get_retention_scorecard_activity(int) og get_sprint_metrics(text) kan kaldes
-- over /rest/v1/rpc/<navn> af ENHVER indlogget spiller (rollen `authenticated`).
-- Alle tre er SECURITY DEFINER og læser auth.users + player_events — altså
-- interne vækst-/retention-tal, ikke spil-data.
--
-- ── Hvorfor grant'en har overlevet tre tidligere runder ──────────────────────
-- 2026-05-21-security-hardening-phase-a.sql, 2026-07-11-revoke-rpc-grants-2327.sql,
-- 2026-07-19-revoke-rpc-grants-2676.sql og 2026-08-03-growth-snapshots-3196.sql §2
-- BEVAREDE alle bevidst `authenticated` med samme begrundelse: de tre funktioner
-- har en intern gate (`IF NOT (public.is_admin() OR auth.role() = 'service_role')
-- THEN RAISE EXCEPTION 'forbidden'`), OG admin-fladen kaldte dem DIREKTE fra
-- browseren med bruger-JWT. En revoke uden at flytte kaldene ville have brudt
-- admin-siden — derfor blev advisor-WARN'en accepteret som "kendt og gated".
--
-- Denne PR fjerner forudsætningen: kaldene er flyttet bag et admin-gatet
-- backend-endpoint (GET /api/admin/growth/sprint-metrics, `requireAdmin`), som
-- kalder RPC'erne med service_role-klienten. Ingen browser kalder dem længere
-- med bruger-JWT, og grant'en kan derfor fjernes uden funktionstab.
--
-- ── Kaldsteds-analyse (grep af frontend/src + backend + scripts, 6/9) ────────
--   get_sprint_metrics(text)
--     · frontend/src/pages/AdminSprintMetricsPage.jsx   → FLYTTET til backend-endpoint i denne PR
--     · frontend/src/components/admin/growth/GrowthOverviewTab.jsx (fallback)
--                                                        → FLYTTET til samme endpoint
--     · backend/scripts/snapshot-sprint-metrics.mjs      → service_role (GHA), uændret
--   get_cohort_retention(int)
--     · frontend/src/pages/AdminSprintMetricsPage.jsx    → FLYTTET til backend-endpoint i denne PR
--   get_retention_scorecard_activity(int)
--     · backend/routes/api.js (GET /admin/retention, requireAdmin) → service_role, uændret.
--       INGEN klient-kald. Grant'en har aldrig været brugt fra browseren.
--
-- Defense in depth: den interne is_admin()-gate BLIVER stående. Efter denne
-- migration skal en kalder både have EXECUTE (kun service_role) og passere
-- gaten. Fejler PostgREST-kaldet nu, gør det det som 42501 "permission denied
-- for function" i stedet for 'forbidden' — samme fail-closed udfald for en
-- ikke-admin, blot ét lag tidligere.
--
-- ── ADDENDUM-fælden fra 2026-06-29 (læst, IKKE gentaget) ────────────────────
-- Den migration revoke'de anon på `is_admin()` og `is_offered_intake_rider()`,
-- og opdagede bagefter (ADDENDUM 18/7) at BEGGE kaldes fra riders-SELECT-
-- policyen "Public read riders" — så alle anon-læsninger af riders begyndte at
-- fejle med 42501. Lærdommen: en funktion kan være kaldt af en RLS-POLICY, ikke
-- kun af app-kode, og et grep i frontend/backend ser ikke policy-kald.
--
-- Kontrolleret her: ingen af de fire funktioner denne migration rører nævnes i
-- nogen CREATE POLICY i database/*.sql (grep 6/9: `is_admin` og
-- `is_offered_intake_rider` er de eneste funktioner der optræder i USING/
-- WITH CHECK-udtryk). is_admin() og is_offered_intake_rider() RØRES IKKE her.
--
-- ── founder_public_list(): anon revokes, authenticated bevares ───────────────
-- Advisoren viste anon + authenticated. Kun `authenticated` er GRANTet i
-- funktionens egen migration (database/2026-09-03-4649-founder-public.sql);
-- anon-grant'en stammer fra Supabase' ALTER DEFAULT PRIVILEGES, ikke fra repoet.
-- Kaldsted: frontend/src/lib/useFounderTeams.js → FounderMark.jsx, brugt af
-- StandingsPage, TeamProfilePage, ForumPage + ForumAuthorIdentity — alle bag
-- login. INGEN pre-login-flade (landing/ProUpgradePage) kalder den; founder-
-- SEAT-tælleren på landing bruger det offentlige HTTP-endpoint
-- /api/billing/founder-seats, ikke denne RPC. Funktionen er ikke nævnt i nogen
-- RLS-policy. → anon er utilsigtet og revokes; funktionen forbliver
-- klient-kaldbar for indloggede (bevidst offentlig INDE i spillet).
--
-- ── Matviews (rider_rankings_mv m.fl.): ingen ændring her ───────────────────
-- Kolonne-for-kolonne-gennemgang mod fog of war er lavet i denne PR og noteret
-- i docs/GAME_INVARIANTS.md ("Matviews eksponeret i API"). Resultat: INGEN
-- skjulte tal (potentiale, løn, form, interne multiplikatorer) i nogen af de
-- fire matviews — alt er afledt af race_results/season_standings, som spilleren
-- allerede ser. Derfor ingen DROP/CREATE og ingen REVOKE på matviews her.
--
-- Idempotent: REVOKE af et privilegium der ikke findes, og GRANT af et der
-- allerede findes, er begge no-ops. Sikker at re-køre.
--
-- Anvendes automatisk i prod ved merge (.github/workflows/auto-migrate.yml).
--
-- ROLLBACK (gen-åbner advisor-WARN'en; kræver samtidig at frontend-kaldene
-- rulles tilbage til direkte .rpc(), ellers er den unødvendig):
--   GRANT EXECUTE ON FUNCTION public.get_cohort_retention(integer) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_retention_scorecard_activity(integer) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_sprint_metrics(text) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.founder_public_list() TO anon;
-- =============================================================================

BEGIN;

-- ── 1. De tre interne metrics-RPC'er: backend-only (service_role) ───────────
REVOKE EXECUTE ON FUNCTION public.get_cohort_retention(integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_cohort_retention(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_retention_scorecard_activity(integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_retention_scorecard_activity(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_sprint_metrics(text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_sprint_metrics(text) TO service_role;

-- ── 2. founder_public_list: bevidst offentlig INDE i spillet, aldrig for anon ─
REVOKE EXECUTE ON FUNCTION public.founder_public_list() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.founder_public_list() TO authenticated, service_role;

COMMENT ON FUNCTION public.founder_public_list() IS
  '#4649/#4870: offentligt Founder-maerke INDE i spillet. Eksponerer KUN team_id '
  '+ foelgende-nummer -- aldrig status, plan eller Alunta-id''er. GRANT: '
  'authenticated + service_role. anon er bevidst revokes (#4870, 6/9): alle '
  'kaldsflader (Stilling, holdside, forum) ligger bag login, og landingens '
  'seat-taeller bruger /api/billing/founder-seats.';

COMMIT;

-- =============================================================================
-- POST-VERIFY (kør efter merge/apply — forventet output står til højre)
-- =============================================================================
--
-- 1) EXECUTE-matrix pr. rolle. Alle tre metrics-RPC'er skal være f/f/t,
--    founder_public_list f/t/t.
--
--   SELECT p.oid::regprocedure::text                                    AS fn,
--          has_function_privilege('anon',          p.oid, 'EXECUTE')    AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE')    AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE')    AS service_role
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     -- Filtrér på proname, ikke på regprocedure-teksten: regprocedure skriver
--     -- kun skemaet foran hvis public IKKE er i sessionens search_path, så en
--     -- tekst-sammenligning kan tavst returnere nul rækker.
--     AND p.proname IN ('get_cohort_retention','get_retention_scorecard_activity',
--                       'get_sprint_metrics','founder_public_list')
--   ORDER BY 1;
--
--   Forventet:
--     founder_public_list()                       → anon=f  authenticated=t  service_role=t
--     get_cohort_retention(integer)               → anon=f  authenticated=f  service_role=t
--     get_retention_scorecard_activity(integer)   → anon=f  authenticated=f  service_role=t
--     get_sprint_metrics(text)                    → anon=f  authenticated=f  service_role=t
--
-- 2) Ingen efterladt PUBLIC-grant (den ville gøre revoken ovenfor virkningsløs):
--
--   SELECT p.oid::regprocedure::text AS fn, p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('get_cohort_retention','get_retention_scorecard_activity',
--                       'get_sprint_metrics','founder_public_list');
--
--   Forventet: ingen bar '=X/' -post (PUBLIC) i proacl for de fire rækker.
--
-- 3) Advisor: get_advisors(type='security') skal ikke længere vise
--    "authenticated_security_definer_function_executable_public_get_sprint_metrics…"
--    (eller de to tilsvarende for cohort/retention-scorecard).
--
-- 4) Røgtest af admin-fladen (den eneste vej ind nu):
--    GET /api/admin/growth/sprint-metrics?window=7d&weeks=8 med admin-JWT
--    → 200 med { metrics, cohorts }.  Samme kald uden admin → 403.
-- =============================================================================
