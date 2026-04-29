-- Keep DB check constraints aligned with runtime finance/notification writes.

ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','salary_paid','sponsor_paid',
  'watchlist_rider_listed','loan_created','emergency_loan','loan_paid_off'
));
