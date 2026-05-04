-- S-04 Admin annullér auktion.
-- Tilføjer felter til at tracke admin-cancellation + ny notification type så bidders
-- og sælger får en eksplicit "auction_cancelled"-notifikation (frem for at genbruge
-- auction_lost, som finalizer allerede bruger til andre afslutningsårsager).
--
-- Bemærk: 'cancelled' er allerede i auctions_status_check (verificeret 2026-05-04).
-- Bud ligger som rene rækker i auction_bids — der er ingen fysisk balance-reservation
-- at refundere ved cancel; reservationen beregnes ved query-time på basis af aktive
-- auktioner som teamet leder. Ergo er cancel = sæt status='cancelled' + notificér.
--
-- Idempotent: ALTER TABLE ... ADD COLUMN IF NOT EXISTS, og constraint genskabes.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID REFERENCES users(id);

-- Udvid notifications_type_check med 'auction_cancelled'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'bid_received', 'bid_placed', 'auction_won', 'auction_lost', 'auction_outbid',
    'auction_cancelled',
    'transfer_offer_received', 'transfer_offer_accepted', 'transfer_offer_rejected',
    'transfer_counter', 'transfer_offer_withdrawn', 'transfer_interest',
    'new_race', 'race_results_imported',
    'season_started', 'season_ended',
    'board_update',
    'salary_paid', 'sponsor_paid',
    'watchlist_rider_listed',
    'loan_created', 'emergency_loan', 'loan_paid_off',
    'deadline_day_warning'
  ])
);
