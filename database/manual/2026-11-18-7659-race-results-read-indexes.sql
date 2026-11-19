-- Manual only. PC1 runs this file after merge.
-- Refs #7659. Run with psql -f outside a transaction because both builds
-- are concurrent. Existing indexes remain available to other queries.
SET statement_timeout = '20min';

DO $$
DECLARE
  invalid_indexes text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO invalid_indexes
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('idx_race_results_team_type_rank', 'idx_race_results_prize_race_id_id')
    AND NOT i.indisvalid;

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid indexes from an interrupted build: %. Drop the invalid indexes concurrently before retrying.', invalid_indexes;
  END IF;
END $$;

-- Three board reads filter by team, classification and finishing position.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_team_type_rank
  ON public.race_results (team_id, result_type, rank)
  WHERE team_id IS NOT NULL;

-- Prize preview reads only positive amounts for a batch of races.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_race_results_prize_race_id_id
  ON public.race_results (race_id, id)
  INCLUDE (team_id, prize_money)
  WHERE prize_money > 0;

RESET statement_timeout;
