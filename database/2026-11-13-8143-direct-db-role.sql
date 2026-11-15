-- #8143 trin 1 · Postgres-rolle cz_direct til serverens direkte linje (backend/lib/directDb.ts).
--
-- Samme opskrift som overvågnings-rollen cz_monitor (#6994,
-- 2026-10-20-6994-cz-monitor-role.sql): egen rolle, ikke administrator, loft på
-- forbindelser, egne tidsgrænser og kun de rettigheder, trinnet bruger.
--
-- TRIN 1 = KUN MÅLEPRØVEN. Prøven stiller `SELECT 1` på den direkte linje, og det
-- kræver ingen rettigheder ud over at logge ind. Rollen får derfor INGEN tabel-,
-- sekvens- eller funktions-rettigheder, intet medlemskab af andre roller og ingen
-- adgang til spillertabeller. Hver senere flytning (Træn nu, aftenkørslen ...) får
-- sin egen migration med præcis de rettigheder, den vej bruger, dømt af dommeren.
--
-- INGEN adgangskode her. Rollen oprettes med PASSWORD NULL, så den kan IKKE logge
-- ind, før ejeren sætter en adgangskode ét sted (PR-teksten til #8143 og
-- docs/AI_OPS_REFERENCE.md: psql \password cz_direct, værdien gemmes i Infisical og
-- hos serverens udbyder som DIRECT_DB_URL). En gen-kørsel rører ikke en sat
-- adgangskode.
--
-- Tidsgrænser på rollen (gælder også, hvis koden glemmer sine egne):
--   statement_timeout 15 s, lock_timeout 3 s, idle_in_transaction_session_timeout 10 s.
-- Koden sætter de samme grænser pr. handel med set_config(..., true), så de også
-- gælder, når fordeleren senere deler forbindelser mellem flere handler.
-- default_transaction_read_only = on i trin 1 er et ekstra værn (en klient kan
-- selv slå det fra; rettighederne er den egentlige grænse). Det løftes i den
-- migration, der giver den første skrive-vej.
--
-- Additiv + idempotent: CREATE ROLE kun hvis rollen mangler; ALTER ROLE sætter
-- samme tilstand hver gang. Til sidst en verify-blok, der fejler migrationen
-- (rollback), hvis rollen kan noget, den ikke må. Køres efter merge (#2642).
--
-- POST-VERIFY (read-only):
--   SELECT rolname, rolcanlogin, rolconnlimit, rolsuper, rolbypassrls, rolinherit
--   FROM pg_roles WHERE rolname = 'cz_direct';           -- t, 10, f, f, f
-- Rollback: DROP ROLE cz_direct;  (ingen data hænger på rollen)

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cz_direct') THEN
    CREATE ROLE cz_direct WITH LOGIN PASSWORD NULL;
  END IF;
END
$$;

-- Attributter håndhæves hver gang. NOINHERIT: rollen arver intet. SUPERUSER,
-- REPLICATION og BYPASSRLS kan kun en superuser ændre; de står til NO fra
-- CREATE ROLE, og verify-blokken fejler, hvis nogen af dem er sat.
ALTER ROLE cz_direct WITH
  LOGIN NOINHERIT NOCREATEDB NOCREATEROLE
  CONNECTION LIMIT 10;

ALTER ROLE cz_direct SET statement_timeout = '15s';
ALTER ROLE cz_direct SET lock_timeout = '3s';
ALTER ROLE cz_direct SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE cz_direct SET default_transaction_read_only = on;

-- temp_file_limit: superuser-indstilling. Sættes hvis udbyderen tillader det,
-- ellers springes den over med en NOTICE (samme valg som #6994).
DO $$
BEGIN
  EXECUTE 'ALTER ROLE cz_direct SET temp_file_limit = ''256MB''';
EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value OR cant_change_runtime_param THEN
  RAISE NOTICE '#8143: temp_file_limit kunne ikke sættes på cz_direct (%); resten af rollen er uændret', SQLERRM;
END
$$;

COMMENT ON ROLE cz_direct IS
  '#8143: serverens direkte linje (backend/lib/directDb.ts). Trin 1: kun måleprøven (SELECT 1), ingen tabel- eller funktionsrettigheder. Adgangskode sættes kun af ejeren (Infisical + serverens udbyder, DIRECT_DB_URL).';

-- Verify: fejl hårdt, hvis rollen kan noget, den ikke må i trin 1.
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
             THEN has_table_privilege('cz_direct', c.oid,
                    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             ELSE false END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#8143: cz_direct har tabel-rettigheder, den ikke må have i trin 1: %', v_bad;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND CASE WHEN c.relkind = 'S'
             THEN has_sequence_privilege('cz_direct', c.oid, 'USAGE, SELECT, UPDATE')
             ELSE false END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#8143: cz_direct har sekvens-rettigheder, den ikke må have: %', v_bad;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'extensions')
    AND p.prosecdef
    AND has_function_privilege('cz_direct', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#8143: cz_direct kan køre SECURITY DEFINER-funktioner: %', v_bad;
  END IF;

  IF has_schema_privilege('cz_direct', 'public', 'CREATE')
     OR has_schema_privilege('cz_direct', 'extensions', 'CREATE')
     OR has_database_privilege('cz_direct', current_database(), 'CREATE') THEN
    RAISE EXCEPTION '#8143: cz_direct har CREATE-rettighed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles r
    WHERE r.rolname IN ('pg_read_all_data', 'pg_write_all_data', 'postgres',
                        'service_role', 'authenticated', 'anon', 'authenticator',
                        'pg_signal_backend', 'supabase_admin',
                        'pg_read_all_stats', 'pg_monitor', 'pg_read_all_settings', 'pg_stat_scan_tables')
      AND pg_has_role('cz_direct', r.oid, 'MEMBER')
  ) THEN
    RAISE EXCEPTION '#8143: cz_direct er medlem af en rolle med data-, signal- eller statistik-rettigheder';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cz_direct'
             AND (rolsuper OR rolreplication OR rolbypassrls OR rolinherit OR rolcreatedb OR rolcreaterole
                  OR rolconnlimit <> 10)) THEN
    RAISE EXCEPTION '#8143: cz_direct har en rolle-attribut, den ikke må have (eller forkert forbindelsesloft)';
  END IF;

  IF (SELECT count(*)
      FROM pg_db_role_setting s
      CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
      WHERE s.setrole = 'cz_direct'::regrole
        AND s.setdatabase = 0
        AND cfg IN ('statement_timeout=15s', 'lock_timeout=3s',
                    'idle_in_transaction_session_timeout=10s', 'default_transaction_read_only=on')) <> 4 THEN
    RAISE EXCEPTION '#8143: cz_direct mangler sine egne tidsgrænser eller read-only-standarden';
  END IF;
END
$$;

COMMIT;
