-- Slice 4: Ønskeliste-alerts
-- Tilføjer watchlist_rider_listed notification type.
-- Tilføjer også transfer_offer_withdrawn som manglede i constraint.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','salary_paid','sponsor_paid',
  'watchlist_rider_listed'
));
