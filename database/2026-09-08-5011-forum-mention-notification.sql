-- #5011 (ejer-direktiv 3/9 i #4751, ejer-valg 8/9): tilfoejer 'forum_mention' —
-- notifikation naar en ANDEN manager @-tagger dig i et forum-opslag eller -svar.
-- Sendt fra backend/lib/notificationService.js (notifyForumMention /
-- notifyForumMentions), udloest af POST /api/forum/posts og
-- POST /api/forum/posts/:id/replies. Selve navne-udtraekket bor server-side i
-- backend/lib/forumMentions.js — klienten bestemmer aldrig hvem der tagges.
--
-- Regler: case-insensitivt match paa HELE managernavne, aldrig selv-tag, og
-- hoejst EEN notifikation pr. (bruger, indlaeg) — dedupe paa
-- metadata.sourceKey ('post:<id>' / 'reply:<id>'), saa et redigeret indlaeg
-- heller ikke kan sende en ny.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger nu paa DENNE fil — opdateret fra
-- 2026-08-25-3517-forum-reply-notification-type.sql, kanonisk forgaenger).
--
-- Applies post-merge under #2642-rammerne: idempotent (drop if exists + add),
-- ikke-destruktiv (constrainten udvides, ingen raekker roeres) → ikke ejer-gated.
-- IKKE applied endnu ved denne PR.

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
    'forum_mention'
  ]::text[]));

commit;

-- Post-verify (koer efter apply): slaa notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint, conrelid = public.notifications) og
-- bekraeft at BAADE forum_mention og forum_thread_reply indgaar i listen af
-- tilladte typer, og at listen har 55 typer i alt.
