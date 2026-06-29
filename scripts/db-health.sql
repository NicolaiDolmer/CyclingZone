-- db-health.sql — disk-IO / performance helbredstjek.
--
-- Kontrakt: returnerer ÉN række pr. tærskel-brud. TOM output = sund DB.
-- Kolonner: severity | check | detail  (pipe-separeret af workflowen).
-- Kørt ugentligt af .github/workflows/db-health.yml; ikke-tomt output → GitHub-issue.
--
-- Baggrund: 2026-06-29 advarede Supabase om opbrugt Disk IO Budget. Årsagen var
-- IKKE reads (100% cache-hit, 91 MB DB) men WRITES: temp-file-spills fra en
-- kartesisk view-eksplosion (~1.5 GB/kald) + last_seen write-amplification.
-- Disse checks fanger gentagelser af det mønster tidligt.
--
-- Forudsætter pg_stat_statements (altid til stede på Supabase). Intern støj
-- (Studio-introspection / query-performance-rapporter) ekskluderes via query-regex.

-- 1. Queries der spiller meget temp til disk PR. KALD (fan-out/sort uden index).
--    Dette er det mønster der drænede budgettet. >50 MB/kald = undersøg.
SELECT 'WARN' AS severity,
       'high_temp_per_call' AS check,
       left(regexp_replace(query, '\s+', ' ', 'g'), 100)
         || ' — ' || pg_size_pretty((temp_blks_written * 8192) / calls)
         || '/kald × ' || calls || ' kald' AS detail
FROM pg_stat_statements
WHERE calls > 0
  AND (temp_blks_written * 8192) / calls > 50 * 1024 * 1024
  AND query !~* '(pg_stat_statements|pg_proc|information_schema|pg_catalog|pg_class|pg_attribute|pg_namespace)'

UNION ALL

-- 2. Lav cache-hit-ratio — reads rammer disk i stedet for RAM.
SELECT 'WARN',
       'low_cache_hit',
       'cache hit ' || round(blks_hit * 100.0 / NULLIF(blks_hit + blks_read, 0), 2)
         || '% (mål > 99%)'
FROM pg_stat_database
WHERE datname = current_database()
  AND blks_hit + blks_read > 100000
  AND blks_hit * 100.0 / NULLIF(blks_hit + blks_read, 0) < 99

UNION ALL

-- 3. Langsomme, hyppige queries (>1s snit) — bruger disk/CPU ineffektivt.
SELECT 'INFO',
       'slow_frequent_query',
       left(regexp_replace(query, '\s+', ' ', 'g'), 100)
         || ' — ' || round(mean_exec_time) || 'ms snit × ' || calls || ' kald'
FROM pg_stat_statements
WHERE calls > 50
  AND mean_exec_time > 1000
  AND query !~* '(pg_stat_statements|pg_proc|information_schema|pg_catalog)'

UNION ALL

-- 4. Bloat / vacuum-kandidater — dead tuples tvinger flere disk-pages.
SELECT 'INFO',
       'vacuum_candidate',
       schemaname || '.' || relname || ' — ' || n_dead_tup || ' dead / '
         || n_live_tup || ' live ('
         || round(n_dead_tup * 100.0 / NULLIF(n_live_tup, 0)) || '%)'
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
  AND n_dead_tup > 0.2 * NULLIF(n_live_tup, 0)

ORDER BY 1, 2;
