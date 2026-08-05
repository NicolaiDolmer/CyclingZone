-- #3334 (nosyara. Discord-sag 4/8): chefscout-skift omskrev en spillers
-- scoutingrapport uden forklaring — hun troede rytteren blev dårligere og
-- ændrede hans træning for at "rette" et fald der aldrig skete i rytteren.
--
-- Tilføjer 'scout_changed' — afsendt fra facilityService.hireStaff() når en
-- spiller ANSÆTTER en ny scouting-staff EFTER at have fyret en tidligere (et
-- reelt skifte, ikke holdets første nogensinde ansatte spejder). Beskeden
-- forklarer at eksisterende scoutingrapporter genberegnes med den nye scouts
-- præcision, og at rytternes faktiske evner er uændrede.
--
-- Idempotent: DROP IF EXISTS + ADD i én transaktion. Ikke-destruktiv (udvider
-- kun den eksisterende liste). Efterfølger 2026-08-04-welcome-notification-
-- type.sql (kanonisk forgænger — se dens MERGE-NOTE for hvorfor den filnavn-
-- rækkefølge findes).
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger på DENNE fil).
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
    'scout_changed'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint) og bekræft at "scout_changed"
-- indgår i listen af tilladte typer.
