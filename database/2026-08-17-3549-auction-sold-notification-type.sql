-- #3549: tilføjer 'auction_sold' — sælgerens besked når en auktion afsluttes
-- ("Auktion afsluttet" / "Rytter solgt til AI") var hidtil forkert delt type
-- ("auction_won") med købers "Du vandt auktionen!"-besked. Når sælger og
-- effektiv køber er SAMME hold (jf. #194-bid-reglen i routes/api.js: et hold
-- må byde på egen auktion når rytteren imens har en anden faktisk ejer — AI/
-- free-agent-gensalg), ramte begge notifyTeamOwner-kald samme modtager med
-- "auction_won" → to næsten identiske notifikationer (samme symptom som
-- #1693, lukket 22/6). Rodårsagsfix: auctionFinalization.js skipper nu
-- sælger-beskeden når modtageren er den samme som køberen, OG sælger-beskeden
-- har fået sin egen type her som forward-guard, så de to aldrig igen kan
-- kollidere på type alene.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger på DENNE fil — opdateret fra
-- 2026-08-05-3398-maiden-win-notification-type.sql, kanonisk forgænger).
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
    'career_milestone',
    'auction_sold'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint) og bekræft at "auction_sold"
-- indgår i listen af tilladte typer.
