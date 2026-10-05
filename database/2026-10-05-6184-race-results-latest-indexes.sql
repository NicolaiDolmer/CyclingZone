-- =============================================================================
-- 2026-10-05 · #6184 - to "seneste raekke"-indeks paa race_results
-- =============================================================================
-- Fundet under #6184 (PostgREST-timeouts, maalt read-only 5/10 via Supabase
-- MCP: edge_logs + pg_stat_statements + EXPLAIN uden ANALYZE). race_results
-- har ca. 1,9 mio. raekker. To forespoergsler finder "den seneste raekke" og
-- har intet indeks der matcher filter + sortering, saa planneren gaar baglaens
-- gennem idx_race_results_imported_at (HELE tabellen) og filtrerer undervejs:
--
--   1) Dashboardets Hero & Agony-kort (frontend/src/hooks/useHeroAgonyMoment.js)
--        WHERE team_id = $1 AND result_type = 'stage'
--        ORDER BY imported_at DESC, id DESC LIMIT 1
--      Plan i dag: Index Scan Backward using idx_race_results_imported_at,
--      Filter: team_id + result_type. Et hold hvis seneste etape-resultat er
--      gammelt (eller som aldrig har kørt en etape) skanner hele tabellen og
--      rammer authenticated-rollens statement_timeout (8 s) -> HTTP 500.
--      Set i edge_logs 4-5/10: flere 500'ere med origin_time ~8 s.
--
--   2) Stall-vagten (backend/lib/stallWatchdog.js, hver 30. min) skal kun
--      bruge seneste imported_at pr. loeb. Den hentede ALLE raekker for op til
--      ~30 loeb sorteret paa id med offset-paginering; planen var en
--      Index Scan paa race_results_pkey over hele tabellen med join-filter.
--      Set i edge_logs: 30+ kald > 5 s, max 26 s, og en 500 ved 60 s.
--      Koden er samtidig skrevet om til et LIMIT 1-opslag pr. loeb, som
--      bruger indeks 2 nedenfor.
--
-- Begge indeks er additive (ingen data aendres). CONCURRENTLY, saa
-- skrivninger til race_results ikke blokeres mens de bygges. Filen maa derfor
-- IKKE pakkes i en transaktion (auto-migrate koerer `psql -f` uden BEGIN).
-- Et afbrudt CONCURRENTLY-byg efterlader et INVALID indeks; DO-blokken foran
-- hvert CREATE dropper det, saa en genkoersel bygger det paany (samme
-- moenster som 2026-09-03-4721-race-results-composite-indexes.sql).
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_team_stage_latest;
--           DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_race_id_imported_at;
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_race_results_team_stage_latest' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_team_stage_latest';
  END IF;
END $$;

-- Partielt (kun etape-raekker): matcher forespoergsel 1 praecist og er mindre
-- end et fuldt indeks.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_team_stage_latest
  ON public.race_results USING btree (team_id, imported_at DESC, id DESC)
  WHERE result_type = 'stage';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_race_results_race_id_imported_at' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_race_id_imported_at';
  END IF;
END $$;

-- NULLS LAST: imported_at er nullable, og stall-vagten beder om
-- `imported_at.desc.nullslast` (en NULL maa ikke skygge for et rigtigt
-- tidspunkt). Indeksets raekkefoelge skal matche, ellers bruges det ikke.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_race_id_imported_at
  ON public.race_results USING btree (race_id, imported_at DESC NULLS LAST);
