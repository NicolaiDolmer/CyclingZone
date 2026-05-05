-- S-02d · Udvidede mål-typer
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md
--
-- Tilføjer kolonner til board_plan_snapshots så u25_development_delta-målet
-- kan beregnes korrekt: gennemsnitlig stat-points-vækst pr. sæson på U25-ryttere.
--
-- Pattern matcher eksisterende cumulative_stage_wins/cumulative_gc_wins —
-- snapshottes pr. sæson i economyEngine.processSeasonEnd, og delta beregnes
-- som (current_avg − plan_start_avg) / seasons_completed.
--
-- Q-bekræftelser (2026-05-05 session, S-02d brief):
--   E1=column-add (ikke ny tabel), bevarer board_plan_snapshots som single
--   per-sæson-snapshot. Plan-start-værdien hentes fra første snapshot i planen.

BEGIN;

ALTER TABLE board_plan_snapshots
  ADD COLUMN IF NOT EXISTS u25_stat_sum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS u25_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN board_plan_snapshots.u25_stat_sum IS
  'S-02d: Sum af alle 12 stat-felter på alle U25-ryttere ved slutningen af sæsonen. Bruges af u25_development_delta-målet.';

COMMENT ON COLUMN board_plan_snapshots.u25_count IS
  'S-02d: Antal U25-ryttere på holdet ved slutningen af sæsonen. Bruges sammen med u25_stat_sum til at beregne gennemsnit.';

COMMIT;
