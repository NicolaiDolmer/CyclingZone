-- #6994 · Postgres-rolle cz_monitor til den daglige SQL-helbredstjek-workflow
-- (.github/workflows/prod-health-sql.yml + scripts/ops/prodHealthSql.mjs).
--
-- Rollen må KUN læse statistik: pg_stat_activity (alle sessioner),
-- extensions.pg_stat_statements (tal, aldrig query-tekst i output),
-- størrelsesfunktioner og pg_statio_user_tables. Den har ingen rettigheder på
-- data i public/auth/storage og ingen skrive-rettigheder nogen steder.
--
-- Sikkerhedsgrænsen er RETTIGHEDERNE (ingen tabel-/sekvens-/funktions-grants,
-- intet medlemskab af pg_read_all_data eller app-rollerne). Rollens
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
-- kørsel af filen). INHERIT er nødvendig for at arve pg_read_all_stats.
ALTER ROLE cz_monitor WITH
  LOGIN INHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 3;

-- Sessions-standarder: kun læsning, korte lofter, så et tjek aldrig kan holde
-- låse eller en forbindelse fast.
ALTER ROLE cz_monitor SET default_transaction_read_only = on;
ALTER ROLE cz_monitor SET statement_timeout = '5s';
ALTER ROLE cz_monitor SET lock_timeout = '1s';
ALTER ROLE cz_monitor SET idle_in_transaction_session_timeout = '15s';

-- pg_read_all_stats (ikke hele pg_monitor): nok til at se alle sessioner i
-- pg_stat_activity, pg_stat_statements for alle roller og pg_database_size.
-- pg_monitor ville også give pg_stat_scan_tables (funktioner der tager låse)
-- og pg_read_all_settings, som tjekkene ikke bruger.
GRANT pg_read_all_stats TO cz_monitor;

-- extensions-skemaet: PUBLIC har ikke USAGE, men pg_stat_statements-viewene
-- har SELECT til PUBLIC (udvidelsens standard). USAGE alene giver ingen data.
GRANT USAGE ON SCHEMA extensions TO cz_monitor;

COMMENT ON ROLE cz_monitor IS
  '#6994: kun læsning af statistik til prod-health-sql.yml. Ingen data-rettigheder, read-only som standard. Password sættes kun af ejeren (Infisical + GitHub-secret CZ_MONITOR_DATABASE_URL).';

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

  IF NOT pg_has_role('cz_monitor', 'pg_read_all_stats', 'USAGE') THEN
    RAISE EXCEPTION '#6994: cz_monitor arver ikke pg_read_all_stats';
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
