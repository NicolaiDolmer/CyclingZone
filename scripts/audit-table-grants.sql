-- Read-only live inventory. No rows/identities from application tables.
-- A policy is not a grant. Missing grants may be intentional: compare with
-- the migration's access declaration and actual frontend/backend callsites.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, r.role_name, p.operation,
       has_table_privilege(r.role_name, c.oid, p.operation) AS table_granted,
       CASE WHEN p.operation IN ('SELECT', 'INSERT', 'UPDATE')
         THEN has_any_column_privilege(r.role_name, c.oid, p.operation)
         ELSE false END AS any_column_granted,
       EXISTS (
         SELECT 1 FROM pg_policies pol
         WHERE pol.schemaname = n.nspname AND pol.tablename = c.relname
           AND (r.role_name::name = ANY(pol.roles) OR 'public'::name = ANY(pol.roles))
           AND (pol.cmd = p.operation OR pol.cmd = 'ALL')
       ) AS applicable_policy
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(operation)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname, r.role_name, p.operation;

-- Serial/default-nextval sequences need their own privileges. Identity
-- columns have different semantics; verify inserts as the intended role.
SELECT n.nspname AS schema_name, c.relname AS sequence_name, r.role_name,
       has_sequence_privilege(r.role_name, c.oid, 'USAGE') AS usage_granted,
       has_sequence_privilege(r.role_name, c.oid, 'SELECT') AS select_granted,
       has_sequence_privilege(r.role_name, c.oid, 'UPDATE') AS update_granted
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname, r.role_name;
