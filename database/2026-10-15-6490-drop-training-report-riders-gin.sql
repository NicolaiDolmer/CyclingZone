-- =============================================================================
-- #6490 · Fjern det ubrugte GIN-indeks idx_training_day_runs_report_riders
-- =============================================================================
-- EJER-GATED (destruktivt, AGENTS hard rule 9): merges og applies kun på ejerens
-- ordrette go til A på #6490 (givet 15/10). Merge når som helst uden for
-- 19:30-21:00 (aftenafregningen), fordi auto-migrate kører filen lige efter merge.
-- Testet lokalt på PG17 15/10 (database/manual/2026-10-15-6490-local-pg17-test.sh):
-- under 0,3 s med 200 samtidige skrivninger, idempotent, rollback gyldig, vagten stopper.
--
-- Hvorfor (målt read-only 15/10, spec docs/superpowers/specs/
-- 2026-10-15-training-10x-jobqueue-direct-pg-design.md):
--   - 1.033 MiB og vokser ca. 54 MB/døgn; seneste scan 12/10 18:38 (før #6538).
--   - Ingen læser: #6538 flyttede "er rytteren nogensinde trænet?" til
--     rider_training_seen. pg_proc 15/10: kun commit_training_date_tick (læser
--     sin egen parameter p_report) og rider_training_seen_sources (udpakker
--     report->'riders' række for række, kan ikke bruge et GIN-indeks) nævner
--     report->'riders'; ingen containment (@>) mod tabellen.
--   - Koster stadig: GIN pending-list-flush giver 8-9 afregninger pr. aften på
--     25-50 s (max 55 s mod service_role statement_timeout 60 s); ca. 20 GB
--     indeksblokke læst fra disk siden 11/10 alene til vedligehold.
--
-- Rollback: database/manual/2026-10-15-6490-recreate-training-report-riders-gin.sql
-- (CREATE INDEX CONCURRENTLY med den gemte definition; ingen data tabes).
--
-- CONCURRENTLY kan ikke køre i en transaktion; auto-migrate kører hver fil i
-- sin egen `psql -f` (samme mønster som 2026-10-05-6184-race-results-latest-indexes.sql).
-- =============================================================================

SET statement_timeout = '20min';
SET lock_timeout = '10s';

-- Vagt: stop hvis en funktion er kommet til, der bruger containment mod
-- tabellens report->'riders' (så ville den falde til seq scan over TOAST).
DO $$
DECLARE
  users text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO users
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* $re$training_day_runs$re$
    AND p.prosrc ~* $re$report\s*->\s*'riders'[^;]*@>$re$;
  IF users IS NOT NULL THEN
    RAISE EXCEPTION '#6490: funktion(er) bruger containment på report->riders: %. Drop ikke indekset.', users;
  END IF;
END $$;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_training_day_runs_report_riders;

-- Post-verify (Claude kører efter apply, #2642):
--   SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_training_day_runs_report_riders';  -- forventet 0
--   Mål de to næste aftener mod baseline-tabellen i specen: kald > 2 s (mål 0), WAL pr. kald.
