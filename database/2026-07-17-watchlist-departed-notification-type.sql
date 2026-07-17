-- #2524 · fix(watchlist): 'watchlist_departed' mangler i notifications_type_check.
--
-- Problem (verificeret 2026-07-17): rider_watchlist har INGEN FK-cascade til
-- riders (bevidst — en managers ønskeliste er en ren brugerfacing bekvemmelighed,
-- ikke en spil-invariant). Når en rytter slettes (usolgt ungdomsauktion #2456,
-- AI-hold-trim/relaunch-wipe), forsvandt han derfor TAVST fra enhver managers
-- ønskeliste — frontend filtrerer det orphaned join væk (WatchlistPage.jsx,
-- #1918) uden nogen forklaring. Spillere måtte have det forklaret manuelt på
-- Discord efter #2456-oprydningen.
--
-- Fix (#2524): notifyAndClearWatchlistForRiders (backend/lib/notificationService.js)
-- er nu kaldt fra ALLE kendte rytter-sletnings-stier (auctionFinalization.
-- deleteUnsoldYouthRider, aiTeamGenerator.deleteAiTeamById/removeAiTeams/
-- clearAllAiTeams) og indsætter en 'watchlist_departed'-notifikation FØR den
-- rydder rider_watchlist-rækken. Den type var aldrig i CHECK-constraint'et —
-- uden denne migration ville hvert insert fejle med Postgres 23514 og blive
-- talt som `failed` (isoleret, men stille for spilleren — samme klasse fejl
-- som #2158 race_result).
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--    Verificér FØRST mod en disposabel Supabase-branch.
--
-- NB (2026-07-17, main-merge): #2560 (2026-07-17-notifications-stage-result-
-- type.sql) blev merged og APPLIED mod prod imens denne PR var åben — dens
-- 'stage_result'-type er derfor allerede live i notifications_type_check
-- (verificeret mod prod: pg_get_constraintdef viser 'admin_notice' +
-- 'stage_result' begge live, 'watchlist_departed' mangler stadig). Denne
-- migrations DROP+ADD gen-erklærer HELE listen, så både 'stage_result' OG
-- 'admin_notice' (#2229, tidligere live type) listes eksplicit her OVENPÅ
-- 2026-07-17-notifications-stage-result-type.sql for ikke at fjerne dem ved
-- en fremtidig apply.
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT (re-run = no-op).
--
-- Rollback: gen-deklarér constraint'et uden 'watchlist_departed'.
--   (Bemærk: eksisterende 'watchlist_departed'-rækker vil blokere rollback —
--    slet dem først hvis en rollback nogensinde bliver nødvendig.)

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
  'admin_notice','stage_result'
));

COMMIT;
