-- Deadline Day: lukketidspunkt på transfervinduer + global override-flag

ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;

ALTER TABLE auction_timing_config
  ADD COLUMN IF NOT EXISTS deadline_day_override TEXT NOT NULL DEFAULT 'auto'
    CHECK (deadline_day_override IN ('auto', 'on', 'off'));
