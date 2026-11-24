BEGIN;
SET LOCAL lock_timeout = '3s';

-- Serialize new places across the market and academy with their existing team lock.
CREATE OR REPLACE FUNCTION public.enforce_club_roster_cap_8034()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  incoming_team uuid;
  previous_teams uuid[] := ARRAY[]::uuid[];
  swap_leg jsonb;
  departing_rider uuid;
BEGIN
  IF NEW.is_retired IS TRUE THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_retired IS NOT TRUE THEN
    previous_teams := array_remove(ARRAY[OLD.team_id, OLD.pending_team_id], NULL);
    IF pg_has_role(current_user, 'service_role', 'USAGE') THEN
      swap_leg := nullif(current_setting('cyclingzone.swap_departure', true), '')::jsonb;
    END IF;
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
    departing_rider := CASE WHEN swap_leg->>'incoming' = NEW.id::text
      AND swap_leg->>'team' = incoming_team::text THEN (swap_leg->>'outgoing')::uuid END;
    IF (
      SELECT count(*) FROM public.riders r
      WHERE (r.team_id = incoming_team OR r.pending_team_id = incoming_team)
        AND r.is_retired IS NOT TRUE
        AND (r.id IS DISTINCT FROM departing_rider OR r.team_id IS DISTINCT FROM incoming_team)
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

-- The paid swap calls this same ownership claim. A function-local setting
-- restores the caller context on exit, including after a failed leg.
CREATE OR REPLACE FUNCTION public.auto_accept_claim_swap(
  p_offered_rider_id uuid,
  p_requested_rider_id uuid,
  p_proposing_team_id uuid,
  p_receiving_team_id uuid,
  p_defer_registration boolean,
  p_now timestamptz,
  p_offered_patch jsonb,
  p_requested_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
SET cyclingzone.swap_departure = ''
AS $$
DECLARE
  o public.riders;
  q public.riders;
  v_leg record;
  v_assignments text;
  v_contract_assignments text;
BEGIN
  IF p_offered_rider_id IS NULL OR p_requested_rider_id IS NULL
     OR p_offered_rider_id = p_requested_rider_id
     OR p_proposing_team_id IS NULL OR p_receiving_team_id IS NULL
     OR p_proposing_team_id = p_receiving_team_id
     OR p_defer_registration IS NULL OR p_now IS NULL
     OR p_offered_patch IS NULL OR jsonb_typeof(p_offered_patch) <> 'object'
     OR p_requested_patch IS NULL OR jsonb_typeof(p_requested_patch) <> 'object' THEN
    RAISE EXCEPTION 'auto_accept_claim_swap: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_offered_patch || p_requested_patch) k
             WHERE k NOT IN ('salary','contract_length','contract_end_season','squad','is_academy')) THEN
    RAISE EXCEPTION 'auto_accept_claim_swap: invalid patch' USING ERRCODE = '22023';
  END IF;

  PERFORM public.auto_accept_lock_teams(p_proposing_team_id, p_receiving_team_id);
  PERFORM 1 FROM public.riders WHERE id IN (p_offered_rider_id, p_requested_rider_id) ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM public.riders WHERE id = p_offered_rider_id;
  SELECT * INTO q FROM public.riders WHERE id = p_requested_rider_id;

  IF o.id IS NULL OR q.id IS NULL
     OR o.team_id IS DISTINCT FROM p_proposing_team_id
     OR q.team_id IS DISTINCT FROM p_receiving_team_id
     OR o.pending_team_id IS NOT NULL OR q.pending_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auctions a
              WHERE a.rider_id IN (o.id, q.id) AND a.status IN ('active','extended')) THEN
    RETURN jsonb_build_object('status','rider_on_auction');
  END IF;

  -- Samme tildelinger som auto_accept_claim_transfer: udeladte felter forbliver
  -- uroert, og et eksplicit NULL i patchen skrives som NULL.
  FOR v_leg IN
    SELECT * FROM (VALUES
      (o.id, p_receiving_team_id, p_offered_patch, q.id),
      (q.id, p_proposing_team_id, p_requested_patch, o.id)
    ) AS t(rider_id, target_team_id, patch, departing_rider_id)
  LOOP
    -- Both riders and both teams are locked. Credit only the opposite leg.
    PERFORM set_config('cyclingzone.swap_departure', jsonb_build_object(
      'incoming', v_leg.rider_id, 'team', v_leg.target_team_id, 'outgoing', v_leg.departing_rider_id
    )::text, true);
    v_assignments := CASE WHEN p_defer_registration THEN 'pending_team_id=$2, updated_at=$3'
      ELSE 'team_id=$2, pending_team_id=NULL, acquired_at=$3' END;
    SELECT string_agg(format('%1$I=p.%1$I', k), ', ' ORDER BY k) INTO v_contract_assignments
      FROM jsonb_object_keys(v_leg.patch) k;
    IF v_contract_assignments IS NOT NULL THEN
      v_assignments := v_assignments || ', ' || v_contract_assignments;
    END IF;
    EXECUTE 'UPDATE public.riders r SET ' || v_assignments ||
      ' FROM jsonb_populate_record(NULL::public.riders,$1) p WHERE r.id=$4'
      USING v_leg.patch, v_leg.target_team_id, p_now, v_leg.rider_id;
  END LOOP;

  -- Resolve the destination after applying the sale patches. A same-squad
  -- replacement can fill the last place. An addition to a full squad cannot.
  FOR v_leg IN
    SELECT coalesce(r.pending_team_id, r.team_id) AS target_team_id,
           coalesce(r.squad, 'senior') AS target_squad,
           CASE WHEN r.id = o.id THEN q.id ELSE o.id END AS departing_rider_id
    FROM public.riders r
    WHERE r.id IN (o.id, q.id)
  LOOP
    IF (
      SELECT count(*) FROM public.riders r
      WHERE (r.team_id = v_leg.target_team_id OR r.pending_team_id = v_leg.target_team_id)
        AND (r.id IS DISTINCT FROM v_leg.departing_rider_id OR r.team_id IS DISTINCT FROM v_leg.target_team_id)
        AND coalesce(r.squad, 'senior') = v_leg.target_squad
        AND r.is_retired IS NOT TRUE
    ) > 30 THEN
      RAISE EXCEPTION USING MESSAGE = 'swap_destination_squad_full', ERRCODE = '23514',
        DETAIL = v_leg.target_team_id::text;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status','claimed','offered_rider_id',o.id,'requested_rider_id',q.id);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
