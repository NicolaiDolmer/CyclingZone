-- #4759 (roadbook-loefte, opfoelger til #4201): tilfoejer 'assistant_filled_squad'
-- — indbakke-beskeden manageren faar naar assistenten udtog en HELT tom trup
-- for hans hold (sen redning ved etape 1, eller late_fill/opt_in-sweepen).
-- Sendt fra backend/lib/assistantFilledSquadNotification.js, praecis EEN gang
-- pr. (hold, loeb) — aldrig naar manageren selv havde en udtagelse inde.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger paa DENNE fil — opdateret fra
-- 2026-09-18-5259-beta-access-notification-type.sql, kanonisk forgaenger).
--
-- Applies post-merge under #2642-rammerne (idempotent, ikke-destruktiv →
-- ikke ejer-gated). Koerer intet mod prod fra denne PR.

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
    'discord_welcome',
    'beta_access_decided',
    'assistant_filled_squad'
  ]::text[]));

commit;

-- Post-verify (koer efter apply): slaa notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint, conrelid = public.notifications) og
-- bekraeft at "assistant_filled_squad" indgaar i listen af tilladte typer, og
-- at listen har 59 typer i alt.
