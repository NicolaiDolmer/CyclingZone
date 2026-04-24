-- Enable three parallel board plans per team (5yr, 3yr, 1yr run simultaneously)

-- 1. Drop existing UNIQUE constraint on board_profiles.team_id
ALTER TABLE board_profiles DROP CONSTRAINT board_profiles_team_id_key;

-- 2. Add UNIQUE(team_id, plan_type) — one row per plan type per team
ALTER TABLE board_profiles
  ADD CONSTRAINT board_profiles_team_id_plan_type_key UNIQUE (team_id, plan_type);

-- 3. Drop old per-team-per-season request log unique index
DROP INDEX IF EXISTS idx_board_request_log_team_season_unique;

-- 4. Add per-board-per-season index — one request per plan per season
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_board_season_unique
  ON board_request_log(board_id, season_number)
  WHERE season_number IS NOT NULL;
