-- #3398 (Maiden Win Engine): tilføjer 'career_milestone' — afsendt fra
-- backend/lib/careerFirsts.js når en manager-ejet rytter rammer en career-first
-- (maiden win/første podie/første klassifikationstrøje) eller holdet rammer en
-- klub-milepæl (25./50./75. sejr i klubfarver osv.). ÉN notifikationstype
-- dækker alle fire event_type-varianter (samme "isFirst-copy-variant på samme
-- type"-mønster som race_result/firstRaceResult, notificationService.js) —
-- title/message differentierer, ikke type.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger på DENNE fil — opdateret fra
-- 2026-08-05-3334-scout-changed-notification-type.sql, kanonisk forgænger).
--
-- Applies post-merge under #2642-rammerne (idempotent, ikke-destruktiv →
-- ikke ejer-gated).

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
    'squad_below_minimum',
    'selection_warning',
    'welcome',
    'scout_changed',
    'career_milestone'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint) og bekræft at "career_milestone"
-- indgår i listen af tilladte typer.
