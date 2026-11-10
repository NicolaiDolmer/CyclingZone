-- #2176 approved 9 November: only the buyer starts an open auction at/above
-- the current auto-price. Service-only bid RPC preserves all legacy signatures.
-- OFF: the offer trigger returns before reading listings or taking new locks.
-- Lock order matches auto-accept: both teams, rider, listing. Price changes take
-- the seller team lock, so the final ownership claim rechecks the current price.
-- Local verification: autoAccept2176.pg17.test.js; never apply from this worker.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.start_auto_accept_auction_bid(
  p_listing_id uuid,
  p_buyer_team_id uuid,
  p_expected_rider_id uuid,
  p_expected_seller_team_id uuid,
  p_expected_rider_value jsonb,
  p_expected_price bigint,
  p_duration_minutes integer,
  p_calculated_end timestamptz,
  p_max_riders integer,
  p_min_seller_riders integer,
  p_seller_at_risk_rider_ids uuid[] DEFAULT '{}',
  p_now timestamptz DEFAULT now(),
  p_bid_amount bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  l public.transfer_listings;
  r public.riders;
  v_seller uuid;
  v_price bigint;
  v_balance bigint;
  v_commitment bigint;
  v_buyer_count integer;
  v_seller_count integer;
  v_seller_out integer;
  v_seller_risk integer;
  v_seller_outgoing_ids uuid[];
  v_auction_id uuid;
BEGIN
  IF p_listing_id IS NULL OR p_buyer_team_id IS NULL OR p_expected_rider_id IS NULL OR p_expected_seller_team_id IS NULL OR p_expected_rider_value IS NULL OR p_expected_price IS NULL
     OR p_calculated_end IS NULL OR p_now IS NULL OR p_max_riders IS NULL OR p_min_seller_riders IS NULL THEN
    RAISE EXCEPTION 'start_auto_accept_auction: missing argument' USING ERRCODE = '22023';
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 30 AND 1440 THEN
    RAISE EXCEPTION 'start_auto_accept_auction: duration must be 30-1440 minutes' USING ERRCODE = '22023';
  END IF;
  -- Aktiv tid er aldrig kortere end vaegur-tiden, og calculateAuctionEnd ser
  -- hoejst 14 dage frem.
  IF p_calculated_end < p_now + make_interval(mins => p_duration_minutes)
     OR p_calculated_end > p_now + interval '14 days' THEN
    RAISE EXCEPTION 'start_auto_accept_auction: calculated_end does not match the duration' USING ERRCODE = '22023';
  END IF;

  -- Saelgeren laeses foer laasene (holdet paa en listing aendres aldrig) og
  -- alt andet igen under laasene.
  SELECT seller_team_id INTO v_seller FROM public.transfer_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'listing_not_found');
  END IF;
  IF v_seller IS DISTINCT FROM p_expected_seller_team_id THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;
  IF v_seller = p_buyer_team_id THEN
    RETURN jsonb_build_object('status', 'own_listing');
  END IF;

  PERFORM public.auto_accept_lock_teams(p_buyer_team_id, v_seller);
  SELECT * INTO l FROM public.transfer_listings WHERE id = p_listing_id;
  SELECT * INTO r FROM public.riders WHERE id = l.rider_id FOR UPDATE;
  SELECT * INTO l FROM public.transfer_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'listing_not_found');
  END IF;
  IF l.seller_team_id IS DISTINCT FROM p_expected_seller_team_id OR l.rider_id IS DISTINCT FROM p_expected_rider_id OR p_expected_rider_value IS DISTINCT FROM
      jsonb_build_object('market_value',r.market_value::double precision,'base_value',r.base_value::double precision,
                        'prize_earnings_bonus',r.prize_earnings_bonus::double precision) THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;

  IF l.status NOT IN ('open', 'negotiating') THEN
    RETURN jsonb_build_object('status', 'listing_closed');
  END IF;
  IF l.auto_accept_price IS NULL THEN
    RETURN jsonb_build_object('status', 'no_auto_accept_price');
  END IF;
  -- En prisaendring gaelder kun nye bud: koeberen betaler aldrig en anden pris
  -- end den, han saa.
  IF l.auto_accept_price <> p_expected_price THEN
    RETURN jsonb_build_object('status', 'price_changed', 'auto_accept_price', l.auto_accept_price);
  END IF;
  v_price := coalesce(p_bid_amount, l.auto_accept_price);
  IF v_price < l.auto_accept_price OR v_price > 2147483647 THEN
    RAISE EXCEPTION 'auto_accept_invalid_price' USING ERRCODE = '22023';
  END IF;

  IF r.id IS NULL OR r.team_id IS DISTINCT FROM l.seller_team_id THEN
    RETURN jsonb_build_object('status', 'rider_not_with_seller');
  END IF;
  IF coalesce(r.is_retired, false) THEN
    RETURN jsonb_build_object('status', 'rider_retired');
  END IF;
  IF coalesce(r.is_academy, false) THEN
    RETURN jsonb_build_object('status', 'rider_is_academy');
  END IF;
  -- Solgt og venter paa holdskifte (#6181): kan ikke saelges igen.
  IF r.pending_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'rider_pending_transfer');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auctions a
              WHERE a.rider_id = r.id AND a.status IN ('active', 'extended')) THEN
    RETURN jsonb_build_object('status', 'rider_on_auction');
  END IF;
  -- Samme regel som POST /auctions (#1089): en rytter i saelgers eget aabne
  -- byttetilbud kan ikke paa auktion.
  IF EXISTS (SELECT 1 FROM public.swap_offers s
              WHERE s.offered_rider_id = r.id AND s.status IN ('pending', 'countered', 'awaiting_confirmation')) THEN
    RETURN jsonb_build_object('status', 'rider_in_open_swap');
  END IF;

  -- Penge: saldo minus alt koeberen allerede har bundet i auktioner (foerende
  -- bud og autobud, worst case som computeWorstCaseCommitment).
  SELECT balance INTO v_balance FROM public.teams WHERE id = p_buyer_team_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'buyer_not_found');
  END IF;
  SELECT coalesce(sum(CASE WHEN a.current_bidder_id = p_buyer_team_id
                           THEN greatest(a.current_price::bigint, coalesce(px.max_amount, 0))
                           ELSE coalesce(px.max_amount, 0) END), 0)
    INTO v_commitment
    FROM public.auctions a
    LEFT JOIN LATERAL (
      SELECT max(p.max_amount)::bigint AS max_amount
        FROM public.auction_proxy_bids p
       WHERE p.auction_id = a.id AND p.team_id = p_buyer_team_id
    ) px ON true
   WHERE a.status IN ('active', 'extended')
     AND (a.current_bidder_id = p_buyer_team_id OR px.max_amount IS NOT NULL);
  IF v_balance - v_commitment < v_price THEN
    RETURN jsonb_build_object('status', 'insufficient_funds',
                              'available', greatest(v_balance - v_commitment, 0));
  END IF;

  -- Plads: fremtidig senior-trup (ejede minus paa vej vaek plus paa vej ind,
  -- som getTeamMarketState) plus foerende auktioner plus denne.
  SELECT count(*) INTO v_buyer_count
    FROM public.riders x
   WHERE x.squad = 'senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired, false)
     AND ((x.team_id = p_buyer_team_id AND (x.pending_team_id IS NULL OR x.pending_team_id = p_buyer_team_id))
          OR (x.pending_team_id = p_buyer_team_id AND x.team_id IS DISTINCT FROM p_buyer_team_id));
  v_buyer_count := v_buyer_count + (
    SELECT count(*) FROM public.auctions a
     WHERE a.status IN ('active', 'extended') AND a.current_bidder_id = p_buyer_team_id);
  IF v_buyer_count + 1 > p_max_riders THEN
    RETURN jsonb_build_object('status', 'squad_full', 'max_riders', p_max_riders);
  END IF;

  -- Saelgers gulv: denne rytter og saelgers andre ryttere paa en aktiv auktion
  -- med en anden byder taeller som udgaaende; risiko-rytterne taelles kun een gang.
  SELECT count(*) INTO v_seller_count
    FROM public.riders x
   WHERE x.squad = 'senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired, false)
     AND ((x.team_id = v_seller AND (x.pending_team_id IS NULL OR x.pending_team_id = v_seller))
          OR (x.pending_team_id = v_seller AND x.team_id IS DISTINCT FROM v_seller));
  v_seller_outgoing_ids := public.auto_accept_seller_outgoing_rider_ids(v_seller, r.id);
  v_seller_out := cardinality(v_seller_outgoing_ids);
  SELECT count(*) INTO v_seller_risk
    FROM public.riders x
   WHERE x.id = ANY (coalesce(p_seller_at_risk_rider_ids, '{}'))
     AND x.id <> r.id AND x.team_id = v_seller AND x.pending_team_id IS NULL
     AND NOT (x.id = ANY(v_seller_outgoing_ids));
  IF v_seller_count - 1 - v_seller_out - v_seller_risk < p_min_seller_riders THEN
    RETURN jsonb_build_object('status', 'seller_squad_floor', 'min_riders', p_min_seller_riders);
  END IF;

  BEGIN
    INSERT INTO public.auctions (
      rider_id, seller_team_id, starting_price, current_price, current_bidder_id,
      requested_start, calculated_end, is_flash, origin, source_listing_id, buyer_duration_minutes)
    VALUES (
      r.id, l.seller_team_id, v_price::integer, v_price::integer, p_buyer_team_id,
      p_now, p_calculated_end, false, 'auto_accept', l.id, p_duration_minutes)
    RETURNING id INTO v_auction_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'rider_on_auction');
  END;

  INSERT INTO public.auction_bids (auction_id, team_id, amount, bid_time, triggered_extension, is_proxy)
  VALUES (v_auction_id, p_buyer_team_id, v_price::integer, p_now, false, false);

  -- #4211: listingen staar paa pause, mens auktionen koerer.
  UPDATE public.transfer_listings SET status = 'paused' WHERE id = l.id;

  RETURN jsonb_build_object('status', 'started', 'auction_id', v_auction_id, 'rider_id', r.id,
                            'seller_team_id', l.seller_team_id, 'price', v_price,
                            'calculated_end', p_calculated_end);
