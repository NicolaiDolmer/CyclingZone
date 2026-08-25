-- #4118/#3517 (Forum L1 "puls"): tilføjer 'forum_thread_reply' — notifikation
-- når en ANDEN bruger svarer på din tråd (aldrig ved dit eget svar). Sendt fra
-- backend/lib/notificationService.js (notifyForumThreadReply), udløst af
-- POST /api/forum/posts/:id/replies. Dedupe pr. (bruger, tråd): findes der
-- allerede en ULÆST notifikation for samme tråd, opdateres den ("N new
-- replies") i stedet for at stable nye rækker op — en tråd med 20 svar giver
-- ALDRIG 20 notifikationer.
--
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger på DENNE fil — opdateret fra
-- 2026-08-19-3449-level-correction-notification-type.sql, kanonisk forgænger).
--
-- Applies post-merge under #2642-rammerne (idempotent, ikke-destruktiv →
-- ikke ejer-gated). IKKE applied endnu ved denne PR.

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
    'forum_thread_reply'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint) og bekræft at "forum_thread_reply"
-- indgår i listen af tilladte typer.
