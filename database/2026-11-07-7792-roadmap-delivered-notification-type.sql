-- #7792: tilfoejer roadmap_delivered, indbakke-beskeden en manager faar naar et
-- roadmap-punkt, han stemte hoejt paa, er leveret. Sendt fra
-- backend/lib/roadmapDeliveredNotify.js, hoejst een gang pr. manager pr. punkt.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger paa DENNE fil, forgaenger var
-- 2026-09-21-4759-assistant-filled-squad-notification-type.sql).
--
-- Applies post-merge under #2642-rammerne (idempotent, ikke-destruktiv).


begin;
set local lock_timeout = '5s';

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
    'discord_welcome',
    'beta_access_decided',
    'assistant_filled_squad',
    'roadmap_delivered'
  ]::text[]));

commit;

-- Post-verify (koer efter apply): slaa notifications_type_check op via
-- pg_get_constraintdef (conrelid = public.notifications) og bekraeft at
-- roadmap_delivered indgaar, og at listen har 60 typer i alt.
