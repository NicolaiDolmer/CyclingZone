-- Discord DM-outbox (#1115): varig levering af person-rettede DMs.
-- Når en DM fejler med en retryable fejl (429 fra Railways delte egress-IP,
-- Discord 5xx, netværk) gemmes den her i stedet for at blive droppet.
-- En cron (hvert 5. minut) retryer med eksponentiel backoff (~27h horisont);
-- derefter markeres rækken 'dead' og der alarmeres via webhook + Sentry.

CREATE TABLE IF NOT EXISTS discord_dm_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id      text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
  attempts        integer NOT NULL DEFAULT 1,
  next_attempt_at timestamptz NOT NULL,
  last_status     integer,
  last_error      text,
  dead_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Drain-query: WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at
CREATE INDEX IF NOT EXISTS discord_dm_outbox_drain_idx
  ON discord_dm_outbox (next_attempt_at)
  WHERE status = 'pending';

-- Kun service_role (backend) rører tabellen: RLS enabled uden policies
-- blokerer anon/authenticated helt. service_role bypasser RLS.
ALTER TABLE discord_dm_outbox ENABLE ROW LEVEL SECURITY;
