-- #3043: notifications_type_check manglede squad_below_minimum, den nye type
-- backend/lib/squadBelowMinimumCheck.js bruger (sæsonskifte-fase der detekterer
-- + varsler hold under MIN_RIDERS_FOR_RACE efter kontraktudløb+pension).
-- Efterfølger 2026-07-26-3016-notification-type-constraint.sql (4. gentagelse
-- af "ny notifikationstype uden constraint-migration", jf. learnings 2026-07-04
-- + 2026-06-25). Idempotent: DROP IF EXISTS + ADD i én transaktion.
-- Ikke-destruktiv (udvider kun den eksisterende liste med ét element).
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES — hold listerne i sync.
--
-- IKKE KØRT — foreslået SQL, jf. denne sessions no-mutation-mandat (#3043-
-- dispatch-instruks). Apply post-merge under #2642-rammerne (idempotent,
-- ikke-destruktiv → ikke ejer-gated).

begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type = any (array[
    'bid_received',
    'bid_placed',
    'auction_won',
    'auction_lost',
    'auction_outbid',
    'auction_proxy_outbid',
    'transfer_offer_received',
    'transfer_offer_accepted',
    'transfer_offer_rejected',
    'transfer_counter',
    'transfer_offer_withdrawn',
    'transfer_interest',
    'new_race',
    'race_results_imported',
    'race_result',
    'season_started',
    'season_ended',
    'board_update',
    'board_critical',
    'salary_paid',
    'sponsor_paid',
    'watchlist_rider_listed',
    'watchlist_rider_auction',
    'loan_created',
    'emergency_loan',
    'emergency_loan_breach',
    'loan_paid_off',
    'deadline_day_warning',
    'auction_cancelled',
    'squad_enforced',
    'rider_retired',
    'academy_intake_ready',
    'academy_signed',
    'academy_rejected',
    'academy_graduation_ready',
    'academy_graduated',
    'contract_expiring',
    'academy_promoted',
    'academy_demoted',
    'watchlist_departed',
    'admin_notice',
    'stage_result',
    'academy_intake_expired_compensation',
    'academy_drip',
    'scout_report_ready',
    'contract_expired_release',
    'squad_below_minimum'
  ]::text[]));

commit;
