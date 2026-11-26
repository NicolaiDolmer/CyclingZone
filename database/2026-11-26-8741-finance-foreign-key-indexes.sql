-- Refs #8741. Two finance lookups with measured plan improvements.
-- Run using psql -f outside an explicit transaction.
SET lock_timeout = '30s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_transactions_race_id
  ON public.finance_transactions (race_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finance_transactions_season_id
  ON public.finance_transactions (season_id);

-- An interrupted concurrent build can leave an invalid index with the right
-- name. Do not record this migration as applied until both indexes are usable.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('idx_finance_transactions_race_id', 'race_id'),
      ('idx_finance_transactions_season_id', 'season_id')
    ) AS expected(index_name, column_name)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = 'public.finance_transactions'::regclass
     AND a.attname = expected.column_name
     AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_index i
      ON i.indexrelid = pg_catalog.to_regclass('public.' || expected.index_name)
    WHERE i.indisvalid IS NOT TRUE
       OR i.indisready IS NOT TRUE
       OR i.indrelid <> a.attrelid
       OR i.indnkeyatts <> 1
       OR i.indnatts <> 1
       OR i.indkey[0] IS DISTINCT FROM a.attnum
       OR i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Expected valid #8741 race_id and season_id indexes on public.finance_transactions';
  END IF;
END
$verify$;
