-- Market pause kill switch (#178 polish-sprint admin safety)
-- Three-level state: 'none' (normal) | 'auctions' (auctions frozen) | 'all' (whole market frozen)
-- When paused, calculated_end on active/extended auctions is shifted forward by elapsed pause-duration on resume,
-- so bidders get the same remaining time they had when pause began.

ALTER TABLE auction_timing_config
  ADD COLUMN IF NOT EXISTS market_pause_level TEXT NOT NULL DEFAULT 'none'
    CHECK (market_pause_level IN ('none', 'auctions', 'all')),
  ADD COLUMN IF NOT EXISTS market_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS market_paused_reason TEXT;