END;
$$;
REVOKE ALL ON FUNCTION public.start_auto_accept_auction_bid(uuid,uuid,uuid,uuid,jsonb,bigint,integer,timestamptz,integer,integer,uuid[],timestamptz,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_auto_accept_auction_bid(uuid,uuid,uuid,uuid,jsonb,bigint,integer,timestamptz,integer,integer,uuid[],timestamptz,bigint) TO service_role;

-- Read-only check, no locks. The offer trigger uses this directly: an offer UPDATE already
-- holds its transfer_offers row lock, so taking team/rider locks here would invert the lock
-- order used by auto_accept_claim_transfer (teams -> rider -> offers) and could deadlock
-- (Codex P1 on PR #7956). The claim path re-checks under the full lock order below.
CREATE OR REPLACE FUNCTION public.auto_accept_direct_price_issue_unlocked(p_rider uuid, p_seller uuid, p_price bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_catalog AS $$
DECLARE l public.transfer_listings; v_owner uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_config WHERE key='auto_accept_enabled' AND value IN ('"on"'::jsonb,'true'::jsonb)) THEN RETURN NULL; END IF;
  SELECT team_id INTO v_owner FROM riders WHERE id=p_rider;
  IF v_owner IS DISTINCT FROM p_seller THEN RETURN NULL; END IF;
  SELECT * INTO l FROM transfer_listings WHERE rider_id=p_rider AND seller_team_id=p_seller
    AND status IN ('open','negotiating');
  IF l.auto_accept_price IS NOT NULL AND p_price >= l.auto_accept_price THEN
    RETURN jsonb_build_object('status','offer_at_auto_accept_price','auto_accept_price',l.auto_accept_price,'listing_id',l.id);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_direct_price_issue_unlocked(uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_direct_price_issue_unlocked(uuid,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_direct_price_issue(p_rider uuid, p_seller uuid, p_buyer uuid, p_price bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE v_owner uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_config WHERE key='auto_accept_enabled' AND value IN ('"on"'::jsonb,'true'::jsonb)) THEN RETURN NULL; END IF;
  PERFORM public.auto_accept_lock_teams(p_seller,p_buyer);
  SELECT team_id INTO v_owner FROM riders WHERE id=p_rider FOR UPDATE;
  PERFORM 1 FROM transfer_listings WHERE rider_id=p_rider AND seller_team_id=p_seller
    AND status IN ('open','negotiating') FOR UPDATE;
  RETURN public.auto_accept_direct_price_issue_unlocked(p_rider,p_seller,p_price);
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_direct_price_issue(uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_direct_price_issue(uuid,uuid,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_offer_boundary_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_issue jsonb;
BEGIN
  IF NEW.status NOT IN ('pending','countered','awaiting_confirmation','window_pending','accepted') THEN RETURN NEW; END IF;
  v_issue := public.auto_accept_direct_price_issue_unlocked(NEW.rider_id,NEW.seller_team_id,coalesce(NEW.counter_amount,NEW.offer_amount));
  IF v_issue IS NOT NULL THEN RAISE EXCEPTION 'offer_at_auto_accept_price' USING ERRCODE='P0001', DETAIL=v_issue::text; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_offer_boundary_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS auto_accept_offer_boundary ON public.transfer_offers;
CREATE TRIGGER auto_accept_offer_boundary BEFORE INSERT OR UPDATE OF status,counter_amount,offer_amount,buyer_confirmed,seller_confirmed
  ON public.transfer_offers FOR EACH ROW EXECUTE FUNCTION public.auto_accept_offer_boundary_guard();

CREATE OR REPLACE FUNCTION public.auto_accept_claim_transfer_at_price(
  p_rider_id uuid,p_seller_team_id uuid,p_buyer_team_id uuid,p_defer_registration boolean,
  p_now timestamptz,p_acquire_patch jsonb,p_min_seller_riders integer,p_seller_at_risk_rider_ids uuid[],p_max_riders integer,p_price bigint
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE v_issue jsonb;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'invalid transfer price' USING ERRCODE='22023'; END IF;
  v_issue := public.auto_accept_direct_price_issue(p_rider_id,p_seller_team_id,p_buyer_team_id,p_price);
  IF v_issue IS NOT NULL THEN RETURN v_issue; END IF;
  RETURN public.auto_accept_claim_transfer(p_rider_id,p_seller_team_id,p_buyer_team_id,p_defer_registration,
    p_now,p_acquire_patch,p_min_seller_riders,p_seller_at_risk_rider_ids,p_max_riders);
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_claim_transfer_at_price(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_transfer_at_price(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
