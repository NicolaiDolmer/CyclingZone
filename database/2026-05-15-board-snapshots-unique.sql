-- Issue #30 follow-up · Forhindrer dublet-snapshots for samme (board, season).
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md
--
-- Bug (cybersimon, 2026-05-04): SeasonSnapshotGrid kunne vise to raekker for
-- "Saeson 1" hvis processSeasonEnd-cron blev koert mere end en gang for samme
-- saeson, fordi board_plan_snapshots manglede unique constraint paa
-- (board_id, season_id). Det forvirrede managere der saa modstridende
-- tilfredshed-deltas for hvad der skulle vaere en saeson-evaluering.
--
-- Fix (3 lag):
--   1. Dedup eksisterende rows: behold seneste (created_at DESC) pr.
--      (board_id, season_id) — det matcher hvad upsert ville producere
--      ved en re-run.
--   2. Tilfoej unique constraint saa DB haandhaever invariantet fremover.
--   3. Insert-site i economyEngine.processSeasonEnd skifter til upsert
--      med onConflict: "board_id,season_id" (separat code-aendring).

BEGIN;

-- 1. Dedup: behold seneste row pr. (board_id, season_id)
DELETE FROM board_plan_snapshots
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY board_id, season_id
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM board_plan_snapshots
  ) ranked
  WHERE rn > 1
);

-- 2. Haandhaev en snapshot pr. (board, season)
ALTER TABLE board_plan_snapshots
  ADD CONSTRAINT board_plan_snapshots_board_season_unique
  UNIQUE (board_id, season_id);

COMMIT;
