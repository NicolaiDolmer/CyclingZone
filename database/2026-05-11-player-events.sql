-- Player-events baseline (#137) — game-specific events + feature-impressions.
-- Bruges til engagement-måling og som Detector E i feature-liveness-audit
-- ("deployed feature med 0 impressions sidste N dage" — generalisering af
-- slice 14 / #279 root-cause til frontend-only features hvor Detector A
-- ikke kan se nogen backend-insert).
--
-- RLS: manager kan kun læse + indsætte egne events (auth.uid() = team.user_id).
-- Service-role bypasser RLS for aggregation og Detector E.
--
-- event_data jsonb er fri-form per event — schemas dokumenteres i
-- frontend/src/lib/logEvent.js som single source of truth.

CREATE TABLE IF NOT EXISTS player_events (
  id BIGSERIAL PRIMARY KEY,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS player_events_event_name_created_at_idx
  ON player_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS player_events_team_id_created_at_idx
  ON player_events (team_id, created_at DESC);

ALTER TABLE player_events ENABLE ROW LEVEL SECURITY;

-- DROP-then-CREATE-pattern så auto-migrate er idempotent efter manual apply
-- (feedback_create_policy_idempotent fra 2026-05-09).

DROP POLICY IF EXISTS "Managers can insert own events" ON player_events;
CREATE POLICY "Managers can insert own events"
  ON player_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Managers can read own events" ON player_events;
CREATE POLICY "Managers can read own events"
  ON player_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE player_events IS
  'Game-events + feature-impressions per spiller. Backwards-audit Detector E queryer denne for at finde features med 0 impressions over en periode. Manager ser kun egne rows; service_role kan querye alle.';

COMMENT ON COLUMN player_events.event_name IS
  'snake_case event-navn. Konvention: feature_<feature>_<action> for impressions, <object>_<verb> for game-events. Master-liste: frontend/src/lib/logEvent.js KNOWN_EVENTS.';

COMMENT ON COLUMN player_events.event_data IS
  'Fri-form context per event (rider_id, auction_id, division, etc.). Hold under 2KB pr. row.';
