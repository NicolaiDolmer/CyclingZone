-- Optional AI-facing read-only views.
-- Run manually in Supabase SQL editor after review.
-- These views are intentionally small and are safe to query during Codex inspections.

CREATE OR REPLACE VIEW public.ai_active_season_status AS
SELECT
  s.id AS season_id,
  s.number AS season_number,
  s.status,
  s.race_days_total,
  s.race_days_completed,
  COUNT(DISTINCT r.id) AS race_count,
  COUNT(DISTINCT rr.id) AS race_result_count,
  COUNT(DISTINCT ss.id) AS standings_count,
  COUNT(DISTINCT ft.id) FILTER (WHERE ft.type = 'prize') AS prize_transaction_count
FROM public.seasons s
LEFT JOIN public.races r ON r.season_id = s.id
LEFT JOIN public.race_results rr ON rr.race_id = r.id
LEFT JOIN public.season_standings ss ON ss.season_id = s.id
LEFT JOIN public.finance_transactions ft ON ft.season_id = s.id
WHERE s.status = 'active'
GROUP BY s.id, s.number, s.status, s.race_days_total, s.race_days_completed;

CREATE OR REPLACE VIEW public.ai_recent_import_health AS
SELECT
  id,
  import_type,
  rows_processed,
  rows_updated,
  rows_inserted,
  jsonb_array_length(COALESCE(errors, '[]'::jsonb)) AS error_count,
  created_at
FROM public.import_log
ORDER BY created_at DESC
LIMIT 25;

CREATE OR REPLACE VIEW public.ai_race_import_blockers AS
SELECT
  il.id AS import_log_id,
  il.created_at,
  il.rows_processed,
  il.rows_updated,
  il.rows_inserted,
  CASE
    WHEN il.rows_processed > 0 AND il.rows_inserted = 0 THEN 'processed_rows_but_inserted_zero'
    WHEN jsonb_array_length(COALESCE(il.errors, '[]'::jsonb)) > 0 THEN 'import_errors_present'
    ELSE 'ok'
  END AS status,
  COALESCE(il.errors, '[]'::jsonb) AS errors
FROM public.import_log il
WHERE il.import_type = 'race_results_sheets'
ORDER BY il.created_at DESC
LIMIT 10;
