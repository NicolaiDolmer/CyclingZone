-- =============================================================================
-- 2026-10-08 — "Public read riders": ingen funktionskald pr. række (#6341)
-- =============================================================================
--
-- PROBLEM: rytterlister (transferliste, trup, rytter-DB) tog ~0,8-1,0 s pr. kald
-- for `authenticated` (pg_stat_statements 8/10). Policyen var
--
--     USING (is_admin() OR NOT is_offered_intake_rider(id))
--
-- Begge er SECURITY DEFINER-funktioner, og SECURITY DEFINER kan ikke inlines.
-- Postgres kalder derfor BEGGE pr. række der passerer de øvrige filtre: på en
-- fuld rytterliste ~12k gange is_admin() + ~12k gange is_offered_intake_rider().
-- Supabase-advisoren `auth_rls_initplan` fanger kun `auth.*()` og er blind for
-- egne funktioner, så fundet stod tavst.
--
-- BEVIS (EXPLAIN (ANALYZE, BUFFERS), read-only mod prod 8/10, SET LOCAL ROLE
-- authenticated i en transaktion der blev ROLLBACK'et). Riders-scanningen
-- alene, før → efter (efter = samme udtryk som nedenfor, kørt som postgres):
--   transferliste (owner_is_ai=false, top-50 + count)  riders-scan 247 ms → 33 ms,
--                                                       hele kaldet 628 → 198 ms
--   AI-holdenes ryttere (owner_is_ai=true, top-50+count) riders-scan 188 ms → 27 ms,
--                                                       hele kaldet 525 → 158 ms
--   rytterliste (is_retired=false, ORDER BY id)         riders-scan 354 ms → 34 ms,
--                                                       hele kaldet 467 → 130 ms
-- Rækkeantal identisk i alle tre. Fuld synligheds-ækvivalens på hele tabellen:
-- gammel og ny regel giver samme mængde id'er, symmetrisk differens = 0.
-- Resten af kaldstiden er PostgREST's LATERAL-opslag (rider_derived_abilities
-- pr. række), ikke RLS.
--
-- LØSNING:
--   1. `(SELECT public.is_admin())` — InitPlan, evalueres ÉN gang pr. query.
--   2. Den skjulte mængde (tilbudte, endnu ikke hentede intake-kandidater)
--      hentes ÉN gang som et sæt og testes med en hashed SubPlan:
--          NOT (id IN (SELECT ... FROM public.offered_intake_rider_ids()))
--
-- HVORFOR IKKE en rå `NOT EXISTS (SELECT 1 FROM academy_intake ...)` i policyen:
-- en subquery i en RLS-policy kører under KALDERENS RLS, og
-- `academy_intake_owner_read` begrænser authenticated til EGET holds rækker
-- (verificeret i pg_policy 8/10). En kandidat tilbudt et ANDET hold ville så
-- ikke blive skjult — en lækage, præcis det #1743 (2026-06-22-hide-intake-
-- riders-from-db.sql) valgte SECURITY DEFINER for at undgå. Den nye helper er
-- derfor stadig SECURITY DEFINER, men set-returnerende: kaldt én gang, ikke pr.
-- række.
--
-- IDENTISK SYNLIGHED: offered_intake_rider_ids() returnerer præcis de id'er
-- som is_offered_intake_rider(id) svarer true for (samme join, samme tre
-- betingelser: status='offered', team_id IS NULL, is_academy=false). Admin ser
-- stadig alt. anon fejler stadig fail-closed med 42501 (på is_admin(), som
-- anon fortsat ikke har EXECUTE på; anon får heller ikke EXECUTE på den nye
-- helper) — uændret beslutning, jf.
-- .claude/learnings/2026-07-18-anon-riders-select-fail-closed-42501.md.
--
-- NULL-sikkerhed for NOT IN: helperen joiner på riders.id (PK, NOT NULL), så
-- den kan aldrig returnere NULL. Ville den, ville NOT IN give NULL → rækken
-- skjules (fail-closed retning), aldrig en lækage.
--
-- is_offered_intake_rider(uuid) RØRES IKKE (grants og krop uændret), så en
-- rollback er én ALTER POLICY. Den bruges ikke længere af nogen policy; at
-- revoke/droppe den er en separat oprydning.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT, ALTER POLICY (ikke
-- DROP+CREATE → atomisk, intet deny-all-vindue).
-- Ingen prod-apply som del af at skrive filen: auto-migrate.yml kører den ved
-- merge (#2642); post-verify nederst køres efter.
--
-- =============================================================================
-- ROLLBACK (gen-indfører den langsomme, men korrekte policy)
-- =============================================================================
--   ALTER POLICY "Public read riders" ON public.riders
--     USING (public.is_admin() OR NOT public.is_offered_intake_rider(id));
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================

BEGIN;

-- Sæt-udgaven af is_offered_intake_rider(uuid). ROWS 2000: planner-estimat i
-- samme størrelsesorden som den reelle mængde (~1,6k 8/10), så den hashede
-- SubPlan vælges frem for en lineær scanning pr. række.
CREATE OR REPLACE FUNCTION public.offered_intake_rider_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
ROWS 2000
AS $$
  SELECT DISTINCT ai.rider_id
  FROM public.academy_intake ai
  JOIN public.riders r ON r.id = ai.rider_id
  WHERE ai.status = 'offered'
    AND r.team_id IS NULL
    AND r.is_academy = false;
$$;

-- Supabase' ALTER DEFAULT PRIVILEGES giver anon+authenticated EXECUTE på nye
-- funktioner (#1971/#2830/#3124). Revoke eksplicit fra anon, grant kun det
-- policyen kræver: authenticated evaluerer policyen; service_role til drift.
REVOKE ALL ON FUNCTION public.offered_intake_rider_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.offered_intake_rider_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.offered_intake_rider_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.offered_intake_rider_ids() IS
  'Set of rider ids hidden from non-admins by the riders read-policy (#6341): '
  'riders with an offered academy_intake row that are still free (team_id IS NULL, '
  'is_academy = false). Same rule as is_offered_intake_rider(uuid), evaluated once '
  'per query instead of once per row. SECURITY DEFINER so it sees all of '
  'academy_intake, not only the caller''s own team.';

ALTER POLICY "Public read riders" ON public.riders
  USING (
    (SELECT public.is_admin())
    OR NOT (id IN (SELECT o.rider_id FROM public.offered_intake_rider_ids() AS o(rider_id)))
  );

COMMIT;

-- PostgREST schema-cache reload (policy-/funktions-ændring).
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- POST-VERIFY (køres EFTER apply, read-only — forventet output i kommentaren)
-- =============================================================================
-- 1. Policy + grants:
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--    WHERE polrelid = 'public.riders'::regclass AND polname = 'Public read riders';
--     -- forventet: ( SELECT is_admin() AS is_admin) OR (NOT (id IN ( SELECT o.rider_id
--     --            FROM offered_intake_rider_ids() o(rider_id))))
--   SELECT has_function_privilege('authenticated', 'public.offered_intake_rider_ids()', 'EXECUTE'), -- true
--          has_function_privilege('anon',          'public.offered_intake_rider_ids()', 'EXECUTE'), -- false
--          has_function_privilege('service_role',  'public.offered_intake_rider_ids()', 'EXECUTE'); -- true
--
-- 2. Identisk synlighed (som postgres; symmetrisk differens skal være 0/0):
--   WITH old_vis AS (SELECT id FROM public.riders WHERE NOT public.is_offered_intake_rider(id)),
--        new_vis AS (SELECT id FROM public.riders
--                     WHERE NOT (id IN (SELECT public.offered_intake_rider_ids())))
--   SELECT (SELECT count(*) FROM (SELECT id FROM old_vis EXCEPT SELECT id FROM new_vis) a),
--          (SELECT count(*) FROM (SELECT id FROM new_vis EXCEPT SELECT id FROM old_vis) b);
--
-- 3. Plan som authenticated (ingen funktion pr. række):
--   BEGIN READ ONLY; SET LOCAL ROLE authenticated;
--   EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM public.riders WHERE is_retired = false;
--   ROLLBACK;
--     -- forventet Filter: ... ((InitPlan 1).col1 OR (NOT (ANY (id = (hashed SubPlan 2).col1))))
--     -- og INGEN "is_offered_intake_rider(id)" i Filter-linjen.
--
-- 4. anon stadig fail-closed (uændret):
--   BEGIN; SET LOCAL ROLE anon; SELECT 1 FROM public.riders LIMIT 1; ROLLBACK;
--     -- forventet: ERROR 42501 permission denied for function is_admin
-- =============================================================================
