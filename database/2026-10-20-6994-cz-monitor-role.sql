-- #6994 · Postgres-rolle cz_monitor til den daglige SQL-helbredstjek-workflow
-- (.github/workflows/prod-health-sql.yml + scripts/ops/prodHealthSql.mjs).
--
-- Rollen kan KUN kalde fem funktioner i skemaet ops_monitor, som returnerer
-- de tal tjekkene bruger (Codex-fund, PR #6996). Den er IKKE medlem af
-- pg_read_all_stats/pg_monitor, så en lækket nøgle kan ikke læse andre
-- sessioners query-tekst i pg_stat_activity eller pg_stat_statements.
-- Funktionerne er SECURITY DEFINER (ejer postgres, som har pg_monitor) med
-- search_path = pg_catalog, pg_temp og skema-kvalificerede typer. pg_temp SKAL
-- stå eksplicit sidst: med search_path = '' søges kalderens temp-skema FØRST for
-- typer og relationer, og rollen har TEMP via PUBLIC, så en lækket nøgle kunne
-- skygge fx text med et domæne, hvis CHECK kører som postgres (opus-review,
-- PR #6996). De returnerer aldrig query-tekst, kun pid, rollenavn,
-- state, alder, wait events, queryid, tal og tabelnavne. EXECUTE er fjernet
-- fra PUBLIC/anon/authenticated/service_role; skemaet er ikke eksponeret i
-- Data API'et.
--
-- Sikkerhedsgrænsen er RETTIGHEDERNE (ingen tabel-/sekvens-grants, ingen
-- andre funktioner end de fem, intet medlemskab af statistik-, data- eller
-- app-roller). Rollens
-- default_transaction_read_only = on er et ekstra værn: en klient kan selv slå
-- det fra med SET, så det må aldrig være den eneste beskyttelse.
-- Målt i prod 20/10 (katalog, ingen data): PUBLIC har 0 tabel-grants i public,
-- 0 SECURITY DEFINER-funktioner i public/extensions som PUBLIC kan køre, og
-- PUBLIC har ikke USAGE på extensions/auth/storage/vault.
-- Kendt rest-risiko (Codex-fund på PR #6996): databasens ACL giver TEMP til
-- PUBLIC (=Tc/postgres), og Postgres har ingen per-rolle-undtagelse fra
-- PUBLIC. cz_monitor kan derfor oprette midlertidige tabeller i sin egen
-- session (ingen adgang til andre data). Fjernes det, skal TEMP fjernes fra
-- PUBLIC for hele databasen, hvilket også rammer anon/authenticated/
-- service_role og Supabase' egne roller; det er en separat ejer-beslutning og
-- ikke en del af denne migration. Værnene mod en lækket nøgle er nøglen selv
-- (kun Infisical + GitHub-secret), CONNECTION LIMIT 3 og korte timeouts.
--
-- INGEN password her. Rollen oprettes med PASSWORD NULL, så den kan ikke logge
-- ind, før ejeren sætter et password ét sted (se PR-body til #6994:
-- psql \password cz_monitor, værdien gemmes i Infisical og som GitHub-secret
-- CZ_MONITOR_DATABASE_URL). En gen-kørsel rører ikke et sat password.
--
-- Additiv + idempotent: CREATE ROLE kun hvis rollen mangler; ALTER ROLE og
-- GRANT sætter samme tilstand hver gang. Til sidst et verify-blok, der fejler
-- migrationen (rollback), hvis rollen har fået nogen rettighed den ikke må have.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cz_monitor') THEN
    CREATE ROLE cz_monitor WITH LOGIN PASSWORD NULL;
  END IF;
END
$$;

-- Attributter håndhæves hver gang (en manuel ændring rulles tilbage ved næste
-- kørsel af filen). NOINHERIT: rollen skal ikke arve noget som helst.
-- SUPERUSER/REPLICATION/BYPASSRLS må kun en superuser ændre (også til NO), og
-- Supabases postgres er ikke superuser (auto-migrate 20/10: "permission denied
-- to alter role"). De står til NO fra CREATE ROLE, og verify-blokken fejler,
-- hvis nogen af dem er sat.
ALTER ROLE cz_monitor WITH
  LOGIN NOINHERIT NOCREATEDB NOCREATEROLE
  CONNECTION LIMIT 3;

-- Sessions-standarder: kun læsning, korte lofter, så et tjek aldrig kan holde
-- låse eller en forbindelse fast.
ALTER ROLE cz_monitor SET default_transaction_read_only = on;
ALTER ROLE cz_monitor SET statement_timeout = '5s';
ALTER ROLE cz_monitor SET lock_timeout = '1s';
ALTER ROLE cz_monitor SET idle_in_transaction_session_timeout = '15s';

-- temp_file_limit (ejer-valg A, 20/10): loft over sorterings-/hash-temp-filer
-- pr. session, så en lækket nøgle ikke kan fylde disken med tunge queries.
-- Det er en superuser-indstilling (pg_settings.context = 'superuser'), som
-- cz_monitor derfor ikke selv kan hæve. Supabase tillader det kun, hvis
-- supautils giver postgres lov; ellers springes den over med en NOTICE i
-- stedet for at fælde migrationen. Dækker IKKE midlertidige tabeller.
DO $$
BEGIN
  EXECUTE 'ALTER ROLE cz_monitor SET temp_file_limit = ''256MB''';
EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value OR cant_change_runtime_param THEN
  RAISE NOTICE '#6994: temp_file_limit kunne ikke sættes på cz_monitor (%); resten af rollen er uændret', SQLERRM;
END
$$;

-- Ingen brede statistik-roller. Der REVOKE'es ikke her: postgres har ikke
-- ADMIN på pg_read_all_stats (målt 20/10), så REVOKE ville fælde migrationen
-- (PG16+). Rollen har aldrig fået dem; verify-blokken fejler, hvis den har.

-- Snævert interface: skema ops_monitor, kun USAGE til cz_monitor.
CREATE SCHEMA IF NOT EXISTS ops_monitor AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA ops_monitor FROM PUBLIC;
GRANT USAGE ON SCHEMA ops_monitor TO cz_monitor;
COMMENT ON SCHEMA ops_monitor IS
  '#6994: statistik-funktioner til cz_monitor (prod-health-sql). Ingen data, ingen query-tekst. Ikke eksponeret i Data API.';

-- Supabase detection checks: forbindelsestryk.
CREATE OR REPLACE FUNCTION ops_monitor.connection_pressure()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT pg_catalog.row_to_json(t) FROM (
    SELECT
      count(*) FILTER (WHERE a.backend_type = 'client backend') AS client_connections,
      count(*) FILTER (WHERE a.backend_type = 'client backend' AND a.state = 'active') AS active_connections,
      pg_catalog.current_setting('max_connections')::pg_catalog.int4 AS max_connections
    FROM pg_catalog.pg_stat_activity a
  ) t
$fn$;

-- Lange sessioner, idle in transaction og blokerede sessioner. Ingen query-tekst.
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

-- pg_stat_statements: kun nøgle, kald og samlet tid; aldrig query-tekst.
CREATE OR REPLACE FUNCTION ops_monitor.statement_stats()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT pg_catalog.json_build_object(
    'observed_at', pg_catalog.now(),
    'info', (SELECT pg_catalog.row_to_json(i) FROM (
               SELECT si.stats_reset, si.dealloc FROM extensions.pg_stat_statements_info si) i),
    'rows', COALESCE((SELECT pg_catalog.json_agg(t) FROM (
      SELECT s.dbid, s.userid, pg_catalog.pg_get_userbyid(s.userid) AS role, s.queryid::pg_catalog.text AS queryid,
        s.toplevel, s.calls, s.total_exec_time, s.stats_since::pg_catalog.text AS statement_stats_since
      FROM extensions.pg_stat_statements s
      WHERE s.dbid = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database())
      ORDER BY s.total_exec_time DESC
      LIMIT 100) t), '[]'::pg_catalog.json))
$fn$;

-- Kapacitet: databasestørrelse, top-20 tabeller, forbindelser pr. rolle/state.
CREATE OR REPLACE FUNCTION ops_monitor.capacity()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT pg_catalog.json_build_object(
    'observed_at', pg_catalog.now(),
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'top_tables', COALESCE((SELECT pg_catalog.json_agg(t) FROM (
      SELECT st.schemaname, st.relname AS table_name, pg_catalog.pg_total_relation_size(st.relid) AS total_bytes
      FROM pg_catalog.pg_statio_user_tables st
      ORDER BY total_bytes DESC
      LIMIT 20) t), '[]'::pg_catalog.json),
    'connections_by_role', COALESCE((SELECT pg_catalog.json_agg(t) FROM (
      SELECT a.usename AS role, a.state, count(*) AS connections
      FROM pg_catalog.pg_stat_activity a
      WHERE a.datname = pg_catalog.current_database() AND a.backend_type = 'client backend'
      GROUP BY a.usename, a.state
      ORDER BY connections DESC
      LIMIT 100) t), '[]'::pg_catalog.json))
$fn$;

-- Cache-hit (kumulativ kontekst, ingen alarm).
CREATE OR REPLACE FUNCTION ops_monitor.cache_hit()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT pg_catalog.row_to_json(t) FROM (
    SELECT
      sum(st.heap_blks_hit) AS heap_hits,
      sum(st.heap_blks_read) AS heap_reads,
      pg_catalog.round(100.0 * sum(st.heap_blks_hit)
        / NULLIF(sum(st.heap_blks_hit) + sum(st.heap_blks_read), 0), 2) AS heap_hit_percent
    FROM pg_catalog.pg_statio_user_tables st
  ) t
$fn$;

-- Eksplicitte grants (statisk lint-bare): kun cz_monitor kan køre funktionerne.
REVOKE ALL ON FUNCTION ops_monitor.connection_pressure() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops_monitor.long_sessions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops_monitor.statement_stats() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops_monitor.capacity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops_monitor.cache_hit() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops_monitor.connection_pressure() TO cz_monitor;
GRANT EXECUTE ON FUNCTION ops_monitor.long_sessions() TO cz_monitor;
GRANT EXECUTE ON FUNCTION ops_monitor.statement_stats() TO cz_monitor;
GRANT EXECUTE ON FUNCTION ops_monitor.capacity() TO cz_monitor;
GRANT EXECUTE ON FUNCTION ops_monitor.cache_hit() TO cz_monitor;

COMMENT ON ROLE cz_monitor IS
  '#6994: kalder kun ops_monitor-funktionerne til prod-health-sql.yml. Ingen data- eller statistik-roller, read-only som standard. Password sættes kun af ejeren (Infisical + GitHub-secret CZ_MONITOR_DATABASE_URL).';

-- Verify: fejl hårdt hvis rollen kan noget den ikke må.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth', 'storage', 'vault', 'realtime', 'supabase_migrations')
    AND CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f')
             THEN has_table_privilege('cz_monitor', c.oid,
                    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             ELSE false END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#6994: cz_monitor har tabel-rettigheder den ikke må have: %', v_bad;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    -- CASE: planneren må ellers kalde has_sequence_privilege på ikke-sekvenser.
    AND CASE WHEN c.relkind = 'S'
             THEN has_sequence_privilege('cz_monitor', c.oid, 'USAGE, SELECT, UPDATE')
             ELSE false END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#6994: cz_monitor har sekvens-rettigheder den ikke må have: %', v_bad;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'extensions')
    AND p.prosecdef
    AND has_function_privilege('cz_monitor', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#6994: cz_monitor kan køre SECURITY DEFINER-funktioner: %', v_bad;
  END IF;

  IF has_schema_privilege('cz_monitor', 'public', 'CREATE')
     OR has_schema_privilege('cz_monitor', 'extensions', 'CREATE')
     OR has_database_privilege('cz_monitor', current_database(), 'CREATE') THEN
    RAISE EXCEPTION '#6994: cz_monitor har CREATE-rettighed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles r
    WHERE r.rolname IN ('pg_read_all_data', 'pg_write_all_data', 'postgres',
                        'service_role', 'authenticated', 'anon', 'authenticator',
                        'pg_signal_backend', 'supabase_admin')
      AND pg_has_role('cz_monitor', r.oid, 'MEMBER')
  ) THEN
    RAISE EXCEPTION '#6994: cz_monitor er medlem af en rolle med data- eller signal-rettigheder';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname IN ('pg_read_all_stats', 'pg_monitor', 'pg_read_all_settings', 'pg_stat_scan_tables')
      AND pg_has_role('cz_monitor', r.oid, 'MEMBER')
  ) THEN
    RAISE EXCEPTION '#6994: cz_monitor må ikke være medlem af en statistik-rolle (query-tekst)';
  END IF;

  -- ops_monitor: præcis de fem funktioner, kun cz_monitor (og ejeren) kan køre dem.
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

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cz_monitor'
             AND (rolsuper OR rolreplication OR rolbypassrls OR rolinherit OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION '#6994: cz_monitor har en rolle-attribut den ikke må have (superuser/replication/bypassrls/inherit/createdb/createrole)';
  END IF;

  IF has_schema_privilege('cz_monitor', 'ops_monitor', 'CREATE')
     OR has_schema_privilege('anon', 'ops_monitor', 'USAGE')
     OR has_schema_privilege('authenticated', 'ops_monitor', 'USAGE') THEN
    RAISE EXCEPTION '#6994: ops_monitor-skemaet har for brede rettigheder';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_db_role_setting s
    CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
    WHERE s.setrole = 'cz_monitor'::regrole
      AND s.setdatabase = 0
      AND cfg = 'default_transaction_read_only=on'
  ) THEN
    RAISE EXCEPTION '#6994: cz_monitor mangler default_transaction_read_only=on';
  END IF;
END
$$;

COMMIT;
