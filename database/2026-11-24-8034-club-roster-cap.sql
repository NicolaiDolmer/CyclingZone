BEGIN;
SET LOCAL lock_timeout = '3s';

-- An active lead reserves its seat until the rider joins or the lead ends.
ALTER TABLE public.auctions ADD COLUMN IF NOT EXISTS reservation_squad text;

-- Match the acquisition season used by auction finalization, including the
-- gap between the completed and active seasons.
CREATE OR REPLACE FUNCTION public.auction_youth_squad_8034(p_rider uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN 2025 + s.number - extract(year FROM r.birthdate) >= 19 THEN 'u23' ELSE 'junior' END
  FROM public.riders r
  LEFT JOIN LATERAL (
    SELECT number + CASE WHEN status = 'completed' THEN 1 ELSE 0 END AS number
    FROM public.seasons
    WHERE status IN ('active', 'upcoming', 'completed') AND number > 0
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
             CASE WHEN status = 'upcoming' THEN number END, number DESC
    LIMIT 1
  ) s ON true
  WHERE r.id = p_rider;
$$;

CREATE OR REPLACE FUNCTION public.auction_effective_reservation_squad_8034(p_auction uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN a.reservation_squad = 'senior' OR NOT coalesce(a.is_youth, false) THEN 'senior'
    WHEN a.reservation_squad IS NULL AND
      (SELECT count(*) FROM public.riders r
       WHERE (r.team_id = a.current_bidder_id OR r.pending_team_id = a.current_bidder_id)
         AND coalesce(r.squad, 'senior') = 'senior' AND r.is_retired IS NOT TRUE)
      + (SELECT count(*) FROM public.auctions b
         WHERE b.current_bidder_id = a.current_bidder_id
           AND b.status IN ('active', 'extended') AND b.id <> a.id
           AND (b.reservation_squad = 'senior'
             OR (b.reservation_squad IS NULL AND (
               NOT coalesce(b.is_youth, false) OR (b.created_at, b.id) < (a.created_at, a.id)
             )))
           AND NOT EXISTS (
             SELECT 1 FROM public.riders r
             WHERE r.id = b.rider_id AND (r.team_id = b.current_bidder_id OR r.pending_team_id = b.current_bidder_id)
           )) < 30
      THEN 'senior'
    ELSE public.auction_youth_squad_8034(a.rider_id)
  END
  FROM public.auctions a
  WHERE a.id = p_auction;
$$;

REVOKE ALL ON FUNCTION public.auction_youth_squad_8034(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auction_effective_reservation_squad_8034(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_youth_squad_8034(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.auction_effective_reservation_squad_8034(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.market_leading_auctions_8034(p_team uuid)
RETURNS TABLE(id uuid, current_price bigint, reservation_squad text)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT a.id, a.current_price::bigint, public.auction_effective_reservation_squad_8034(a.id)
  FROM public.auctions a
  WHERE a.current_bidder_id = p_team AND a.status IN ('active', 'extended');
$$;

REVOKE ALL ON FUNCTION public.market_leading_auctions_8034(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_leading_auctions_8034(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auction_reserved_places_8034(
  p_team uuid, p_squad text DEFAULT NULL, p_exclude_auction uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.auctions a
  WHERE a.current_bidder_id = p_team
    AND a.status IN ('active', 'extended')
    AND a.id IS DISTINCT FROM p_exclude_auction
    AND (p_squad IS NULL OR public.auction_effective_reservation_squad_8034(a.id) = p_squad)
    AND NOT EXISTS (
      SELECT 1 FROM public.riders r
      WHERE r.id = a.rider_id AND (r.team_id = p_team OR r.pending_team_id = p_team)
    );
$$;
REVOKE ALL ON FUNCTION public.auction_reserved_places_8034(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_reserved_places_8034(uuid, text, uuid) TO service_role;

-- An accepted bid can settle against the registered result of an already
-- claimed transfer. New acquisitions still count both live and pending rows.
CREATE OR REPLACE FUNCTION public.auction_settlement_club_count_8034(p_team uuid)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM public.riders r
  WHERE (r.team_id = p_team OR r.pending_team_id = p_team)
    AND coalesce(r.pending_team_id, r.team_id) = p_team
    AND r.is_retired IS NOT TRUE;
$$;

REVOKE ALL ON FUNCTION public.auction_settlement_club_count_8034(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auction_settlement_club_count_8034(uuid) TO service_role;

-- Existing financial admission calls the same senior reservation count.
CREATE OR REPLACE FUNCTION public.team_seat_commitment(p_team_id uuid, p_exclude_auction_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (SELECT count(*)::integer FROM public.riders r
          WHERE (r.team_id=p_team_id OR r.pending_team_id=p_team_id)
            AND coalesce(r.squad,'senior')='senior' AND r.is_retired IS NOT TRUE)
    + public.auction_reserved_places_8034(p_team_id, 'senior', p_exclude_auction_id);
$$;
REVOKE ALL ON FUNCTION public.team_seat_commitment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_seat_commitment(uuid, uuid) TO service_role;

-- Legacy auto-accept functions used to treat every leading auction as senior.
-- Keep their installed validation and settlement bodies, replacing only the count.
DO $seats$
DECLARE
  candidate record;
  def text;
  first_count integer;
  next_check integer;
  count_anchor constant text := 'SELECT count(*) INTO v_buyer_count';
  check_anchor constant text := 'IF v_buyer_count + 1 > p_max_riders THEN';
  new_count constant text := 'v_buyer_count := public.team_seat_commitment(p_buyer_team_id, NULL);';
BEGIN
  FOR candidate IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('start_auto_accept_auction_bid','start_auto_accept_auction','auto_accept_claim_transfer')
  LOOP
    def := pg_get_functiondef(candidate.oid);
    IF strpos(def, new_count)>0 THEN CONTINUE; END IF;
    next_check := strpos(def, check_anchor);
    IF next_check=0 THEN CONTINUE; END IF; -- signature-only wrapper
    first_count := strpos(def, count_anchor);
    IF first_count=0 OR first_count>=next_check
       OR strpos(substr(def, first_count, next_check-first_count), 'v_buyer_count := v_buyer_count +')=0 THEN
      RAISE EXCEPTION '#8034: unexpected senior count in %', candidate.proname;
    END IF;
    EXECUTE left(def,first_count-1) || new_count || E'\n  ' || substr(def,next_check);
  END LOOP;
END
$seats$;

-- The existing locked voluntary youth moves and signings use this count.
CREATE OR REPLACE FUNCTION public.count_team_squad_members(
  p_team_id uuid, p_squad text, p_exclude_rider_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (
    SELECT count(*)::integer FROM public.riders r
    WHERE (r.team_id = p_team_id OR r.pending_team_id = p_team_id)
      AND r.id IS DISTINCT FROM p_exclude_rider_id AND r.is_retired IS NOT TRUE
      AND (r.squad = p_squad OR (r.is_academy AND r.squad = 'senior'))
  ) + public.auction_reserved_places_8034(p_team_id, p_squad, (
    SELECT a.id FROM public.auctions a
    WHERE a.rider_id = p_exclude_rider_id AND a.current_bidder_id = p_team_id
      AND a.status IN ('active', 'extended') ORDER BY a.id LIMIT 1
  ));
$$;
REVOKE ALL ON FUNCTION public.count_team_squad_members(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_team_squad_members(uuid, text, uuid) TO service_role;

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
  occupied_count integer;
  after_registration_count integer;
  reserved integer;
  own_auction uuid;
  incoming_squad text := coalesce(NEW.squad, 'senior');
  squad_allowance integer;
BEGIN
  IF NEW.is_retired IS TRUE THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_retired IS NOT TRUE THEN
    previous_teams := array_remove(ARRAY[OLD.team_id, OLD.pending_team_id], NULL);
    IF pg_has_role(current_user, 'service_role', 'USAGE') THEN
      swap_leg := nullif(current_setting('cyclingzone.swap_departure', true), '')::jsonb;
    END IF;
    -- A voluntary promotion enters the senior squad without changing owner.
    -- The automatic cutover is the only scoped exception to this admission.
    IF NEW.team_id IS NOT NULL AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
       AND NEW.pending_team_id IS NOT DISTINCT FROM OLD.pending_team_id
       AND OLD.squad IS DISTINCT FROM NEW.squad AND incoming_squad = 'senior'
       AND NOT (pg_has_role(current_user, 'service_role', 'USAGE')
         AND coalesce(current_setting('cyclingzone.season_squad_promotion', true), '') = 'on') THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));
      IF public.team_seat_commitment(NEW.team_id) >= 30 THEN
        RAISE EXCEPTION 'squad_full' USING ERRCODE = '23514';
      END IF;
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
    -- A locked same-squad replacement adds no place. It is independent of
    -- pending registrations and remains possible above a roster limit.
    IF departing_rider IS NOT NULL AND swap_leg->'replaces_place' = 'true'::jsonb THEN
      CONTINUE;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE coalesce(r.pending_team_id, r.team_id) = incoming_team)
      INTO occupied_count, after_registration_count
      FROM public.riders r
      WHERE (r.team_id = incoming_team OR r.pending_team_id = incoming_team)
        AND r.is_retired IS NOT TRUE
        AND (r.id IS DISTINCT FROM departing_rider OR r.team_id IS DISTINCT FROM incoming_team);
    -- Only the winning rider can consume the exact reservation. Once the
    -- rider is owned or pending in, the reservation is no longer counted.
    own_auction := NULL;
    IF departing_rider IS NULL AND pg_has_role(current_user, 'service_role', 'USAGE') THEN
      SELECT a.id INTO own_auction FROM public.auctions a
      WHERE a.rider_id = NEW.id AND a.current_bidder_id = incoming_team
        AND a.status IN ('active', 'extended')
      ORDER BY a.id LIMIT 1;
    END IF;
    reserved := public.auction_reserved_places_8034(incoming_team, NULL, own_auction);
    IF own_auction IS NOT NULL THEN occupied_count := after_registration_count; END IF;
    IF occupied_count + reserved >= 60 THEN
      IF departing_rider IS NOT NULL AND after_registration_count + reserved < 60 THEN
        RAISE EXCEPTION USING MESSAGE = 'swap_pending_registration', ERRCODE = '23514', DETAIL = incoming_team::text;
      END IF;
      RAISE EXCEPTION USING MESSAGE = 'club_roster_full', ERRCODE = '23514', DETAIL = incoming_team::text;
    END IF;
    squad_allowance := CASE WHEN own_auction IS NULL THEN 0
      ELSE public.auction_promotion_allowance_7323(own_auction, incoming_team, incoming_squad) END;
    IF (
      SELECT count(*) FROM public.riders r
      WHERE (r.team_id = incoming_team OR r.pending_team_id = incoming_team)
        AND (own_auction IS NULL OR coalesce(r.pending_team_id, r.team_id) = incoming_team)
        AND coalesce(r.squad, 'senior') = incoming_squad
        AND r.is_retired IS NOT TRUE
        AND (r.id IS DISTINCT FROM departing_rider OR r.team_id IS DISTINCT FROM incoming_team)
    ) + public.auction_reserved_places_8034(incoming_team, incoming_squad, own_auction) >= 30 + squad_allowance THEN
      IF departing_rider IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'swap_destination_squad_full', ERRCODE = '23514', DETAIL = incoming_team::text;
      END IF;
      RAISE EXCEPTION USING MESSAGE = CASE WHEN incoming_squad = 'senior' THEN 'squad_full' ELSE 'academy_full' END,
        ERRCODE = '23514', DETAIL = incoming_team::text;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_club_roster_cap_8034() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_club_roster_cap_8034 ON public.riders;
CREATE TRIGGER enforce_club_roster_cap_8034
BEFORE INSERT OR UPDATE OF team_id, pending_team_id, is_retired, squad ON public.riders
FOR EACH ROW EXECUTE FUNCTION public.enforce_club_roster_cap_8034();

-- Admission and ownership changes use the same per-team lock. Release is
-- derived from the committed lead, so an outbid club needs no cleanup job.
CREATE OR REPLACE FUNCTION public.enforce_club_opening_bid_cap_8034()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  destination text;
  occupied integer;
  is_opening boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.current_bidder_id IS NOT DISTINCT FROM NEW.current_bidder_id
     AND OLD.status IN ('active', 'extended') THEN
    NEW.reservation_squad := OLD.reservation_squad;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = NEW.current_bidder_id AND NOT coalesce(t.is_ai, false) AND NOT coalesce(t.is_bank, false)
  ) THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.current_bidder_id::text, 0));
  IF (
    SELECT count(*) FROM public.riders r
    WHERE (r.team_id = NEW.current_bidder_id OR r.pending_team_id = NEW.current_bidder_id)
      AND r.is_retired IS NOT TRUE
  ) + public.auction_reserved_places_8034(NEW.current_bidder_id, NULL, NEW.id) >= 60 THEN
    IF is_opening THEN
      RAISE EXCEPTION USING MESSAGE = 'club_roster_full', ERRCODE = '23514', DETAIL = NEW.current_bidder_id::text;
    END IF;
    RAISE EXCEPTION 'market_gate_6181:club_roster_full' USING ERRCODE = 'P0001';
  END IF;

  destination := 'senior';
  SELECT count(*) INTO occupied FROM public.riders r
  WHERE (r.team_id = NEW.current_bidder_id OR r.pending_team_id = NEW.current_bidder_id)
    AND coalesce(r.squad, 'senior') = destination AND r.is_retired IS NOT TRUE;
  IF occupied + public.auction_reserved_places_8034(NEW.current_bidder_id, destination, NEW.id) >= 30 THEN
    IF NOT coalesce(NEW.is_youth, false) THEN
      RAISE EXCEPTION 'market_gate_6181:squad_full' USING ERRCODE = 'P0001';
    END IF;
    destination := coalesce(public.auction_youth_squad_8034(NEW.rider_id), 'junior');
    SELECT count(*) INTO occupied FROM public.riders r
    WHERE (r.team_id = NEW.current_bidder_id OR r.pending_team_id = NEW.current_bidder_id)
      AND coalesce(r.squad, 'senior') = destination AND r.is_retired IS NOT TRUE;
    IF occupied + public.auction_reserved_places_8034(NEW.current_bidder_id, destination, NEW.id) >= 30 THEN
      RAISE EXCEPTION 'market_gate_6181:squad_full' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.reservation_squad := destination;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_club_opening_bid_cap_8034() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_club_opening_bid_cap_8034 ON public.auctions;
CREATE TRIGGER enforce_club_opening_bid_cap_8034
BEFORE INSERT OR UPDATE OF current_bidder_id, status, reservation_squad ON public.auctions
FOR EACH ROW
WHEN (NEW.current_bidder_id IS NOT NULL AND NEW.status IN ('active', 'extended'))
EXECUTE FUNCTION public.enforce_club_opening_bid_cap_8034();

-- The atomic market already syncs the leader from its bid trigger. Legacy
-- bids need the same transaction boundary before their row becomes visible.
CREATE OR REPLACE FUNCTION public.sync_legacy_auction_bid_8034()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  a public.auctions;
BEGIN
  IF public.market_transport_2176() THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));
  SELECT * INTO a FROM public.auctions WHERE id=NEW.auction_id FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active', 'extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount < a.current_price OR
     (NEW.amount = a.current_price AND a.current_bidder_id IS NOT NULL
      AND a.current_bidder_id IS DISTINCT FROM NEW.team_id) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.auctions SET current_price=NEW.amount, current_bidder_id=NEW.team_id
  WHERE id=a.id AND (current_price IS DISTINCT FROM NEW.amount OR current_bidder_id IS DISTINCT FROM NEW.team_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_legacy_auction_bid_8034() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_legacy_auction_bid_8034 ON public.auction_bids;
CREATE TRIGGER trg_sync_legacy_auction_bid_8034 BEFORE INSERT ON public.auction_bids
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_auction_bid_8034();

-- A legacy proxy's opening bid and its money commitment are one operation.
CREATE OR REPLACE FUNCTION public.set_legacy_proxy_opening_bid_8034(
  p_auction_id uuid, p_team_id uuid, p_max_amount bigint, p_opening_amount integer, p_bid_time timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  a public.auctions;
BEGIN
  IF p_max_amount IS NULL OR p_opening_amount IS NULL OR p_opening_amount <= 0 OR p_max_amount < p_opening_amount THEN
    RAISE EXCEPTION 'set_legacy_proxy_opening_bid_8034: invalid amount' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT * INTO a FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active', 'extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE = 'P0001';
  END IF;
  IF p_opening_amount < a.current_price OR (p_opening_amount = a.current_price AND a.current_bidder_id IS NOT NULL) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.auction_proxy_bids(auction_id,team_id,max_amount)
    VALUES(p_auction_id,p_team_id,p_max_amount)
    ON CONFLICT(auction_id,team_id) DO UPDATE SET max_amount=EXCLUDED.max_amount;
  INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
    VALUES(p_auction_id,p_team_id,p_opening_amount,p_bid_time,false,true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_legacy_proxy_opening_bid_8034(uuid,uuid,bigint,integer,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_legacy_proxy_opening_bid_8034(uuid,uuid,bigint,integer,timestamptz) TO service_role;

-- A tie is only valid for the observed incumbent's exact proxy ceiling.
CREATE OR REPLACE FUNCTION public.match_legacy_auction_proxy_tie_8034(
  p_auction_id uuid, p_team_id uuid, p_expected_price bigint, p_expected_leader_id uuid, p_bid_time timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  a public.auctions;
  cap bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT * INTO a FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active', 'extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE = 'P0001';
  END IF;
  SELECT max_amount INTO cap FROM public.auction_proxy_bids
  WHERE auction_id=p_auction_id AND team_id=p_team_id;
  IF p_team_id IS NOT DISTINCT FROM p_expected_leader_id OR p_expected_price IS NULL
     OR a.current_price IS DISTINCT FROM p_expected_price
     OR a.current_bidder_id IS DISTINCT FROM p_expected_leader_id
     OR cap IS DISTINCT FROM p_expected_price THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.auctions SET current_bidder_id=p_team_id WHERE id=a.id;
  INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
    VALUES(p_auction_id,p_team_id,p_expected_price,p_bid_time,false,true);
END;
$$;
REVOKE ALL ON FUNCTION public.match_legacy_auction_proxy_tie_8034(uuid,uuid,bigint,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_legacy_auction_proxy_tie_8034(uuid,uuid,bigint,uuid,timestamptz) TO service_role;

-- The paid swap calls this same ownership claim. The body clears the setting
-- on entry and restores the caller's value on every return. A failed leg
-- raises, which rolls the local setting back with the work. Prod's migration
-- role may not attach a custom setting to a function (permission denied, 25/11).
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
AS $$
DECLARE
  v_prev_departure text := current_setting('cyclingzone.swap_departure', true);
  o public.riders;
  q public.riders;
  v_leg record;
  v_assignments text;
  v_contract_assignments text;
  v_replaces_place boolean;
  v_replacements uuid[] := ARRAY[]::uuid[];
  v_senior_growth uuid[] := ARRAY[]::uuid[];
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

  PERFORM set_config('cyclingzone.swap_departure', '', true);
  PERFORM public.auto_accept_lock_teams(p_proposing_team_id, p_receiving_team_id);
  PERFORM 1 FROM public.riders WHERE id IN (p_offered_rider_id, p_requested_rider_id) ORDER BY id FOR UPDATE;
  SELECT * INTO o FROM public.riders WHERE id = p_offered_rider_id;
  SELECT * INTO q FROM public.riders WHERE id = p_requested_rider_id;

  IF o.id IS NULL OR q.id IS NULL
     OR o.team_id IS DISTINCT FROM p_proposing_team_id
     OR q.team_id IS DISTINCT FROM p_receiving_team_id
     OR o.pending_team_id IS NOT NULL OR q.pending_team_id IS NOT NULL THEN
    PERFORM set_config('cyclingzone.swap_departure', coalesce(v_prev_departure, ''), true);
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auctions a
              WHERE a.rider_id IN (o.id, q.id) AND a.status IN ('active','extended')) THEN
    PERFORM set_config('cyclingzone.swap_departure', coalesce(v_prev_departure, ''), true);
    RETURN jsonb_build_object('status','rider_on_auction');
  END IF;

  -- Samme tildelinger som auto_accept_claim_transfer: udeladte felter forbliver
  -- uroert, og et eksplicit NULL i patchen skrives som NULL.
  FOR v_leg IN
    SELECT * FROM (VALUES
      (p_receiving_team_id, p_offered_patch, o.id, o.squad, o.is_retired, q.id, q.squad, q.is_retired),
      (p_proposing_team_id, p_requested_patch, q.id, q.squad, q.is_retired, o.id, o.squad, o.is_retired)
    ) AS t(target_team_id, patch, rider_id, from_squad, rider_retired, departing_rider_id, departing_squad, departing_retired)
  LOOP
    -- Use the original outgoing squad, even if its row already carries an
    -- incoming squad patch. An explicit null squad follows the senior default.
    v_replaces_place := v_leg.rider_retired IS NOT TRUE AND v_leg.departing_retired IS NOT TRUE
      AND coalesce(v_leg.departing_squad, 'senior') = coalesce(
        CASE WHEN v_leg.patch ? 'squad' THEN v_leg.patch->>'squad' ELSE v_leg.from_squad END, 'senior');
    IF v_replaces_place THEN
      v_replacements := array_append(v_replacements, v_leg.rider_id);
    END IF;
    PERFORM set_config('cyclingzone.swap_departure', jsonb_build_object(
      'incoming', v_leg.rider_id, 'team', v_leg.target_team_id, 'outgoing', v_leg.departing_rider_id,
      'replaces_place', v_replaces_place
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

  -- Only a destination that grows must pass the squad limit. Pending moves
  -- continue to reserve places for acquisitions that grow a squad.
  FOR v_leg IN
    SELECT coalesce(r.pending_team_id, r.team_id) AS target_team_id,
           coalesce(r.squad, 'senior') AS target_squad,
           CASE WHEN r.id = o.id THEN q.id ELSE o.id END AS departing_rider_id
    FROM public.riders r
    WHERE r.id IN (o.id, q.id)
      AND NOT (r.id = ANY(v_replacements))
      AND r.is_retired IS NOT TRUE
  LOOP
    IF v_leg.target_squad = 'senior' THEN
      v_senior_growth := array_append(v_senior_growth, v_leg.target_team_id);
    END IF;
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

  PERFORM set_config('cyclingzone.swap_departure', coalesce(v_prev_departure, ''), true);
  RETURN jsonb_build_object('status','claimed','offered_rider_id',o.id,'requested_rider_id',q.id,
                            'senior_growth_team_ids',to_jsonb(v_senior_growth));
END;
$$;

REVOKE ALL ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_swap(uuid, uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) TO service_role;

-- The ownership claim now checks reserved places for both payment modes.
-- Remove the paid-only check, preserving the installed finance and escrow logic.
DO $migration$
DECLARE
  old_guard constant text := 'IF public.market_scope_2176(v_team,NULL) AND public.team_seat_commitment(v_team,NULL)>public.market_squad_max() THEN';
  old_loop constant text := $old$   FOREACH v_team IN ARRAY ARRAY[p_proposing_team_id,p_receiving_team_id] LOOP
     IF public.market_scope_2176(v_team,NULL) AND public.team_seat_commitment(v_team,NULL)>public.market_squad_max() THEN
       RAISE EXCEPTION 'market_beta_2176:swap_squad_full' USING ERRCODE='P0001',DETAIL=v_team::text;
     END IF;
   END LOOP;$old$;
  new_guard constant text := '-- Seat growth was already checked under the shared team lock by the ownership claim.';
  def text := pg_get_functiondef('public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb)'::regprocedure);
BEGIN
  IF strpos(def, new_guard) > 0 THEN RETURN; END IF;
  IF strpos(def, old_guard) = 0 OR (length(def) - length(replace(def, old_guard, ''))) <> length(old_guard) THEN
    RAISE EXCEPTION '#8034: unexpected paid swap reservation guard';
  END IF;
  IF strpos(def, old_loop) = 0 THEN RAISE EXCEPTION '#8034: unexpected paid swap reservation loop'; END IF;
  EXECUTE replace(def, old_loop, new_guard);
END
$migration$;

-- A rejected automatic tie must not roll back an already accepted challenger.
DO $tie$
DECLARE
  signature regprocedure := to_regprocedure('public.try_auction_proxy_tie_6181(uuid,uuid,bigint,uuid,timestamptz)');
  def text;
  old_check constant text := $old$ELSIF v_message='market_gate_6181:squad_full' THEN$old$;
  new_check constant text := $new$ELSIF v_message IN ('market_gate_6181:squad_full', 'market_gate_6181:club_roster_full') THEN$new$;
BEGIN
  IF signature IS NULL THEN RETURN; END IF;
  def := pg_get_functiondef(signature);
  IF strpos(def, new_check) > 0 THEN RETURN; END IF;
  IF (length(def) - length(replace(def, old_check, ''))) <> length(old_check) THEN
    RAISE EXCEPTION '#8034: unexpected proxy tie capacity guard';
  END IF;
  EXECUTE replace(def, old_check, new_check);
END
$tie$;

NOTIFY pgrst, 'reload schema';

COMMIT;
