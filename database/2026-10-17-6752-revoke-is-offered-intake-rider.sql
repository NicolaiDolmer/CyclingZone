-- =============================================================================
-- 2026-10-17 — Advisor 0029: revoke ubrugt is_offered_intake_rider(uuid) (#6752)
-- =============================================================================
--
-- PROBLEM: Supabase-advisoren `0029_authenticated_security_definer_function_
-- executable` flagger `public.is_offered_intake_rider(uuid)`. Den eneste grund
-- til at authenticated beholdt EXECUTE var at riders-policyen "Public read
-- riders" kaldte den pr. række (se docs/SUPABASE_SECURITY_ADVISORS.md, ejer-
-- beslutning B 12/9). #6341 (database/2026-10-08-6341-riders-rls-per-row.sql)
-- erstattede kaldet med den set-baserede helper offered_intake_rider_ids() og
-- lod bevidst grantet stå for en simpel rollback. Den begrundelse er nu
-- forældet: ingen klientrolle har brug for at kalde funktionen.
--
-- BEVIS (read-only mod prod 17/10, Supabase MCP):
--   - pg_policies (alle skemaer), qual + with_check:      0 referencer
--   - pg_views / pg_matviews, definition:                  0 referencer
--   - pg_proc.prosrc (alle andre funktioner):              0 referencer
--   - pg_trigger med funktionen som trigger-funktion:      0
--   - pg_depend (ikke-interne afhængigheder):              0
--   - "Public read riders" USING = (SELECT is_admin()) OR NOT (id IN (SELECT
--     o.rider_id FROM offered_intake_rider_ids() o(rider_id)))
--   - proacl = postgres, authenticated, service_role (anon allerede revoket i
--     2026-06-29-secure-securitydefiner-rpc-grants.sql; PUBLIC har intet)
--   - Kode: ingen `.rpc("is_offered_intake_rider")` / `.rpc('is_offered...')` i
--     backend/ eller frontend/ (kun kommentarer + genererede typer).
--
-- LØSNING: REVOKE EXECUTE fra PUBLIC, anon og authenticated. service_role
-- (drift/scripts) og ejeren postgres beholder EXECUTE. Kroppen røres ikke, og
-- funktionen droppes ikke: backend/test/rls/ridersReadPolicy.test.js bruger
-- dens definition som facit for at offered_intake_rider_ids() har PRÆCIS samme
-- betingelser, og post-verify 2 i #6341-migrationen sammenligner de to.
--
-- offered_intake_rider_ids() (#6341) røres IKKE. Den har samme 0029-fund, men
-- det er bevidst: den kaldes fra riders-RLS-policyen, som evalueres med
-- kalderens rettigheder, så authenticated SKAL have EXECUTE (ellers fejler al
-- indlogget læsning af riders med 42501). Den returnerer kun id'er der allerede
-- er skjult. Dokumenteret i docs/SUPABASE_SECURITY_ADVISORS.md (#6752).
--
-- Idempotent: REVOKE på et privilegium der ikke findes er en no-op.
-- Ingen prod-apply som del af at skrive filen: auto-migrate.yml kører den ved
-- merge (#2642); post-verify nederst køres efter.
--
-- =============================================================================
-- ROLLBACK (gen-indfører det tidligere grant)
-- =============================================================================
--   GRANT EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) TO authenticated;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_offered_intake_rider(uuid) TO service_role;

COMMIT;

-- PostgREST schema-cache reload (RPC-eksponering ændret).
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- POST-VERIFY (køres EFTER apply, read-only — forventet output i kommentaren)
-- =============================================================================
-- 1. Grants:
--   SELECT has_function_privilege('anon',          'public.is_offered_intake_rider(uuid)', 'EXECUTE'), -- false
--          has_function_privilege('authenticated', 'public.is_offered_intake_rider(uuid)', 'EXECUTE'), -- false
--          has_function_privilege('service_role',  'public.is_offered_intake_rider(uuid)', 'EXECUTE'); -- true
--   SELECT proacl FROM pg_proc WHERE oid = 'public.is_offered_intake_rider(uuid)'::regprocedure;
--     -- forventet: {postgres=X/postgres,service_role=X/postgres}
--
-- 2. Riders-læsning som authenticated virker stadig (policyen bruger den ikke):
--   BEGIN READ ONLY; SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM public.riders WHERE is_retired = false;  -- et tal, ingen 42501
--   ROLLBACK;
--
-- 3. Søsterhelperen uændret:
--   SELECT has_function_privilege('authenticated', 'public.offered_intake_rider_ids()', 'EXECUTE'), -- true
--          has_function_privilege('anon',          'public.offered_intake_rider_ids()', 'EXECUTE'); -- false
--
-- 4. Advisor: get_advisors(type: "security") viser IKKE længere 0029 på
--    is_offered_intake_rider; de tre resterende 0029 er founder_public_list(),
--    is_admin() og offered_intake_rider_ids() (alle dokumenteret bevidst åbne).
-- =============================================================================
