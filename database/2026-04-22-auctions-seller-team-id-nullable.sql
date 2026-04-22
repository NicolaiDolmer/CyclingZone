-- Align the live DB contract with the shared auction finalizer.
-- Non-owned auction flows clear seller_team_id on completion to avoid false sale history.
ALTER TABLE public.auctions
  ALTER COLUMN seller_team_id DROP NOT NULL;
