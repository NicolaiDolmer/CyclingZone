-- #6994 · ops_monitor.long_sessions: kun klient-sessioner.
-- Første kørsel af prod-health-sql (21/10) gav et falsk fund: Supabase
-- Realtimes logiske replikationsforbindelse (backend_type walsender,
-- START_REPLICATION) er "active" hele tiden med vilje og talte som en lang
-- query. Funktionen filtrerer nu på backend_type = 'client backend'
-- (walsender, autovacuum, bgworkers m.fl. er ikke klient-queries).
-- Kun WHERE-klausulen er ændret; SECURITY DEFINER, ejer postgres,
-- search_path og EXECUTE-grants er som i 2026-10-20-6994-cz-monitor-role.sql.
-- Idempotent: CREATE OR REPLACE + samme REVOKE/GRANT hver gang.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION ops_monitor.long_sessions()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT COALESCE(pg_catalog.json_agg(t), '[]'::pg_catalog.json) FROM (
    SELECT a.pid, a.usename AS role, a.state,
      pg_catalog.round(EXTRACT(epoch FROM pg_catalog.now() - a.query_start))::pg_catalog.int8 AS query_age_s,
      pg_catalog.round(EXTRACT(epoch FROM pg_catalog.now() - a.xact_start))::pg_catalog.int8 AS transaction_age_s,
      a.wait_event_type, a.wait_event,
      pg_catalog.pg_blocking_pids(a.pid) AS blocking_pids
    FROM pg_catalog.pg_stat_activity a
    WHERE a.datname = pg_catalog.current_database()
      AND a.backend_type = 'client backend'
      AND a.pid <> pg_catalog.pg_backend_pid()
      AND (
        (a.state = 'active' AND pg_catalog.now() - a.query_start > '30 seconds'::pg_catalog.interval)
        OR (a.state LIKE 'idle in transaction%' AND pg_catalog.now() - a.xact_start > '30 seconds'::pg_catalog.interval)
        OR pg_catalog.cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
      )
    ORDER BY a.query_start
    LIMIT 20
  ) t
$fn$;

REVOKE ALL ON FUNCTION ops_monitor.long_sessions() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops_monitor.long_sessions() TO cz_monitor;

-- Verify: samme krav som originalen (fem funktioner, kun cz_monitor,
-- SECURITY DEFINER, ejer postgres, search_path) + filteret er på plads.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'ops_monitor'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('service_role', p.oid, 'EXECUTE')
         OR has_function_privilege('public', p.oid, 'EXECUTE')
         OR p.proname NOT IN ('connection_pressure', 'long_sessions', 'statement_stats', 'capacity', 'cache_hit'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#6994: ops_monitor har funktioner med for bred EXECUTE eller ukendte funktioner: %', v_bad;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'ops_monitor'
    AND (NOT p.prosecdef
         OR p.proowner <> 'postgres'::regrole
         OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#6994: ops_monitor-funktion uden SECURITY DEFINER/ejer postgres/search_path=pg_catalog, pg_temp: %', v_bad;
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'ops_monitor' AND has_function_privilege('cz_monitor', p.oid, 'EXECUTE')) <> 5 THEN
    RAISE EXCEPTION '#6994: cz_monitor kan ikke køre alle fem ops_monitor-funktioner';
  END IF;

  IF pg_get_functiondef('ops_monitor.long_sessions()'::regprocedure) NOT LIKE '%backend_type = ''client backend''%' THEN
    RAISE EXCEPTION '#6994: long_sessions mangler backend_type-filteret';
  END IF;
END
$$;

COMMIT;
