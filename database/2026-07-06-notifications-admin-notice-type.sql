-- #2221 fair play: tilføj en dedikeret 'admin_notice'-notifikationstype så
-- spil-admin/fair-play-beskeder har en ærlig indbakke-kanal (i stedet for at
-- misbruge en bestyrelses-type). Additiv, non-breaking: udvider kun CHECK-listen.
-- Frontend renderer ukendte typer via DEFAULT_TYPE_CONFIG (neutralt klokke-ikon)
-- + literal title/message når metadata er null, så ingen frontend-ændring kræves.
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
      'admin_notice'
    ));
END $$;
