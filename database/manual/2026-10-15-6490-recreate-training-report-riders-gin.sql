-- Rollback for database/2026-10-15-6490-drop-training-report-riders-gin.sql (#6490).
-- Kør kun manuelt og kun hvis en læser viser sig at mangle indekset.
-- Definitionen er hentet fra prod pg_indexes 15/10. Byggetiden for ca. 1 GB GIN
-- er ikke målt; kør uden for 19:30-21:00. CONCURRENTLY kræver en session uden transaktion.
SET statement_timeout = '30min';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_training_day_runs_report_riders
  ON public.training_day_runs USING gin (((report -> 'riders'::text)) jsonb_path_ops);
