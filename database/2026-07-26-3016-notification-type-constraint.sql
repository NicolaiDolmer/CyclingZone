-- #3016: notifications_type_check manglede typer som koden allerede bruger.
-- 3. gentagelse af "ny notifikationstype uden constraint-migration"
-- (jf. learnings 2026-07-04 + 2026-06-25). Tilføjer:
--   scout_report_ready       (#2945 — fejlede i prod siden 25/7, CYCLINGZONE-3F)
--   contract_expired_release (#2744 — fyres inde i sæsonskiftet)
-- season_transition_risk tilføjes IKKE: koden bruger contract_expiring efter PR #3026.
-- Idempotent: DROP IF EXISTS + ADD i én transaktion. Ikke-destruktiv (udvider kun).
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES — hold listerne i sync.

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
    'contract_expired_release'
  ]::text[]));

commit;
