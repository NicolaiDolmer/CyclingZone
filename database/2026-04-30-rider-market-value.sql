-- Dynamic rider market value.
-- Base value remains uci_points * 4000, but displayed/market value includes
-- the rolling prize earnings bonus calculated by economyEngine.

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS market_value INTEGER
  GENERATED ALWAYS AS (GREATEST(5, uci_points) * 4000 + prize_earnings_bonus) STORED;

CREATE INDEX IF NOT EXISTS idx_riders_market_value
  ON riders (market_value DESC);
