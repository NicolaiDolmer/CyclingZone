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
--
-- #3205 (2026-08-03): pg_stat_statements-rækker akkumulerer FOR ALTID (indtil
-- ekstensionen resettes eller Postgres genstarter) — der findes ingen
-- "sidst kaldt"-kolonne, kun cumulative tællere siden stats_since. En
-- ét-gangs manuel diagnose-query eller en superseded funktion, der ikke
-- kaldes igen, bliver derfor en PERMANENT falsk positiv. To specifikke,
-- verificerede tilfælde er ekskluderet nedenfor (se
-- database/2026-08-03-db-io-3205-diagnose.md for fuld diagnose) — begge
-- er navngivne undtagelser, IKKE en generel "ingen nylig aktivitet"-svækkelse
-- af tjekket (ville have maskeret selve 2026-06-29-hændelsen, som ikke gik
-- via RPC/pgrst-wrapperen).

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
  -- #3205: én-gangs manuel forensik-query fra rider-double-booking-auditen
  -- (2026-07-28, #3113/#3185) — 1 kald, 283 MB temp (kartesisk join uden
  -- filtrering på formål, kørt direkte mod prod til engangs-optælling).
  -- Erstattet af backend/lib/riderDoubleBookingWatch.js (paginerede,
  -- lette JS-queries, ingen temp-spill). Kaldes aldrig igen fra kode —
  -- ekskluderet på en unik streng fra selve queryen, IKKE et bredt mønster,
  -- så et NYT tungt forensik-kald stadig ville trigge WARN.
  AND query !~* 'violating_pairs'

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
  -- #3205: public.refresh_ranking_matviews() — den ORIGINALE 4-i-1-transaktion,
  -- bevaret som bagudkompatibel rollback-fallback af #3013-migrationen
  -- (database/2026-07-27-3013-refresh-matviews-concurrently.sql), men IKKE
  -- kaldt af nogen kodesti siden splitten deployede 2026-07-28 08:38 (verificeret:
  -- ingen `.rpc("refresh_ranking_matviews")` i backend, kun de fire granulære
  -- refresh_*_mv()). Rækkens 238 kald/1164ms-snit stammer ALLE fra FØR splitten
  -- (stats_since 2026-07-26) og vokser aldrig igen — en fastfrosset historisk
  -- rest der ellers ville støje ugentligt for evigt. De fire nye funktioner,
  -- der rent faktisk kaldes nu (945 kald hver, senest verificeret 2026-08-03),
  -- ligger alle under 1000ms-grænsen (21-678ms snit) og rammer IKKE dette tjek.
  AND query !~* 'refresh_ranking_matviews'

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
