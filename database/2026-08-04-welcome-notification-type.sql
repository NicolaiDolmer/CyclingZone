-- Gab 2 (docs/audits/2026-08-03-product-gap-review.md, Refs #2822): rod-aarsags-
-- analyse mod prod (ghwvkxzhsbbltzfnuhhz, 4/8) af "13% af aktive brugere har 0
-- notifikationer" fandt INGEN daeknings-/RLS-/opt-in-bug i den eksisterende
-- trigger-kaede -- hvert aktivt hold der reelt har budt/vundet/tabt HAR faaet
-- sine notifikationer. Nul-tilfaeldene var enten (a) aldrig-oprettet hold (9/14
-- undersoegte konti uden team-raekke) eller (b) egen sletning via
-- NotificationsPage's "slet laeste"/enkelt-sletning (RLS-policy "Users can
-- delete own notifications" tillader det -- ingen backend-oprydning findes,
-- saa det er brugerens eget valg, ikke en fejl).
--
-- Fix fremadrettet: enhver NY konto skal have MINDST én notifikation fra dag 1,
-- saa indbakken aldrig er strukturelt tom foer det foerste (potentielt dage
-- vaek) tilfaeldige event. Tilfoejer 'welcome', afsendt naar
-- teamProfileEngine.upsertOwnTeamProfile opretter et NYT hold (backend/routes/
-- api.js, PUT /api/teams/my, result.created === true).
--
-- Idempotent: DROP IF EXISTS + ADD i én transaktion. Ikke-destruktiv (udvider
-- kun den eksisterende liste). Efterfoelger 2026-07-27-3043-notification-
-- type-constraint.sql.
--
-- MERGE-NOTE (4/8): main fik parallelt #2180's 'selection_warning' via
-- 2026-08-04-2180-selection-warning-notification-type.sql (samme dag, anden
-- session). Denne fil er OPDATERET til at vaere den fulde, kanoniske
-- efterfoelger (indeholder BEGGE nye typer) saa der kun findes ÉT sted der
-- definerer "det aktuelle sæt" — 2180-filen forbliver i historikken (harmløs,
-- delmængde) men behøver ikke koeres separat naar denne er applied.
-- Paritets-guard: backend/lib/notificationTypes.test.js krydstjekker denne fil
-- mod NOTIFICATION_TYPES (MIGRATION_PATH peger paa DENNE fil).
--
-- Applies post-merge under #2642-rammerne (idempotent, ikke-destruktiv →
-- ikke ejer-gated). INGEN backfill af eksisterende konti i denne migration →
-- kun forslag i PR-beskrivelsen.

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
    'welcome'
  ]::text[]));

commit;

-- Post-verify (kør efter apply): slå notifications_type_check op via
-- pg_get_constraintdef (se pg_constraint) og bekræft at "welcome" indgår
-- i listen af tilladte typer.
