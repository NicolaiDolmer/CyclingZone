-- S-03 Trupstørrelse-håndhævelse ved vinduesluk (v2.29)
--
-- Når transfer_windows.status sættes til 'closed', fyrer cron én gang
-- enforceTeamSquadCompliance pr. human-team. Idempotency via window-level claim
-- på squad_enforcement_completed_at (samme mønster som final_whistle_sent_at).
--
-- Penalty-fradrag holdes adskilt fra total_points (som overskrives ved hver
-- updateStandings-recompute fra race_results) så fradraget er stabilt og
-- auditerbart. Ranking i updateStandings bruger effective = total - penalty.

-- 1. acquired_at på riders — backfill med created_at som rimeligt udgangspunkt.
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS acquired_at TIMESTAMPTZ DEFAULT NOW();
UPDATE riders SET acquired_at = COALESCE(acquired_at, created_at, NOW())
  WHERE acquired_at IS NULL;

-- 2. Atomic claim-felt på transfer_windows (samme mønster som final_whistle_sent_at).
ALTER TABLE transfer_windows
  ADD COLUMN IF NOT EXISTS squad_enforcement_completed_at TIMESTAMPTZ;

-- 3. Penalty-points på season_standings — ikke rørt af updateStandings upsert.
ALTER TABLE season_standings
  ADD COLUMN IF NOT EXISTS penalty_points BIGINT NOT NULL DEFAULT 0;

-- 4. Finance-types for auto-køb/salg + bøde.
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine'
));

-- 5. Notification-type for håndhævelses-rapport til ramt manager.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','salary_paid','sponsor_paid',
  'watchlist_rider_listed','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced'
));
