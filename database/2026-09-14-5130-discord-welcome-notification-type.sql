-- #5130 (ejer-direktiv 10/9): tilføjer 'discord_welcome' — notifikation i
-- indbakken der inviterer nye managere til Discord-communityet. Sendt fra
-- backend/lib/discordWelcomeSweep.js (runDiscordWelcomeSweep), når holdet
-- har rundet løbs-klar-tærsklen (MIN_RIDERS_FOR_RACE) eller senest 24t efter
-- oprettelse. Dedupe pr. hold via teams.discord_welcome_sent_at (se
-- 2026-09-14-5130-discord-welcome-sent-at.sql).
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne
-- fil mod NOTIFICATION_TYPES (MIGRATION_PATH peger på DENNE fil — opdateret
-- fra 2026-09-08-3200-dm-notification-type.sql, kanonisk forgænger).
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
    'auction_sold',
    'market_value_level_correction',
    'forum_thread_reply',
    'forum_mention',
    'dm_message',
    'discord_welcome'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint, conrelid = public.notifications) og
-- bekræft at "discord_welcome" indgår i listen af tilladte typer, og at
-- listen har 57 typer i alt.
