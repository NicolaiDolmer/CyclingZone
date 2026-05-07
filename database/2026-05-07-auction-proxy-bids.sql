-- Proxy-bidding: auto-by med max-loft (#10).
-- Manager sætter et max-loft; systemet counter-byder automatisk i +10%-trin
-- op til loftet når andre byder. Stopper når max er nået eller manager vinder.
--
-- auction_proxy_bids: gemmer max-loft per manager per auktion.
--   UNIQUE(auction_id, team_id) — én aktiv proxy per manager per auktion.
--   DELETE CASCADE ved auktion-sletning (sjælden men eksisterer ved reset).
--
-- auction_bids.is_proxy: markerer auto-placerede proxy-bud i historik/UI.
--
-- 'auction_proxy_outbid' notif-type sendes til manager når proxy-loft er
-- overskredet og auto-by ikke kan følge med mere.

CREATE TABLE IF NOT EXISTS auction_proxy_bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  max_amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(auction_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_proxy_bids_auction ON auction_proxy_bids(auction_id);

ALTER TABLE auction_bids
  ADD COLUMN IF NOT EXISTS is_proxy BOOLEAN NOT NULL DEFAULT FALSE;

-- Udvid notifications_type_check med 'auction_proxy_outbid'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced'
));
