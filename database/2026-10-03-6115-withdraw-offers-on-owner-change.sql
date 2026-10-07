-- Refs #6115, owner decision A (2026-10-03). Forward-only: no backfill.
-- Independent of #6061's initialize_first_use_rider_condition trigger.
CREATE OR REPLACE FUNCTION public.withdraw_open_offers_on_rider_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Null-safe; repeated writes and pending_team_id-only changes do nothing.
  IF NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN RETURN NEW; END IF;

  -- ACTIVE_MARKET_STATUSES in transferExecution.js / marketUtils.js.
  UPDATE public.transfer_offers
    SET status = 'withdrawn'
    WHERE rider_id = NEW.id
      AND status IN ('pending', 'countered', 'awaiting_confirmation');

  UPDATE public.swap_offers
    SET status = 'withdrawn'
    WHERE (offered_rider_id = NEW.id OR requested_rider_id = NEW.id)
      AND status IN ('pending', 'countered', 'awaiting_confirmation');

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_open_offers_on_rider_owner_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_open_offers_on_rider_owner_change() TO service_role;

DROP TRIGGER IF EXISTS trg_withdraw_open_offers_on_rider_owner_change ON public.riders;
-- Listen to all UPDATEs: also catch team_id changed by a BEFORE trigger.
CREATE TRIGGER trg_withdraw_open_offers_on_rider_owner_change
  AFTER UPDATE ON public.riders
  FOR EACH ROW
  WHEN (OLD.team_id IS DISTINCT FROM NEW.team_id)
  EXECUTE FUNCTION public.withdraw_open_offers_on_rider_owner_change();
