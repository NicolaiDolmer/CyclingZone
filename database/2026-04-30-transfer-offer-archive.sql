-- Transfer offer archive flags.
-- Per-side archive keeps shared negotiation history intact for the other manager.

ALTER TABLE transfer_offers
  ADD COLUMN IF NOT EXISTS buyer_archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transfer_offers_buyer_archive
  ON transfer_offers (buyer_team_id, buyer_archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_transfer_offers_seller_archive
  ON transfer_offers (seller_team_id, seller_archived_at, updated_at DESC);
