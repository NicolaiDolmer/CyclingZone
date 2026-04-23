CREATE TABLE IF NOT EXISTS board_request_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES board_profiles(id) ON DELETE CASCADE,
  season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
  season_number INTEGER,
  request_type TEXT NOT NULL CHECK (
    request_type IN (
      'lower_results_pressure',
      'more_youth_focus',
      'more_results_focus',
      'ease_identity_requirements'
    )
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'partial', 'rejected', 'tradeoff')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tradeoff_summary TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}',
  board_changes JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_team_season_unique
  ON board_request_log(team_id, season_number)
  WHERE season_number IS NOT NULL;
