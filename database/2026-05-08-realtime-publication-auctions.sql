-- #196: Tilføj public.auctions + public.auction_bids til supabase_realtime
-- publication så frontend's postgres_changes-subscriptions faktisk modtager
-- INSERT/UPDATE-events.
--
-- Discovery: tabellerne var aldrig blevet tilføjet til publicationen, hvilket
-- betød at både #195 (rider-bids-{auctionId} INSERT subscriber) og #196
-- (auctions-live UPDATE + auction_bids INSERT subscribers) tav i prod selvom
-- frontend-koden var korrekt. Anvendt i prod 2026-05-08 via Supabase MCP
-- (verificeret med fake bid-insertions: ticker tikker 0 → 3 → reset efter 30s).
--
-- ALTER PUBLICATION er idempotent vha. NOT EXISTS-tjek mod pg_publication_tables.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'auctions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'auction_bids'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_bids;
  END IF;
END $$;
