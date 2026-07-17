-- #2523: tilføj 'stage_result'-notifikationstype til per-etape "din etape er
-- kørt"-beskeden (etapeløb notificerede historisk KUN på final-etapen, jf.
-- @smukkethomsen: 2+ dages stilhed opleves som "der sker ikke noget").
-- Additiv, non-breaking: udvider kun CHECK-listen (mønster fra
-- 2026-07-06-notifications-admin-notice-type.sql). Frontend renderer ukendte
-- typer via DEFAULT_TYPE_CONFIG, men denne slice tilføjer også en dedikeret
-- TYPE_CONFIG-entry (NotificationsPage.jsx) + i18n-koder (notif.stageResult.*).
DO $$ BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'bid_received', 'bid_placed', 'auction_won', 'auction_lost', 'auction_outbid',
      'auction_proxy_outbid', 'transfer_offer_received', 'transfer_offer_accepted',
      'transfer_offer_rejected', 'transfer_counter', 'transfer_offer_withdrawn',
      'transfer_interest', 'new_race', 'race_results_imported', 'race_result',
      'season_started', 'season_ended', 'board_update', 'board_critical',
      'salary_paid', 'sponsor_paid', 'watchlist_rider_listed', 'watchlist_rider_auction',
      'loan_created', 'emergency_loan', 'emergency_loan_breach', 'loan_paid_off',
      'deadline_day_warning', 'auction_cancelled', 'squad_enforced', 'rider_retired',
      'academy_intake_ready', 'academy_signed', 'academy_rejected',
      'academy_graduation_ready', 'academy_graduated', 'contract_expiring',
      'academy_promoted', 'academy_demoted',
      'admin_notice',
      'stage_result'
    ));
END $$;
