-- Feature-liveness audit helper RPCs.
-- Backs scripts/audit-feature-liveness.js (CI guard against the
-- "deployed kode + 0 data / 0 brugere"-mønstret — slice 14 / #279 lærepenge,
-- generaliseret per #287).
--
-- Three RPCs returnerer minimal data så node-scriptet kan klassificere:
--   1. feature_liveness_table_counts() — alle public-tabeller + row-count + rls-flag
--   2. feature_liveness_applied_migrations() — schema_migrations.filename liste
--   3. feature_liveness_prod_tables() — alle public-tabeller (basis for schema-drift)
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.feature_liveness_table_counts()
RETURNS TABLE (
  table_name text,
  row_count bigint,
  rls_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  rec record;
  cnt bigint;
BEGIN
  FOR rec IN
    SELECT c.relname::text AS tbl, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg\_%'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I', rec.tbl) INTO cnt;
    table_name := rec.tbl;
    row_count := cnt;
    rls_enabled := rec.rls;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.feature_liveness_table_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_liveness_table_counts() TO service_role;


CREATE OR REPLACE FUNCTION public.feature_liveness_applied_migrations()
RETURNS TABLE (filename text, applied_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT filename, applied_at
  FROM public.schema_migrations
  ORDER BY applied_at, filename;
$$;

REVOKE ALL ON FUNCTION public.feature_liveness_applied_migrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_liveness_applied_migrations() TO service_role;


CREATE OR REPLACE FUNCTION public.feature_liveness_prod_tables()
RETURNS TABLE (table_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT LIKE 'pg\_%'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public.feature_liveness_prod_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_liveness_prod_tables() TO service_role;
