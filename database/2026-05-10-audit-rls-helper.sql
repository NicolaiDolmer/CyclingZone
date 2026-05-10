-- RLS audit helper RPC.
-- Returns one row per table in public schema with RLS state + policy summary.
-- Used by scripts/audit-rls-coverage.js (CI guard against slice 14 / #279
-- bug pattern where service_role writes succeed but authenticated reads
-- silently return [] because RLS is enabled with no covering policy).

CREATE OR REPLACE FUNCTION public.audit_rls_coverage()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count int,
  select_policy_count int,
  has_authenticated_select boolean,
  policy_names text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH policy_summary AS (
    SELECT
      pol.polrelid,
      COUNT(*)::int AS policy_count,
      SUM(CASE WHEN pol.polcmd IN ('r','*') THEN 1 ELSE 0 END)::int AS select_policy_count,
      bool_or(
        pol.polcmd IN ('r','*') AND (
          0 = ANY(pol.polroles)
          OR EXISTS (
            SELECT 1 FROM unnest(pol.polroles) r
            WHERE pg_get_userbyid(r) IN ('authenticated','public')
          )
        )
      ) AS has_authenticated_select,
      array_agg(pol.polname ORDER BY pol.polname) AS policy_names
    FROM pg_policy pol
    GROUP BY pol.polrelid
  )
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    COALESCE(ps.policy_count, 0) AS policy_count,
    COALESCE(ps.select_policy_count, 0) AS select_policy_count,
    COALESCE(ps.has_authenticated_select, false) AS has_authenticated_select,
    COALESCE(ps.policy_names, ARRAY[]::text[]) AS policy_names
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  LEFT JOIN policy_summary ps ON ps.polrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.audit_rls_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_rls_coverage() TO service_role;
