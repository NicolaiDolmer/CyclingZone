-- 2026-06-25 · #1872 · Tilføj 'contract_expiring' til notifications_type_check.
--
-- #1836 (kontraktudløb-notifikation, v6.13) indførte notifikationstypen
-- 'contract_expiring', men CHECK-constraint'en blev aldrig udvidet. Derfor
-- fejlede ALLE inserts af typen med 23514 (0 rækker nogensinde landet i prod).
--
-- Sæson- og helper-stierne swallow'ede fejlen (try/catch), men auktion-køb- og
-- transfer-køb-stierne sendte notifikationen u-bevogtet → throw'et rullede en
-- allerede-committet finalisering op og efterlod auktioner i en evig cron-retry
-- ("Udløbet" men aldrig completed). Se .claude/learnings/2026-06-25-*.
--
-- Rent additivt: udvider den tilladte enum med én værdi, rører ingen rækker.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'bid_received', 'bid_placed', 'auction_won', 'auction_lost',
    'auction_outbid', 'auction_proxy_outbid', 'transfer_offer_received',
    'transfer_offer_accepted', 'transfer_offer_rejected', 'transfer_counter',
    'transfer_offer_withdrawn', 'transfer_interest', 'new_race',
    'race_results_imported', 'season_started', 'season_ended', 'board_update',
    'board_critical', 'salary_paid', 'sponsor_paid', 'watchlist_rider_listed',
    'watchlist_rider_auction', 'loan_created', 'emergency_loan', 'loan_paid_off',
    'deadline_day_warning', 'auction_cancelled', 'squad_enforced', 'rider_retired',
    'academy_intake_ready', 'academy_signed', 'academy_rejected',
    'academy_graduation_ready', 'academy_graduated',
    'contract_expiring'
  ]::text[])
);
