-- #2064 S0 · fix(notifications): 'academy_drip' mangler i notifications_type_check.
--
-- Problem (fundet af forward-guarden financeNotificationContract.test.js, #1464):
--   Søndags-drippen (backend/lib/sundayIntakeTick.js, #2064 S0) dispatcher en
--   in-app-notifikation med type = 'academy_drip' pr. hold der modtager nye
--   akademi-kandidater om søndagen. Uden denne migration ville HVERT insert
--   fejle med Postgres 23514 (CHECK-brud) og blive slugt tavst af notify-
--   wrapperens try/catch — akkurat den #2158-fælde 'race_result' ramte i prod.
--
-- Fix: additiv gen-deklaration af constraint'et med den fulde nuværende
--   type-liste (database/schema.sql) + den nye type:
--     • 'academy_drip' (sundayIntakeTick.js — "New academy talent has arrived")
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--    Verificér FØRST mod en disposabel Supabase-branch.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT (re-run = no-op).
--
-- Rollback: gen-deklarér constraint'et uden 'academy_drip'.
--   (Bemærk: eksisterende 'academy_drip'-rækker vil blokere rollback — slet dem
--    først hvis en rollback nogensinde bliver nødvendig.)

BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','race_result','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','emergency_loan_breach','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced','rider_retired',
  'academy_intake_ready','academy_signed','academy_rejected',
  'academy_graduation_ready','academy_graduated','contract_expiring',
  'academy_promoted','academy_demoted','watchlist_departed',
  'admin_notice','stage_result',
  'academy_intake_expired_compensation','academy_drip'
));

COMMIT;
