-- Write-grant + default-privilege audit helper RPCs (#2830).
-- Companion to database/2026-05-10-audit-rls-helper.sql (audit_rls_coverage,
-- the SELECT-coverage side). These two cover the WRITE side: does
-- anon/authenticated hold table-level INSERT/UPDATE/DELETE/TRUNCATE that
-- isn't actually contained by RLS, and do newly-created tables keep
-- inheriting that grant via ALTER DEFAULT PRIVILEGES?
--
-- Used by backend/scripts/audit-rls-coverage.js (classifyWriteGrants,
-- classifyDefaultPrivileges) — wired into the existing .github/workflows/
-- rls-audit.yml (weekly cron + PR trigger), no new workflow needed. The
-- script degrades gracefully (info-only note, not a crash) if these RPCs
-- aren't applied yet, so merging the script change ahead of this SQL is
-- safe.
--
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/
-- README.md). Read-only, SECURITY DEFINER, EXECUTE revoked from anon/
-- authenticated (same posture as audit_rls_coverage) — these functions
-- themselves grant nothing and mutate nothing.

-- ── 1. audit_write_grants() ─────────────────────────────────────────────
-- One row per public relation (table or view) that anon or authenticated
-- hold any of INSERT/UPDATE/DELETE/TRUNCATE on, plus:
--   - rls_enabled (base tables only; null for views — RLS doesn't attach to
--     a view itself, only to whatever base table its DML rewrites into)
--   - view_is_insertable / view_is_updatable (information_schema.views —
--     whether the view is auto-updatable, i.e. Postgres would actually
--     rewrite a client INSERT/UPDATE against it into a write on the
--     underlying base table; #2830 found one such view in this schema,
--     ai_active_season_status, currently safe only because its underlying
--     `seasons` table has no covering write policy for anon/authenticated)
--   - *_policy_covers_client — whether a real INSERT/UPDATE/DELETE policy
--     exists that a client role (anon/authenticated/public) could satisfy.
--     This does NOT mean the policy is safe — only that the grant is "live"
--     rather than blocked by RLS default-deny. Column/value scoping inside
--     the policy (the #2802 lesson) still needs human review.
CREATE OR REPLACE FUNCTION public.audit_write_grants()
RETURNS TABLE (
  table_name text,
  relkind text,
  is_view boolean,
  rls_enabled boolean,
  view_is_insertable boolean,
  view_is_updatable boolean,
  anon_insert boolean,
  anon_update boolean,
  anon_delete boolean,
  anon_truncate boolean,
  authenticated_insert boolean,
  authenticated_update boolean,
  authenticated_delete boolean,
  authenticated_truncate boolean,
  insert_policy_covers_client boolean,
  update_policy_covers_client boolean,
  delete_policy_covers_client boolean,
  write_policy_names text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH grant_pivot AS (
    SELECT
      table_name,
      bool_or(grantee = 'anon' AND privilege_type = 'INSERT') AS anon_insert,
      bool_or(grantee = 'anon' AND privilege_type = 'UPDATE') AS anon_update,
      bool_or(grantee = 'anon' AND privilege_type = 'DELETE') AS anon_delete,
      bool_or(grantee = 'anon' AND privilege_type = 'TRUNCATE') AS anon_truncate,
      bool_or(grantee = 'authenticated' AND privilege_type = 'INSERT') AS authenticated_insert,
      bool_or(grantee = 'authenticated' AND privilege_type = 'UPDATE') AS authenticated_update,
      bool_or(grantee = 'authenticated' AND privilege_type = 'DELETE') AS authenticated_delete,
      bool_or(grantee = 'authenticated' AND privilege_type = 'TRUNCATE') AS authenticated_truncate
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    GROUP BY table_name
  ),
  policy_cmd AS (
    SELECT
      c.relname AS table_name,
      pol.polcmd,
      pol.polname,
      (
        0 = ANY(pol.polroles)
        OR EXISTS (
          SELECT 1 FROM unnest(pol.polroles) r
          WHERE pg_get_userbyid(r) IN ('authenticated', 'anon', 'public')
        )
      ) AS covers_client_role
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND pol.polcmd IN ('a', 'w', 'd', '*')
  ),
  policy_agg AS (
    SELECT
      table_name,
      bool_or(covers_client_role) FILTER (WHERE polcmd IN ('a', '*')) AS insert_covers,
      bool_or(covers_client_role) FILTER (WHERE polcmd IN ('w', '*')) AS update_covers,
      bool_or(covers_client_role) FILTER (WHERE polcmd IN ('d', '*')) AS delete_covers,
      array_agg(DISTINCT polname) FILTER (WHERE covers_client_role) AS write_policy_names
    FROM policy_cmd
    GROUP BY table_name
  ),
  rel AS (
    SELECT c.relname AS table_name, c.relkind::text AS relkind, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
  ),
  views AS (
    SELECT
      table_name,
      (is_insertable_into = 'YES') AS is_insertable,
      (is_updatable = 'YES') AS is_updatable
    FROM information_schema.views
    WHERE table_schema = 'public'
  )
  SELECT
    gp.table_name,
    rel.relkind,
    COALESCE(rel.relkind = 'v', false) AS is_view,
    rel.rls_enabled,
    views.is_insertable,
    views.is_updatable,
    COALESCE(gp.anon_insert, false),
    COALESCE(gp.anon_update, false),
    COALESCE(gp.anon_delete, false),
    COALESCE(gp.anon_truncate, false),
    COALESCE(gp.authenticated_insert, false),
    COALESCE(gp.authenticated_update, false),
    COALESCE(gp.authenticated_delete, false),
    COALESCE(gp.authenticated_truncate, false),
    COALESCE(pa.insert_covers, false),
    COALESCE(pa.update_covers, false),
    COALESCE(pa.delete_covers, false),
    COALESCE(pa.write_policy_names, ARRAY[]::text[])
  FROM grant_pivot gp
  LEFT JOIN rel ON rel.table_name = gp.table_name
  LEFT JOIN views ON views.table_name = gp.table_name
  LEFT JOIN policy_agg pa ON pa.table_name = gp.table_name
  ORDER BY gp.table_name;
$$;

REVOKE ALL ON FUNCTION public.audit_write_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_write_grants() TO service_role;

-- ── 2. audit_default_privileges() ───────────────────────────────────────
-- The actual forward-guard signal: does creating a brand-new table in
-- `public` still hand anon/authenticated INSERT/UPDATE/DELETE/TRUNCATE for
-- free? Empty result = clean. Any row = a future CREATE TABLE inherits the
-- #2830 hole again, same failure mode as #2676/#3013 (REVOKE ... FROM
-- PUBLIC does not touch a named-role default ACL entry).
--
-- Scoped to defaclobjtype='r' (relations) and grantor 'postgres' — the role
-- this repo's migrations actually run as (hard rule 9). A second default ACL
-- entry exists for grantor 'supabase_admin' with the same broad grant
-- (verified 2026-08-05); this repo's own `postgres` role is NOT a member of
-- supabase_admin, so it cannot ALTER those defaults — flagged separately in
-- the migration header as "cannot fix from here", not silently dropped.
CREATE OR REPLACE FUNCTION public.audit_default_privileges()
RETURNS TABLE (
  grantor_role text,
  schema_name text,
  grantee_role text,
  privilege_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    pg_get_userbyid(d.defaclrole) AS grantor_role,
    n.nspname AS schema_name,
    pg_get_userbyid(a.grantee) AS grantee_role,
    a.privilege_type
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
  WHERE d.defaclobjtype = 'r'
    AND n.nspname = 'public'
    AND pg_get_userbyid(d.defaclrole) = 'postgres'
    AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
$$;

REVOKE ALL ON FUNCTION public.audit_default_privileges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_default_privileges() TO service_role;

-- =============================================================================
-- Post-apply verification
-- =============================================================================
-- 1) Both RPCs exist and are locked down to service_role only:
--
--   SELECT p.proname, pg_get_functiondef(p.oid) ~ 'SECURITY DEFINER' AS is_secdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN ('audit_write_grants','audit_default_privileges');
--
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.role_routine_grants
--   WHERE routine_schema='public'
--     AND routine_name IN ('audit_write_grants','audit_default_privileges')
--     AND grantee IN ('anon','authenticated','PUBLIC');
--   -- Forventet: 0 rows (kun service_role har EXECUTE).
--
-- 2) Sanity call (read-only, no mutation):
--
--   SELECT * FROM public.audit_write_grants() LIMIT 5;
--   SELECT * FROM public.audit_default_privileges();
--   -- Forventet efter 2026-08-05-2830-write-grants-lockdown.sql er kørt:
--   -- audit_default_privileges() returnerer 0 rows.
--
-- 3) Backend audit script picks it up automatically (no code change needed
--    beyond what already shipped in the same PR):
--
--   node backend/scripts/audit-rls-coverage.js --json
--   -- "(schema default privileges)" finding disappears once the lockdown
--   -- migration below has been applied.
-- =============================================================================
