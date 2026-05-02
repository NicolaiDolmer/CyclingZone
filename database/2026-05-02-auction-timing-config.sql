-- Auction timing configuration (single-row config table)
-- Active windows: weekdays 16:00-22:00, weekends 08:00-23:00
-- Dead hours outside active windows do NOT count toward auction duration

CREATE TABLE IF NOT EXISTS auction_timing_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  duration_hours INTEGER NOT NULL DEFAULT 6,
  weekday_open_hour INTEGER NOT NULL DEFAULT 16,
  weekday_close_hour INTEGER NOT NULL DEFAULT 22,
  weekend_open_hour INTEGER NOT NULL DEFAULT 8,
  weekend_close_hour INTEGER NOT NULL DEFAULT 23,
  extension_minutes INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO auction_timing_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
