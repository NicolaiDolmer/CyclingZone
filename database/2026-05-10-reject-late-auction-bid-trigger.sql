-- #269: race-window i POST /bid + PATCH /proxy hvor bid_time landede efter
-- auctions.calculated_end pga. validerings-roundtrips mellem expiry-tjek og INSERT.
-- BEFORE INSERT trigger der afviser sent landede bud — DB-håndhævet sidste forsvar.
--
-- Konkret repro: auction 4b754d83-20b4-4ca0-b98d-178072e43b77 (Axel Zingle) fik
-- bid på 12:08:27.944 mens calculated_end var 12:08:27.636 — 308 ms for sent. Det
-- udløste forlængelse #4, som gjorde forlængelse #5 mulig, og auktionen levede 11+ min ekstra.
--
-- Idempotent: CREATE OR REPLACE function + DROP+CREATE trigger.

CREATE OR REPLACE FUNCTION public.reject_late_auction_bid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calculated_end timestamptz;
  v_status text;
BEGIN
  SELECT calculated_end, status
  INTO v_calculated_end, v_status
  FROM public.auctions
  WHERE id = NEW.auction_id;

  IF v_calculated_end IS NULL THEN
    RAISE EXCEPTION 'auction_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Reject hvis bid_time >= calculated_end (samme semantik som JS isAuctionExpired:
  -- new Date() >= calculated_end). Cron'en finaliserer ved samme grænse.
  IF NEW.bid_time >= v_calculated_end THEN
    RAISE EXCEPTION 'auction_expired_at_insert (bid_time=% calculated_end=%)', NEW.bid_time, v_calculated_end
      USING ERRCODE = 'P0001';
  END IF;

  -- Reject hvis auktion ikke er aktiv. Belt-and-suspenders mod cron-finalize race
  -- (cron sætter status='completed'/'cancelled' før calculated_end-checken nødvendigvis
  -- ville fange den).
  IF v_status NOT IN ('active', 'extended') THEN
    RAISE EXCEPTION 'auction_not_active (status=%)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_late_auction_bid_trigger ON public.auction_bids;
CREATE TRIGGER reject_late_auction_bid_trigger
  BEFORE INSERT ON public.auction_bids
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_late_auction_bid();
