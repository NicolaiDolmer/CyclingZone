-- 2026-08-19 · #2677 (perf-pakke) — index på race_results(imported_at)
--
-- Evidens (pg_stat_statements, 19/8): to service_role-queries filtrerer/sorterer på
-- imported_at og seq-scanner ~1,03 mio. rækker (213 MB heap):
--   · result_type + imported_at-range: 1.689 kald, 304 ms gns. (max 1,28 s)
--   · imported_at DESC + season-join:  34 kald, 1,80 s gns. (max 2,96 s)
-- Supabase index-advisor estimerer ~85-87 % cost-reduktion med btree på imported_at.
-- #2188 (juli) afviste index-advisor-forslagene som lav-værdi "ved nuværende skala";
-- tabellen er siden vokset til 1 mio.+ rækker, så beslutningen er genåbnet med ny evidens.
--
-- OBS: CREATE INDEX CONCURRENTLY må IKKE køre i en transaktion — denne fil har derfor
-- bevidst ingen BEGIN/COMMIT (auto-migrate kører filen via psql -f i autocommit).
-- CONCURRENTLY valgt så resultatimport/læsninger ikke blokeres under bygningen.

-- Selvhelbredende guard: et afbrudt CONCURRENTLY-forsøg efterlader et INVALID index,
-- som IF NOT EXISTS ellers ville springe over ved re-run. Drop det først.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_race_results_imported_at'
      AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.idx_race_results_imported_at';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_imported_at
  ON public.race_results USING btree (imported_at);

ANALYZE public.race_results;

-- Post-verify (manuelt efter apply):
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'race_results' AND indexname = 'idx_race_results_imported_at';
--   -- forventet: 1 række, og pg_index.indisvalid = true
