-- #2158 · fix(notifications): 'race_result' mangler i notifications_type_check.
--
-- Problem (verificeret 2026-07-04 mod prod):
--   Den in-app "dit løb er kørt"-notifikation (#1952) forsøger at oprette en
--   notifikation med type = 'race_result' for hver deltagende menneske-manager
--   (emitRaceResultNotifications, backend/lib/notificationService.js:262). Den
--   værdi var ALDRIG i notifications_type_check → hvert insert fejlede med
--   Postgres 23514, fejlen sluges tavst (catch { failed++ }), og prod-loggen
--   spammes med et burst pr. løb-afvikling (fx 89 brud på 4 min 04-07 10:09–10:13
--   da et helt startfelt fik notifikationen droppet). Featuren har aldrig virket.
--
-- Fix: additiv gen-deklaration af constraint'et med de 37 nuværende typer + de 3
--   der allerede kørte i prod men manglede i database/schema.sql (contract_expiring,
--   academy_promoted, academy_demoted — schema.sql-drift) + de to typer koden
--   dispatcher men som aldrig blev tilladt:
--     • 'race_result'          (#1952, "dit løb er kørt" — burst pr. løb)
--     • 'emergency_loan_breach' (loanEngine.js:458, når nødlån rammer gældsloftet
--        og lønnen er delvist udækket — fundet af den nye forward-guard, #1464)
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--    Verificér FØRST mod en disposabel Supabase-branch.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT (re-run = no-op).
--
-- Rollback: gen-deklarér constraint'et uden 'race_result'.
--   (Bemærk: eksisterende 'race_result'-rækker vil blokere rollback — slet dem
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
  'academy_promoted','academy_demoted'
));

COMMIT;
