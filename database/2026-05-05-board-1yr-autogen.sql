-- S-02b · 1yr-auto-gen + identity-feeding + auto-accept
-- Master roadmap: docs/slices/02-board-redesign-MASTER.md
--
-- Tilføjer:
--   1. teams.season_1_identity_basis JSONB — frosset snapshot af hvilken identitet
--      bestyrelsen "så" ved sæson-1-slut. Computes i startSequentialNegotiation
--      og bruges til 5yr-mål-weighting + identity-feeding-badge + auto-accept-default-focus.
--   2. notifications_type_check udvidet med 'board_critical' — Q-batch 1C Q21:
--      tier-styret notif-routing. T-1 race_day → 'Skal handles', auto-accept-events.
--
-- Q-bekræftelser (2026-05-05 session):
--   A=b — én JSONB-kolonne på teams (én sandhedslocation, ikke per-board-row)
--   B=b — auto-accept default-focus afledes fra identity_basis.primary_specialization
--   C   — T-3 ved race_days_completed=2 (board_update), T-1 ved =4 (board_critical),
--          auto-accept ved ≥5

BEGIN;

-- 1. teams.season_1_identity_basis — frosset sæson-1-snapshot
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS season_1_identity_basis JSONB DEFAULT NULL;

COMMENT ON COLUMN teams.season_1_identity_basis IS
  'Frosset identity-snapshot fra sæson-1-slut (S-02b). Indeholder dominant_nationality, youth_share, primary_specialization, rider_count og national_core. Bruges til identity-feeding-badge på 5yr-mål, weighting i mål-forslag, og default-focus ved auto-accept.';

-- 2. Udvid notifications_type_check med board_critical
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced'
));

COMMIT;
