-- #2226 · Rytterværdi på handelsdagen, gemt på selve handels-rækken.
--
-- BAGGRUND: fair-play-scannet (ugentligt) og #2226's in-app-detektor skal kende
-- rytterens market_value PÅ DET TIDSPUNKT handlen blev gennemført. Der findes
-- ingen værdi-historik pr. rytter: riders.market_value overskrives af
-- søndags-sweepet og af træning. I dag rekonstrueres værdien fra
-- rider_development_log.base_value (sæsonstart) + korrektions-kvitteringer, hvilket
-- undervurderer ungdoms-/akademiryttere midt i sæsonen og slet ikke findes for
-- ryttere oprettet midt i sæsonen.
--
-- DENNE migration tilføjer nullable snapshot-kolonner. Backenden skriver dem i
-- SAMME UPDATE som status-flippet (auctionFinalization.js closeAuction,
-- transferExecution.js executeTransferOffer/executeSwapOffer), med værdien læst
-- FØR handlen muterer rytteren. Ældre rækker forbliver NULL (ingen backfill: der
-- findes ingen pålidelig kilde, og et gæt ville være værre end NULL).
--
-- Rent additiv: ADD COLUMN IF NOT EXISTS, ingen default, ingen constraint →
-- idempotent og uden tabel-rewrite. Backenden tåler at kolonnerne mangler i
-- auto-migrate-vinduet (deploy før apply): dealValueSnapshot.js falder tilbage
-- til status-update uden snapshot ved 42703/PGRST204.
--
-- Apply: post-merge via auto-migrate.yml (#2642). Post-verify:
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND column_name LIKE '%value_at_%' ORDER BY 1, 2;
--   → 8 rækker, alle integer.
--
-- Rollback (idempotent):
--   ALTER TABLE auctions DROP COLUMN IF EXISTS rider_market_value_at_close,
--     DROP COLUMN IF EXISTS rider_base_value_at_close;
--   ALTER TABLE transfer_offers DROP COLUMN IF EXISTS rider_market_value_at_accept,
--     DROP COLUMN IF EXISTS rider_base_value_at_accept;
--   ALTER TABLE swap_offers DROP COLUMN IF EXISTS offered_rider_market_value_at_accept,
--     DROP COLUMN IF EXISTS offered_rider_base_value_at_accept,
--     DROP COLUMN IF EXISTS requested_rider_market_value_at_accept,
--     DROP COLUMN IF EXISTS requested_rider_base_value_at_accept;

-- Lock safety (#6342): ADD COLUMN uden default er ren metadata, men skal stadig
-- have ACCESS EXCLUSIVE kortvarigt. Hellere fejle og genkøre end at stå i kø
-- bag en lang spiller-læsning og blokere alt bagved.
SET lock_timeout = '3s';

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS rider_market_value_at_close INTEGER,
  ADD COLUMN IF NOT EXISTS rider_base_value_at_close INTEGER;

COMMENT ON COLUMN auctions.rider_market_value_at_close IS
  '#2226: riders.market_value da auktionen blev lukket (completed). NULL for auktioner lukket før snapshot fandtes.';
COMMENT ON COLUMN auctions.rider_base_value_at_close IS
  '#2226: riders.base_value da auktionen blev lukket (completed).';

ALTER TABLE transfer_offers
  ADD COLUMN IF NOT EXISTS rider_market_value_at_accept INTEGER,
  ADD COLUMN IF NOT EXISTS rider_base_value_at_accept INTEGER;

COMMENT ON COLUMN transfer_offers.rider_market_value_at_accept IS
  '#2226: riders.market_value da handlen blev gennemført (accepted). NULL for ældre handler og window_pending-flush.';
COMMENT ON COLUMN transfer_offers.rider_base_value_at_accept IS
  '#2226: riders.base_value da handlen blev gennemført (accepted).';

ALTER TABLE swap_offers
  ADD COLUMN IF NOT EXISTS offered_rider_market_value_at_accept INTEGER,
  ADD COLUMN IF NOT EXISTS offered_rider_base_value_at_accept INTEGER,
  ADD COLUMN IF NOT EXISTS requested_rider_market_value_at_accept INTEGER,
  ADD COLUMN IF NOT EXISTS requested_rider_base_value_at_accept INTEGER;

COMMENT ON COLUMN swap_offers.offered_rider_market_value_at_accept IS
  '#2226: market_value for offered_rider da byttet blev gennemført (accepted).';
COMMENT ON COLUMN swap_offers.offered_rider_base_value_at_accept IS
  '#2226: base_value for offered_rider da byttet blev gennemført (accepted).';
COMMENT ON COLUMN swap_offers.requested_rider_market_value_at_accept IS
  '#2226: market_value for requested_rider da byttet blev gennemført (accepted).';
COMMENT ON COLUMN swap_offers.requested_rider_base_value_at_accept IS
  '#2226: base_value for requested_rider da byttet blev gennemført (accepted).';
