-- Deadline Day S4: Final Whistle-rapport + planlagte advarsler

-- Idempotent guard for at sikre at Final Whistle-rapporten kun sendes én gang per vindue.
ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS final_whistle_sent_at TIMESTAMPTZ;

-- Tilføj 'deadline_day_warning' til notifications.type CHECK constraint.
-- Kilde: backend/lib/notificationService.js (notifyTeamOwner) skriver denne type fra cron.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','salary_paid','sponsor_paid',
  'watchlist_rider_listed','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning'
));
