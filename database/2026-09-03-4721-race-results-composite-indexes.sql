-- =============================================================================
-- 2026-09-03 · #4721 - sammensatte indeks mod statement-timeouts på race_results
-- =============================================================================
-- SYMPTOM: Supabase-logaudit 3/9 fandt 4 x "canceling statement due to
-- statement timeout" fra PostgREST mod race_results (1.264.179 rækker,
-- 353 MB tabel / 774 MB total m. indeks, målt 3/9 read-only via Supabase MCP).
-- Relateret til #4590 (spiller-rapport: "dashboard is also more slow" efter
-- infra-opdateringen 1/9).
--
-- ── Rodårsag: tre høj-trafik forespørgsler har KUN et enkelt-kolonne-index at
-- filtrere på, og skal derfor sortere separat efter (Bitmap Heap Scan +
-- eksplicit Sort-node) — dyrt ved 1,26 mio. rækker, og for de to
-- IN/ANY-formede forespørgsler bliver det VÆRRE ved dybere OFFSET-paginering
-- (fetchAllRows' .range()-loop), fordi Postgres skal top-N-heapsorte et
-- voksende vindue for hver side. Målt read-only mod prod 3/9 (pg_stat_statements
-- + EXPLAIN ANALYZE, ingen data/skema ændret):
--
--   1) WHERE team_id = $1 ORDER BY id
--      TeamResultsTab.jsx (frontend/src/components/TeamResultsTab.jsx) — hvert
--      holds resultat-fane. SAMME formet forespørgsel som backend's
--      defaultFetchFirstTimeManagers (lib/notificationService.js, WHERE
--      team_id = ANY($1) — composite-indexet dækker begge, IN-formen bruger
--      blot indekset for hver værdi). Reelt prods TUNGESTE race_results-
--      forespørgsel lige nu (pg_stat_statements 3/9): 345 kald, mean 179,6 ms,
--      MAX 6.993 ms — tæt på authenticator-rollens 8s statement_timeout
--      (samme rolle-mekanik som #4507 dokumenterede) — og notificationService-
--      formen: 349 kald, mean 175,8 ms, max 1.835 ms. Kun idx_race_results_
--      team_id (team_id alene) findes i dag:
--
--        Limit (actual time=13.782..13.949 rows=1000)
--          -> Sort (actual time=13.780..13.854 rows=1000) Sort Key: id
--               Sort Method: top-N heapsort  Memory: 265kB
--               -> Bitmap Heap Scan on race_results (rows=5625)
--                    -> Bitmap Index Scan on idx_race_results_team_id
--
--   2) WHERE race_id = ANY($1) ORDER BY rank, id
--      RaceHistoryPage.jsx (frontend/src/pages/RaceHistoryPage.jsx) — en
--      tilbagevendende løbstype kan sagtens akkumulere 1000+ rækker på tværs
--      af sæsoner (#3331). Kun idx_race_results (race_id alene) findes i dag.
--      Målt for Ronde van Vlaams-Brabant (24 udgaver, 24 race_id'er): 29.931
--      matchende rækker, 88 ms for FØRSTE 1000-siden alene — Bitmap Heap Scan
--      + Sort, samme mønster som (1):
--
--        Limit (actual time=87.699..87.892 rows=1000)
--          -> Sort (actual time=87.697..87.796 rows=1000) Sort Key: rank, id
--               Sort Method: top-N heapsort  Memory: 297kB
--               -> Bitmap Heap Scan on race_results (rows=29931)
--                    -> Bitmap Index Scan on idx_race_results
--
--   3) WHERE race_id = ANY($1) AND rank = $2 ORDER BY id
--      backend/routes/api.js:11867 (/api/dashboard-recent-results — kaldes af
--      DashboardPage.jsx, #4590s "dashboard is also more slow"-klage) OG samme
--      form dækker (2)'s rank-lighed. 73 kald, mean 46,5 ms, max 298,7 ms
--      (pg_stat_statements 3/9) — mindre akut end (1)/(2), men SAMME
--      manglende-composite-mønster og direkte relevant for #4590.
--
--      (race_id, rank, id) dækker BÅDE (2)'s "ORDER BY rank, id" og (3)'s
--      "rank = $2 ORDER BY id" i ét index — rank optræder som ligheds- ELLER
--      range-betingelse i begge, og id følger som ren sorteringskolonne
--      efter rank i begge tilfælde.
--
--   4) WHERE race_id = $1 AND stage_number = $2 ORDER BY id
--      RaceDetailPage.jsx's fetchStageResultRows (frontend/src/pages/
--      RaceDetailPage.jsx, RACE_RESULT_SELECT — vælger unikt netop rank,
--      result_type, points_earned OG prize_money blandt de undersøgte
--      forespørgsler). Kører på HVER etape-visning — appens højst-trafikerede
--      enkelt-forespørgsel mod race_results. Målt mod den tungeste etape i
--      prod (899 rækker): allerede rimelig (7,5 ms) via det eksisterende
--      race_results_entrant_unique-index ((race_id, stage_number, result_type,
--      entrant_key) — dækker FILTERET men ikke SORTERINGEN, så der er stadig
--      en Sort-node pr. kald:
--
--        Sort (actual time=7.250..7.355 rows=847) Sort Key: id
--          -> Index Scan using race_results_entrant_unique (rows=847)
--
--      Ikke tæt på timeout i dag, men høj nok kaldfrekvens (hver eneste
--      etape-side) til at det er værd at fjerne Sort-noden helt, og samme
--      "manglende sidste sorteringskolonne i indekset"-mønster som (1)/(2) —
--      #4507s note om ~83k nye rækker/uge betyder denne kun bliver dyrere.
--
-- ── Fix ────────────────────────────────────────────────────────────────────
-- Tre nye dækkende, sammensatte indeks — samme mønster som #4507s
-- idx_race_results_rank_dupe_check (kolonnerne i FILTER/ORDER-rækkefølge, id
-- sidst som stabil sorterings-tiebreaker):
--
--   idx_race_results_team_id_id      (team_id, id)
--   idx_race_results_race_id_rank_id (race_id, rank, id)
--   idx_race_results_race_id_stage_id(race_id, stage_number, id)
--
-- IKKE fjernet: idx_race_results_team_id og idx_race_results (enkelt-kolonne)
-- overlappes nu delvist af de nye composite-indeks (samme leftmost-præfiks),
-- men dropning er en SEPARAT, mere risikabel beslutning (skriveoverhead vs.
-- læsefordel på et 1,26 mio.-rækkers/353 MB-write-tungt bord) og hører til
-- ejerens go, ikke denne fil — se PR-beskrivelsen.
--
-- IKKE gjort her (bevidst, se PR-beskrivelsen): de tre forespørgsler burde
-- overveje ægte keyset-paginering (WHERE id > $last) i stedet for
-- fetchAllRows' OFFSET-baserede .range()-loop for RIGTIG store resultatsæt —
-- det er en applikations-ændring, ikke en index-fix, og et separat issue.
--
-- IDEMPOTENT: CREATE INDEX CONCURRENTLY IF NOT EXISTS + selvhelbredende guard
-- (samme mønster som #4507/#4010) for hvert af de tre indeks. Kan køres igen
-- uden effekt. CONCURRENTLY kører UDEN for transaktion — auto-migrate kører
-- filen via psql -f i autocommit (samme forudsætning som #4507).
--
-- APPLY: IKKE af denne PR. Claude applier selv post-merge under #2642-rammen
-- (idempotent + post-verify, ejer-mandat 18/7) — se PR-beskrivelsen for
-- post-verify-kommandoerne.
--
-- ROLLBACK:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_team_id_id;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_race_id_rank_id;
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_race_results_race_id_stage_id;
--
-- Refs #4721 #4590 #4507 #3331
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_race_results_team_id_id' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_team_id_id';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_team_id_id
  ON public.race_results USING btree (team_id, id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_race_results_race_id_rank_id' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_race_id_rank_id';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_race_id_rank_id
  ON public.race_results USING btree (race_id, rank, id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'idx_race_results_race_id_stage_id' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_race_id_stage_id';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_race_id_stage_id
  ON public.race_results USING btree (race_id, stage_number, id);

-- =============================================================================
-- Post-verify (kør efter apply)
-- =============================================================================
-- 1) Alle tre indeks findes og er gyldige:
--
--   SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid)) AS size
--   FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE c.relname IN ('idx_race_results_team_id_id', 'idx_race_results_race_id_rank_id', 'idx_race_results_race_id_stage_id');
--   -- forventet: 3 rækker, indisvalid = true for alle
--
-- 2) team_id-forespørgslen bruger nu indekset UDEN separat Sort:
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM public.race_results WHERE team_id = '<en rigtig team_id>' ORDER BY id LIMIT 1000;
--   -- forventet: Index Scan (ikke Bitmap Heap Scan) using idx_race_results_team_id_id, ingen Sort-node
--
-- 3) race_id+rank-forespørgslen bruger nu indekset UDEN separat Sort:
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM public.race_results WHERE race_id = ANY(ARRAY['<race_id 1>','<race_id 2>']::uuid[]) ORDER BY rank, id LIMIT 1000;
--   -- forventet: Index Scan using idx_race_results_race_id_rank_id, ingen Sort-node
--
-- 4) race_id+stage_number-forespørgslen bruger nu indekset UDEN separat Sort:
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM public.race_results WHERE race_id = '<race_id>' AND stage_number = <n> ORDER BY id;
--   -- forventet: Index Scan using idx_race_results_race_id_stage_id, ingen Sort-node
--
-- 5) Ingen nye "canceling statement due to statement timeout"-linjer i
--    Supabase-logs for race_results i dagene efter apply.
-- =============================================================================
