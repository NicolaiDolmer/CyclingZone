SET lock_timeout = '3s';
BEGIN;

-- Serialize new places across the market and academy with their existing team lock.
CREATE OR REPLACE FUNCTION public.enforce_club_roster_cap_8034()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  incoming_team uuid;
  previous_teams uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NEW.is_retired IS TRUE THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_retired IS NOT TRUE THEN
    previous_teams := array_remove(ARRAY[OLD.team_id, OLD.pending_team_id], NULL);
  END IF;

  FOR incoming_team IN
    SELECT DISTINCT team_id
    FROM unnest(ARRAY[NEW.team_id, NEW.pending_team_id]) AS incoming(team_id)
    WHERE team_id IS NOT NULL AND NOT (team_id = ANY(previous_teams))
    ORDER BY team_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = incoming_team AND NOT coalesce(t.is_ai, false) AND NOT coalesce(t.is_bank, false)
    ) THEN CONTINUE; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(incoming_team::text, 0));
    IF (
      SELECT count(*) FROM public.riders r
      WHERE (r.team_id = incoming_team OR r.pending_team_id = incoming_team)
        AND r.is_retired IS NOT TRUE
    ) >= 60 THEN
      RAISE EXCEPTION USING MESSAGE = 'club_roster_full', ERRCODE = '23514', DETAIL = incoming_team::text;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_club_roster_cap_8034() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_club_roster_cap_8034 ON public.riders;
CREATE TRIGGER enforce_club_roster_cap_8034
BEFORE INSERT OR UPDATE OF team_id, pending_team_id, is_retired ON public.riders
FOR EACH ROW EXECUTE FUNCTION public.enforce_club_roster_cap_8034();

-- Auction starts with an opening bidder, including auto-accept, reserve a place
-- before either a rider or a payment changes hands.
CREATE OR REPLACE FUNCTION public.enforce_club_opening_bid_cap_8034()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = NEW.current_bidder_id AND NOT coalesce(t.is_ai, false) AND NOT coalesce(t.is_bank, false)
  ) THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.current_bidder_id::text, 0));
  IF (
    SELECT count(*) FROM public.riders r
    WHERE (r.team_id = NEW.current_bidder_id OR r.pending_team_id = NEW.current_bidder_id)
      AND r.is_retired IS NOT TRUE
  ) + (
    SELECT count(*) FROM public.auctions a
    WHERE a.current_bidder_id = NEW.current_bidder_id
      AND a.status IN ('active', 'extended') AND a.id IS DISTINCT FROM NEW.id
  ) >= 60 THEN
    RAISE EXCEPTION USING MESSAGE = 'club_roster_full', ERRCODE = '23514', DETAIL = NEW.current_bidder_id::text;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_club_opening_bid_cap_8034() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_club_opening_bid_cap_8034 ON public.auctions;
CREATE TRIGGER enforce_club_opening_bid_cap_8034
BEFORE INSERT ON public.auctions
FOR EACH ROW
WHEN (NEW.current_bidder_id IS NOT NULL AND NEW.status IN ('active', 'extended'))
EXECUTE FUNCTION public.enforce_club_opening_bid_cap_8034();

COMMIT;
