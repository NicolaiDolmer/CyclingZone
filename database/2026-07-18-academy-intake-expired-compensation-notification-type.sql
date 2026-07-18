-- #2648: 'academy_intake_expired_compensation' mangler i notifications_type_check.
--
-- Ny notifikation når en intake-udløbs-ungdomsauktion afsluttes MED salg: den
-- manager hvis intake-tilbud udløb ("mistede rytteren", #2627) krediteres
-- salgssummen (kompensation for inaktivitet, ejer-beslutning 18/7) og får en
-- in-app-notifikation om det. Uden denne migration fejler notifyUser's INSERT
-- med Postgres 23514 (samme klasse fejl som #2158/#2524).
--
-- ⚠️ Migration auto-applies i prod ved merge — Claude applier selv EFTER merge
--    (idempotent + post-verify, #2642-mandat).
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT (re-run = no-op).
-- Listen herunder er 1:1 den LIVE prod-constraint (verificeret read-only
-- 2026-07-18 via Supabase MCP) + den nye type tilføjet til sidst, så ingen
-- tidligere-tilføjede type (fx 'stage_result', 'watchlist_departed',
-- 'admin_notice') utilsigtet fjernes af denne DROP+ADD.
--
-- Rollback: gen-deklarér constraint'et uden 'academy_intake_expired_compensation'.
--   (Eksisterende rækker af den type vil blokere rollback — slet dem først.)

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
  'academy_intake_expired_compensation'
));

COMMIT;
