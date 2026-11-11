-- #2176 owner-approved beta + scope A (10 November). No flag values are changed.
-- Canonical cohort: users.role=admin OR users.is_beta_tester, via teams.user_id.
-- Off/on compatibility is deliberate; beta writers repeat scope under team locks.
-- Additive/idempotent. Production apply is post-merge and belongs to Claude.
-- Filename sorts after transfer-payment-atomic (A7); fresh installs must retain
-- these beta replacements instead of letting A7 replace them afterwards.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_team_beta_2176(p_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public,pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.teams t JOIN public.users u ON u.id=t.user_id
    WHERE t.id=p_team_id AND (u.role='admin' OR u.is_beta_tester IS TRUE))
$$;
REVOKE ALL ON FUNCTION public.market_team_beta_2176(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_team_beta_2176(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_pair_2176(p_seller_team_id uuid,p_buyer_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public,pg_catalog AS $$
  SELECT coalesce((SELECT CASE
    WHEN value IN ('"on"'::jsonb,'true'::jsonb) THEN true
    WHEN value='"beta"'::jsonb THEN public.market_team_beta_2176(p_seller_team_id)
      AND public.market_team_beta_2176(p_buyer_team_id)
    ELSE false END FROM public.app_config WHERE key='auto_accept_enabled'),false)
$$;
REVOKE ALL ON FUNCTION public.auto_accept_pair_2176(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_pair_2176(uuid,uuid) TO service_role;

-- Transport is not a global financial rollout. It serializes a previously
-- unprotected operation with a team's FIRST public auto-auction participation.
CREATE OR REPLACE FUNCTION public.market_transport_2176()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public,pg_catalog AS $$
  SELECT coalesce((SELECT value IN ('"on"'::jsonb,'true'::jsonb,'"beta"'::jsonb)
    FROM public.app_config WHERE key='market_commitment_6181'),false)
$$;
REVOKE ALL ON FUNCTION public.market_transport_2176() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_transport_2176() TO service_role;

CREATE OR REPLACE FUNCTION public.market_scope_2176(
  p_team_id uuid,p_auction_id uuid DEFAULT NULL,p_origin text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public,pg_catalog AS $$
DECLARE v_stage jsonb;
BEGIN
  SELECT value INTO v_stage FROM public.app_config WHERE key='market_commitment_6181';
  IF v_stage IN ('"on"'::jsonb,'true'::jsonb) THEN RETURN true; END IF;
  IF v_stage IS DISTINCT FROM '"beta"'::jsonb OR p_team_id IS NULL THEN RETURN false; END IF;
  IF public.market_team_beta_2176(p_team_id) OR p_origin='auto_accept' THEN RETURN true; END IF;
  IF p_auction_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.auctions a
    WHERE a.id=p_auction_id AND a.origin='auto_accept' AND a.status IN ('active','extended')) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.auctions a
    LEFT JOIN public.auction_proxy_bids p ON p.auction_id=a.id AND p.team_id=p_team_id
    WHERE a.origin='auto_accept' AND a.status IN ('active','extended')
      AND (a.seller_team_id=p_team_id OR a.current_bidder_id=p_team_id OR coalesce(p.max_amount,0)>0));
END; $$;
REVOKE ALL ON FUNCTION public.market_scope_2176(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_scope_2176(uuid,uuid,text) TO service_role;


-- Effective protection is checked after acquiring the existing team lock.
CREATE OR REPLACE FUNCTION public.market_beta_mode_2176()
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app_config m WHERE m.key='market_commitment_6181'
   AND (m.value='"beta"'::jsonb OR (m.value IN ('"on"'::jsonb,'true'::jsonb)
     AND EXISTS(SELECT 1 FROM app_config a WHERE a.key='auto_accept_enabled' AND a.value='"beta"'::jsonb))))
$$;
REVOKE ALL ON FUNCTION public.market_beta_mode_2176() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_beta_mode_2176() TO service_role;

CREATE OR REPLACE FUNCTION public.market_bid_issue_scoped_2176(
  p_team_id uuid,
  p_auction_id uuid,
  p_amount bigint,
  p_seat boolean DEFAULT true, p_origin text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_balance bigint;
BEGIN
  IF public.market_beta_mode_2176() AND NOT public.market_scope_2176(p_team_id,p_auction_id,p_origin) THEN RETURN NULL; END IF;
  SELECT balance INTO v_balance FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN 'insufficient_available_balance';
  END IF;
  IF coalesce(v_balance, 0) - public.team_market_commitment(p_team_id, p_auction_id) < coalesce(p_amount, 0) THEN
    RETURN 'insufficient_available_balance';
  END IF;
  IF p_seat AND public.team_seat_commitment(p_team_id, p_auction_id) + 1 > public.market_squad_max() THEN
    RETURN 'squad_full';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.market_bid_issue_scoped_2176(uuid,uuid,bigint,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_bid_issue_scoped_2176(uuid,uuid,bigint,boolean,text) TO service_role;
CREATE OR REPLACE FUNCTION public.market_bid_issue_6181(
  p_team_id uuid,
  p_auction_id uuid,
  p_amount bigint,
  p_seat boolean DEFAULT true
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_balance bigint;
BEGIN
  SELECT balance INTO v_balance FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN 'insufficient_available_balance';
  END IF;
  IF coalesce(v_balance, 0) - public.team_market_commitment(p_team_id, p_auction_id) < coalesce(p_amount, 0) THEN
    RETURN 'insufficient_available_balance';
  END IF;
  IF p_seat AND public.team_seat_commitment(p_team_id, p_auction_id) + 1 > public.market_squad_max() THEN
    RETURN 'squad_full';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_commitment_6181_bid_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  a public.auctions;
  v_own_proxy bigint;
  v_issue text;
BEGIN
  IF NOT public.market_transport_2176() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));
  SELECT * INTO a FROM public.auctions WHERE id = NEW.auction_id FOR UPDATE;
  IF NOT FOUND OR a.status IS NULL OR a.status NOT IN ('active', 'extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- En anden byder naaede foerst (laest under raekkelaasen): prisen falder aldrig.
  IF NEW.amount < a.current_price OR
     (NEW.amount = a.current_price AND a.current_bidder_id IS NOT NULL
      AND a.current_bidder_id IS DISTINCT FROM NEW.team_id) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT max_amount INTO v_own_proxy FROM public.auction_proxy_bids
   WHERE auction_id = a.id AND team_id = NEW.team_id;

  v_issue := public.market_bid_issue_scoped_2176(
    NEW.team_id,
    a.id,
    greatest(NEW.amount, coalesce(v_own_proxy, 0)),
    NOT coalesce(a.is_youth, false) AND a.current_bidder_id IS DISTINCT FROM NEW.team_id
  );
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'market_gate_6181:%', v_issue USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.auctions
     SET current_price = NEW.amount, current_bidder_id = NEW.team_id
   WHERE id = a.id
     AND (current_price IS DISTINCT FROM NEW.amount OR current_bidder_id IS DISTINCT FROM NEW.team_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_commitment_6181_start_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_issue text;
BEGIN
  IF NEW.current_bidder_id IS NULL OR coalesce(NEW.status, 'active') NOT IN ('active', 'extended') THEN
    RETURN NEW;
  END IF;
  IF NOT public.market_transport_2176() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.current_bidder_id::text, 0));
  v_issue := public.market_bid_issue_scoped_2176(
    NEW.current_bidder_id,
    NEW.id,
    coalesce(NEW.current_price, 0),
    NOT coalesce(NEW.is_youth, false), NEW.origin
  );
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'market_gate_6181:%', v_issue USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_commitment_6181_proxy_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  a public.auctions;
  v_issue text;
  v_standing bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.max_amount <= OLD.max_amount
     AND NEW.team_id = OLD.team_id AND NEW.auction_id = OLD.auction_id THEN
    RETURN NEW;
  END IF;
  IF NOT public.market_transport_2176() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));
  -- An upsert fires BEFORE INSERT before its UPDATE branch. Preserve the
  -- existing release-only exemption, reading the standing ceiling under lock.
  IF TG_OP = 'INSERT' THEN
    SELECT max_amount INTO v_standing FROM public.auction_proxy_bids
     WHERE auction_id = NEW.auction_id AND team_id = NEW.team_id;
    IF FOUND AND NEW.max_amount <= v_standing THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO a FROM public.auctions WHERE id = NEW.auction_id;
  IF NOT FOUND OR a.status NOT IN ('active', 'extended') THEN
    RETURN NEW;
  END IF;

  v_issue := public.market_bid_issue_scoped_2176(
    NEW.team_id,
    a.id,
    greatest(coalesce(NEW.max_amount, 0),
             CASE WHEN a.current_bidder_id = NEW.team_id THEN coalesce(a.current_price, 0) ELSE 0 END),
    false
  );
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'market_gate_6181:%', v_issue USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_auction_bid_6181(
  p_auction_id uuid, p_team_id uuid, p_amount bigint, p_bid_time timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE a public.auctions%ROWTYPE;
BEGIN
  IF p_auction_id IS NULL OR p_team_id IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_bid_time IS NULL THEN
    RAISE EXCEPTION 'place_auction_bid_6181: invalid argument' USING ERRCODE='22023';
  END IF;
  IF NOT public.market_transport_2176() THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT * INTO a FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR a.status IS NULL OR a.status NOT IN ('active','extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE='P0001';
  END IF;
  IF p_amount<a.current_price OR (p_amount=a.current_price AND a.current_bidder_id IS NOT NULL) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
    VALUES(p_auction_id,p_team_id,p_amount,p_bid_time,false,false);
  RETURN jsonb_build_object('previousLeader',a.current_bidder_id,'expectedPrice',p_amount,'expectedLeader',p_team_id,'placed',true)
    || public.try_auction_proxy_tie_6181(p_auction_id,a.current_bidder_id,p_amount,p_team_id,p_bid_time);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_auction_proxy_context_6181(
  p_auction_id uuid, p_team_id uuid, p_max_amount bigint, p_opening_amount integer, p_bid_time timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  a public.auctions%ROWTYPE;
BEGIN
  IF p_auction_id IS NULL OR p_team_id IS NULL OR p_max_amount IS NULL OR p_max_amount <= 0 OR p_bid_time IS NULL THEN
    RAISE EXCEPTION 'set_auction_proxy_6181: invalid argument' USING ERRCODE='22023';
  END IF;
  IF NOT public.market_transport_2176() THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT * INTO a FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR a.status IS NULL OR a.status NOT IN ('active','extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE='P0001';
  END IF;
  IF p_opening_amount IS NOT NULL AND (p_opening_amount<a.current_price OR
      (p_opening_amount=a.current_price AND a.current_bidder_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.auction_proxy_bids(auction_id,team_id,max_amount)
    VALUES(p_auction_id,p_team_id,p_max_amount)
    ON CONFLICT(auction_id,team_id) DO UPDATE SET max_amount=EXCLUDED.max_amount;
  IF p_opening_amount IS NOT NULL THEN
    INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
      VALUES(p_auction_id,p_team_id,p_opening_amount,p_bid_time,false,true);
  END IF;
  RETURN jsonb_build_object('previousLeader',a.current_bidder_id,
    'expectedPrice',coalesce(p_opening_amount,a.current_price),
    'expectedLeader',CASE WHEN p_opening_amount IS NULL THEN a.current_bidder_id ELSE p_team_id END,
    'placed',p_opening_amount IS NOT NULL)
    || CASE WHEN p_opening_amount IS NULL
      THEN jsonb_build_object('tieResolved',true,'matchedTeam',NULL,'matchRejected',NULL)
      ELSE public.try_auction_proxy_tie_6181(p_auction_id,a.current_bidder_id,p_opening_amount,p_team_id,p_bid_time) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_auction_proxy_tie_6181(
  p_auction_id uuid, p_team_id uuid, p_expected_price bigint, p_expected_leader_id uuid, p_bid_time timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  a public.auctions%ROWTYPE;
  v_cap bigint;
  v_issue text;
  v_rows integer;
BEGIN
  IF p_auction_id IS NULL OR p_team_id IS NULL OR p_expected_price IS NULL OR p_expected_price<=0
     OR p_expected_leader_id IS NULL OR p_expected_leader_id=p_team_id OR p_bid_time IS NULL THEN
    RAISE EXCEPTION 'match_auction_proxy_tie_6181: invalid argument' USING ERRCODE='22023';
  END IF;
  IF NOT public.market_transport_2176() THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT * INTO a FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR a.status IS NULL OR a.status NOT IN ('active','extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE='P0001';
  END IF;
  SELECT max_amount INTO v_cap FROM public.auction_proxy_bids WHERE auction_id=p_auction_id AND team_id=p_team_id;
  IF a.current_price IS DISTINCT FROM p_expected_price OR a.current_bidder_id IS DISTINCT FROM p_expected_leader_id
     OR v_cap IS DISTINCT FROM p_expected_price THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001';
  END IF;
  v_issue:=public.market_bid_issue_scoped_2176(p_team_id,p_auction_id,p_expected_price,NOT coalesce(a.is_youth,false));
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'market_gate_6181:%',v_issue USING ERRCODE='P0001';
  END IF;
  UPDATE public.auctions SET current_bidder_id=p_team_id
    WHERE id=p_auction_id AND status IN ('active','extended') AND current_price=p_expected_price
      AND current_bidder_id IS NOT DISTINCT FROM p_expected_leader_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
    VALUES(p_auction_id,p_team_id,p_expected_price,p_bid_time,false,true);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_accept_direct_price_issue_unlocked(p_rider uuid, p_seller uuid, p_price bigint, p_buyer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_catalog AS $$
DECLARE l public.transfer_listings; v_owner uuid;
BEGIN
  IF NOT public.auto_accept_pair_2176(p_seller,p_buyer) THEN RETURN NULL; END IF;
  SELECT team_id INTO v_owner FROM riders WHERE id=p_rider;
  IF v_owner IS DISTINCT FROM p_seller THEN RETURN NULL; END IF;
  SELECT * INTO l FROM transfer_listings WHERE rider_id=p_rider AND seller_team_id=p_seller
    AND status IN ('open','negotiating');
  IF l.auto_accept_price IS NOT NULL AND p_price >= l.auto_accept_price THEN
    RETURN jsonb_build_object('status','offer_at_auto_accept_price','auto_accept_price',l.auto_accept_price,'listing_id',l.id);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_direct_price_issue_unlocked(uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_direct_price_issue_unlocked(uuid,uuid,bigint,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_direct_price_issue(p_rider uuid, p_seller uuid, p_buyer uuid, p_price bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE v_owner uuid;
BEGIN
  IF NOT public.auto_accept_pair_2176(p_seller,p_buyer) THEN RETURN NULL; END IF;
  PERFORM public.auto_accept_lock_teams(p_seller,p_buyer);
  SELECT team_id INTO v_owner FROM riders WHERE id=p_rider FOR UPDATE;
  PERFORM 1 FROM transfer_listings WHERE rider_id=p_rider AND seller_team_id=p_seller
    AND status IN ('open','negotiating') FOR UPDATE;
  RETURN public.auto_accept_direct_price_issue_unlocked(p_rider,p_seller,p_price,p_buyer);
END; $$;

CREATE OR REPLACE FUNCTION public.auto_accept_offer_boundary_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_issue jsonb;
BEGIN
  IF NEW.status NOT IN ('pending','countered','awaiting_confirmation','window_pending','accepted') THEN RETURN NEW; END IF;
  v_issue := public.auto_accept_direct_price_issue_unlocked(NEW.rider_id,NEW.seller_team_id,coalesce(NEW.counter_amount,NEW.offer_amount),NEW.buyer_team_id);
  IF v_issue IS NOT NULL THEN RAISE EXCEPTION 'offer_at_auto_accept_price' USING ERRCODE='P0001', DETAIL=v_issue::text; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_listing_auto_accept_price(
  p_listing_id uuid,
  p_seller_team_id uuid,
  p_price bigint,
  p_expected_price bigint,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  l public.transfer_listings;
  v_academy boolean;
  v_rider_owner uuid;
BEGIN
  IF p_listing_id IS NULL OR p_seller_team_id IS NULL THEN
    RAISE EXCEPTION 'set_listing_auto_accept_price: listing and seller are required' USING ERRCODE = '22023';
  END IF;

  PERFORM public.auto_accept_lock_teams(p_seller_team_id, p_seller_team_id);
  IF EXISTS(SELECT 1 FROM app_config WHERE key='auto_accept_enabled' AND value='"beta"'::jsonb)
    AND NOT public.market_team_beta_2176(p_seller_team_id) THEN RETURN jsonb_build_object('status','disabled'); END IF;
  SELECT * INTO l FROM public.transfer_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF l.seller_team_id <> p_seller_team_id THEN
    RETURN jsonb_build_object('status', 'not_owner');
  END IF;
  IF l.status NOT IN ('open', 'negotiating') THEN
    RETURN jsonb_build_object('status', 'listing_closed');
  END IF;
  SELECT r.team_id, r.is_academy INTO v_rider_owner, v_academy FROM public.riders r WHERE r.id=l.rider_id;
  IF v_rider_owner IS NULL OR v_rider_owner IS DISTINCT FROM p_seller_team_id THEN
    RETURN jsonb_build_object('status','rider_not_with_seller');
  END IF;
  -- Prisen klienten saa. NULL betyder "ingen auto-pris".
  IF l.auto_accept_price IS DISTINCT FROM p_expected_price THEN
    RETURN jsonb_build_object('status', 'price_changed', 'auto_accept_price', l.auto_accept_price);
  END IF;
  IF p_price IS NOT DISTINCT FROM l.auto_accept_price THEN
    RETURN jsonb_build_object('status', 'unchanged', 'auto_accept_price', l.auto_accept_price);
  END IF;
  IF p_price IS NOT NULL THEN
    -- Ejer 10/11: Y maa vaere lig X, ikke under.
    IF p_price < l.asking_price THEN
      RETURN jsonb_build_object('status', 'below_asking', 'asking_price', l.asking_price);
    END IF;
    IF p_price > 2147483647 THEN
      RETURN jsonb_build_object('status', 'price_too_high');
    END IF;
    -- En akademirytter kan ikke saettes paa auktion; en auto-pris ville vaere tom.
    IF coalesce(v_academy, false) THEN
      RETURN jsonb_build_object('status', 'rider_is_academy');
    END IF;
  END IF;

  PERFORM set_config('cz.auto_accept_actor', coalesce(p_actor_user_id::text, ''), true);
  PERFORM set_config('cz.auto_accept_source', 'seller_set_price', true);
  UPDATE public.transfer_listings SET auto_accept_price = p_price WHERE id = l.id;
  PERFORM set_config('cz.auto_accept_actor', '', true);
  PERFORM set_config('cz.auto_accept_source', '', true);

  RETURN jsonb_build_object('status', 'updated', 'listing_id', l.id, 'auto_accept_price', p_price,
                            'previous_auto_accept_price', l.auto_accept_price);
END;
$$;


-- Scoped ownership and payment transaction envelopes (beta mode only).
CREATE OR REPLACE FUNCTION public.auto_accept_outgoing_2176(p_team_id uuid, p_exclude_rider_id uuid, p_origin text)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_m3 boolean := false;
  v_ids uuid[];
BEGIN
  IF public.market_beta_mode_2176() AND NOT public.market_scope_2176(p_team_id,NULL,p_origin) THEN RETURN '{}'; END IF;
  v_m3 := public.market_scope_2176(p_team_id,NULL,p_origin);
  IF v_m3 THEN
    EXECUTE 'SELECT public.team_outgoing_auction_rider_ids($1,$2)'
      INTO v_ids USING p_team_id, p_exclude_rider_id;
  ELSE
    SELECT array_agg(DISTINCT x.id) INTO v_ids
      FROM public.auctions a JOIN public.riders x ON x.id=a.rider_id
     WHERE a.status IN ('active','extended') AND x.team_id=p_team_id AND x.pending_team_id IS NULL
       AND x.squad='senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired,false)
       AND a.current_bidder_id IS NOT NULL AND a.current_bidder_id<>p_team_id
       AND (p_exclude_rider_id IS NULL OR x.id<>p_exclude_rider_id);
  END IF;
  RETURN coalesce(v_ids,'{}');
END;
$$;
REVOKE ALL ON FUNCTION public.auto_accept_outgoing_2176(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_outgoing_2176(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.auto_accept_seller_outgoing_rider_ids(p_team_id uuid,p_exclude_rider_id uuid)
RETURNS uuid[] LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.auto_accept_outgoing_2176(p_team_id,p_exclude_rider_id,NULL)
$$;

CREATE OR REPLACE FUNCTION public.auto_accept_claim_transfer(
  p_rider_id uuid, p_seller_team_id uuid, p_buyer_team_id uuid,
  p_defer_registration boolean, p_now timestamptz, p_acquire_patch jsonb,
  p_min_seller_riders integer, p_seller_at_risk_rider_ids uuid[], p_max_riders integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  r public.riders;
  v_count integer;
  v_out integer;
  v_risk integer;
  v_buyer_count integer;
  v_outgoing_ids uuid[];
  v_assignments text;
  v_contract_assignments text;
BEGIN
  IF p_rider_id IS NULL OR p_seller_team_id IS NULL OR p_buyer_team_id IS NULL
     OR p_seller_team_id = p_buyer_team_id OR p_defer_registration IS NULL OR p_now IS NULL
     OR p_min_seller_riders IS NULL OR p_max_riders IS NULL
     OR p_acquire_patch IS NULL OR jsonb_typeof(p_acquire_patch) <> 'object' THEN
    RAISE EXCEPTION 'auto_accept_claim_transfer: invalid argument' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_acquire_patch) k
             WHERE k NOT IN ('salary','contract_length','contract_end_season','squad','is_academy')) THEN
    RAISE EXCEPTION 'auto_accept_claim_transfer: invalid patch' USING ERRCODE = '22023';
  END IF;
  PERFORM public.auto_accept_lock_teams(p_seller_team_id, p_buyer_team_id);
  SELECT * INTO r FROM public.riders WHERE id = p_rider_id FOR UPDATE;
  IF NOT FOUND OR r.team_id IS DISTINCT FROM p_seller_team_id OR r.pending_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auctions a WHERE a.rider_id=r.id AND a.status IN ('active','extended')) THEN
    RETURN jsonb_build_object('status','rider_on_auction');
  END IF;
  SELECT count(*) INTO v_count FROM public.riders x
   WHERE x.squad='senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired,false)
     AND ((x.team_id=p_seller_team_id AND (x.pending_team_id IS NULL OR x.pending_team_id=p_seller_team_id))
          OR (x.pending_team_id=p_seller_team_id AND x.team_id IS DISTINCT FROM p_seller_team_id));
  v_outgoing_ids := public.auto_accept_seller_outgoing_rider_ids(p_seller_team_id, r.id);
  v_out := cardinality(v_outgoing_ids);
  SELECT count(*) INTO v_risk FROM public.riders x
   WHERE x.id=ANY(coalesce(p_seller_at_risk_rider_ids,'{}')) AND x.id<>r.id
     AND x.team_id=p_seller_team_id AND x.pending_team_id IS NULL
     AND NOT (x.id = ANY(v_outgoing_ids));
  IF v_count - 1 - v_out - v_risk < p_min_seller_riders THEN
    RETURN jsonb_build_object('status','seller_squad_floor','min_riders',p_min_seller_riders);
  END IF;
  SELECT count(*) INTO v_buyer_count FROM public.riders x
   WHERE x.squad='senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired,false)
     AND ((x.team_id=p_buyer_team_id AND (x.pending_team_id IS NULL OR x.pending_team_id=p_buyer_team_id))
          OR (x.pending_team_id=p_buyer_team_id AND x.team_id IS DISTINCT FROM p_buyer_team_id));
  IF NOT public.market_beta_mode_2176() OR public.market_scope_2176(p_buyer_team_id,NULL) THEN
  v_buyer_count := v_buyer_count + (SELECT count(*) FROM public.auctions a
    WHERE a.status IN ('active','extended') AND a.current_bidder_id=p_buyer_team_id);
  END IF;
  IF v_buyer_count + 1 > p_max_riders THEN
    RETURN jsonb_build_object('status','squad_full','max_riders',p_max_riders);
  END IF;

  -- Preserve omitted versus explicit-null patch fields and UPDATE OF semantics.
  v_assignments := CASE WHEN p_defer_registration THEN 'pending_team_id=$2, updated_at=$3'
    ELSE 'team_id=$2, pending_team_id=NULL, acquired_at=$3' END;
  SELECT string_agg(format('%1$I=p.%1$I', k), ', ' ORDER BY k) INTO v_contract_assignments
    FROM jsonb_object_keys(p_acquire_patch) k;
  IF v_contract_assignments IS NOT NULL THEN
    v_assignments := v_assignments || ', ' || v_contract_assignments;
  END IF;
  EXECUTE 'UPDATE public.riders r SET ' || v_assignments ||
    ' FROM jsonb_populate_record(NULL::public.riders,$1) p WHERE r.id=$4'
    USING p_acquire_patch, p_buyer_team_id, p_now, r.id;
  RETURN jsonb_build_object('status','claimed','rider_id',r.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_accept_claim_transfer_at_price(
  p_rider_id uuid,p_seller_team_id uuid,p_buyer_team_id uuid,p_defer_registration boolean,
  p_now timestamptz,p_acquire_patch jsonb,p_min_seller_riders integer,p_seller_at_risk_rider_ids uuid[],p_max_riders integer,p_price bigint
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE v_issue jsonb; v_balance bigint;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'invalid transfer price' USING ERRCODE='22023'; END IF;
  v_issue := public.auto_accept_direct_price_issue(p_rider_id,p_seller_team_id,p_buyer_team_id,p_price);
  IF v_issue IS NOT NULL THEN RETURN v_issue; END IF;
  IF public.market_transport_2176() THEN
    -- Holdlaasen holdes til transaktionens slut; et samtidigt startbud venter paa den.
    PERFORM public.auto_accept_lock_teams(p_seller_team_id,p_buyer_team_id);
    SELECT balance INTO v_balance FROM public.teams WHERE id=p_buyer_team_id;
    IF public.market_scope_2176(p_buyer_team_id,NULL) AND coalesce(v_balance,0) - public.team_market_commitment(p_buyer_team_id, NULL) < p_price THEN
      RETURN jsonb_build_object('status','buyer_insufficient_balance');
    END IF;
  END IF;
  RETURN public.auto_accept_claim_transfer(p_rider_id,p_seller_team_id,p_buyer_team_id,p_defer_registration,
    p_now,p_acquire_patch,p_min_seller_riders,p_seller_at_risk_rider_ids,p_max_riders);
END; $$;

CREATE OR REPLACE FUNCTION public.auto_accept_claim_transfer_paid(
  p_rider_id uuid,p_seller_team_id uuid,p_buyer_team_id uuid,p_defer_registration boolean,
  p_now timestamptz,p_acquire_patch jsonb,p_min_seller_riders integer,p_seller_at_risk_rider_ids uuid[],
  p_max_riders integer,p_price bigint,p_deal_id uuid,p_buyer_payload jsonb,p_seller_payload jsonb,
  p_rider_restore jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE v_claim jsonb; v_hold jsonb;
BEGIN
  -- Same lock order as the existing claim, auction gates and escrow functions.
  PERFORM public.auto_accept_lock_teams(p_seller_team_id,p_buyer_team_id);
  IF NOT public.market_transport_2176() THEN
    RETURN public.auto_accept_claim_transfer_at_price(p_rider_id,p_seller_team_id,p_buyer_team_id,
      p_defer_registration,p_now,p_acquire_patch,p_min_seller_riders,p_seller_at_risk_rider_ids,p_max_riders,p_price);
  END IF;

  IF p_deal_id IS NULL OR p_price IS NULL OR p_price <= 0
     OR p_buyer_payload->>'type' IS DISTINCT FROM 'transfer_out'
     OR p_seller_payload->>'type' IS DISTINCT FROM 'transfer_in'
     OR p_buyer_payload->>'idempotency_key' IS DISTINCT FROM 'transfer_buyer:'||p_deal_id::text
     OR p_seller_payload->>'idempotency_key' IS DISTINCT FROM 'transfer_seller:'||p_deal_id::text
     OR (p_buyer_payload->>'amount')::bigint IS DISTINCT FROM -p_price
     OR (p_seller_payload->>'amount')::bigint IS DISTINCT FROM p_price THEN
    RAISE EXCEPTION 'auto_accept_claim_transfer_paid: invalid payment' USING ERRCODE='22023';
  END IF;
  -- Never revive a refunded deal or reuse a partially paid legacy deal. These
  -- checks are under the same locks as settle_sale_escrow and finance writes.
  IF EXISTS (SELECT 1 FROM public.sale_escrows WHERE deal_type='transfer' AND deal_id=p_deal_id)
     OR EXISTS (SELECT 1 FROM public.finance_transactions WHERE idempotency_key IN
       ('transfer_buyer:'||p_deal_id::text,'transfer_seller:'||p_deal_id::text)) THEN
    RETURN jsonb_build_object('status','rider_state_changed');
  END IF;

  v_claim := public.auto_accept_claim_transfer_at_price(p_rider_id,p_seller_team_id,p_buyer_team_id,
    p_defer_registration,p_now,p_acquire_patch,p_min_seller_riders,p_seller_at_risk_rider_ids,p_max_riders,p_price);
  IF v_claim->>'status' IS DISTINCT FROM 'claimed' THEN RETURN v_claim; END IF;

  IF p_defer_registration AND EXISTS (SELECT 1 FROM public.app_config
      WHERE key='sale_escrow_enabled' AND value IN ('"on"'::jsonb,'true'::jsonb)) THEN
    v_hold := public.hold_sale_escrow('transfer',p_deal_id,p_buyer_team_id,p_seller_team_id,p_price,
      ARRAY[p_rider_id],ARRAY[p_buyer_team_id],p_buyer_payload,p_seller_payload,coalesce(p_rider_restore,'{}'::jsonb));
    IF v_hold->>'status' IS DISTINCT FROM 'held' THEN
      RAISE EXCEPTION 'auto_accept_claim_transfer_paid: escrow failed (%)',v_hold->>'status';
    END IF;
  ELSE
    PERFORM public.increment_balance_with_audit(p_buyer_team_id,-p_price,p_buyer_payload);
    PERFORM public.increment_balance_with_audit(p_seller_team_id,p_price,p_seller_payload);
  END IF;
  RETURN v_claim || jsonb_build_object('payment_handled',true);
END; $$;

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
  IF EXISTS(SELECT 1 FROM app_config WHERE key='auto_accept_enabled' AND value='"beta"'::jsonb)
    AND (NOT public.auto_accept_pair_2176(v_seller,p_buyer_team_id) OR NOT public.market_transport_2176())
    THEN RETURN jsonb_build_object('status','disabled'); END IF;
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
  v_seller_outgoing_ids := public.auto_accept_outgoing_2176(v_seller, r.id, 'auto_accept');
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

-- Recheck typed discretionary debits inside the existing balance transaction.
-- Wages/upkeep and other mandatory ledger effects deliberately retain policy.
CREATE OR REPLACE FUNCTION public.market_discretionary_finance_guard_2176()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_balance bigint; v_locked bigint;
BEGIN
 IF NOT public.market_beta_mode_2176() OR NEW.amount>=0 THEN RETURN NEW; END IF;
 -- Youth-auction settlement shares academy_signing with optional intake. It
 -- pays an existing obligation; applying the purchase guard would count that
 -- same auction twice and could reject payment after senior placement.
 IF NEW.type='academy_signing' AND NEW.reason_code='auction_winner_payment'
    AND NEW.related_entity_type='auction' THEN RETURN NEW; END IF;
 IF NOT (NEW.type IN ('facility_purchase','scout_travel','staff_severance','academy_signing')
     OR coalesce(NEW.reason_code,'') IN ('transfer_purchase','swap_cash_delta','rider_release_buyout')) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text,0));
 IF NOT public.market_scope_2176(NEW.team_id,NULL) THEN RETURN NEW; END IF;
 SELECT balance INTO v_balance FROM teams WHERE id=NEW.team_id;
 v_locked:=public.team_market_commitment(NEW.team_id,NULL);
 IF v_locked>0 AND v_balance<v_locked THEN
   RAISE EXCEPTION 'market_gate_6181:insufficient_available_balance' USING ERRCODE='P0001',
     DETAIL=jsonb_build_object('available',greatest(coalesce(NEW.before_balance,v_balance-NEW.amount)-v_locked,0),'locked',v_locked)::text;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.market_discretionary_finance_guard_2176() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS market_discretionary_finance_guard_2176 ON public.finance_transactions;
CREATE TRIGGER market_discretionary_finance_guard_2176 BEFORE INSERT ON public.finance_transactions
 FOR EACH ROW EXECUTE FUNCTION public.market_discretionary_finance_guard_2176();

-- Beta releases include the fee in the ownership transaction. Academy release
-- keeps its existing no-senior-floor policy and exact contract reset.
CREATE OR REPLACE FUNCTION public.auto_accept_release_paid_2176(
 p_rider_id uuid,p_team_id uuid,p_min_riders integer,p_at_risk_rider_ids uuid[],
 p_academy boolean,p_fee bigint,p_finance_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE r public.riders; v_result jsonb; v_balance bigint; v_locked bigint:=0;
BEGIN
 IF NOT public.market_beta_mode_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
 IF p_fee IS NULL OR p_fee<0 OR p_academy IS NULL THEN RAISE EXCEPTION 'invalid release payment' USING ERRCODE='22023'; END IF;
 IF p_fee>0 AND (p_finance_payload->>'type' IS DISTINCT FROM 'transfer_out'
   OR (p_finance_payload->>'amount')::bigint IS DISTINCT FROM -p_fee
   OR p_finance_payload->>'reason_code' IS DISTINCT FROM 'rider_release_buyout') THEN
   RAISE EXCEPTION 'invalid release audit' USING ERRCODE='22023';
 END IF;
 PERFORM public.auto_accept_lock_teams(p_team_id,p_team_id);
 SELECT * INTO r FROM riders WHERE id=p_rider_id FOR UPDATE;
 IF NOT FOUND OR r.team_id IS DISTINCT FROM p_team_id OR r.pending_team_id IS NOT NULL
    OR r.is_academy IS DISTINCT FROM p_academy THEN RETURN jsonb_build_object('status','rider_state_changed'); END IF;
 IF EXISTS(SELECT 1 FROM auctions WHERE rider_id=p_rider_id AND status IN ('active','extended')) THEN
   RETURN jsonb_build_object('status','rider_on_auction');
 END IF;
 SELECT balance INTO v_balance FROM teams WHERE id=p_team_id;
 IF v_balance<p_fee THEN RETURN jsonb_build_object('status','cannot_afford_release','balance',v_balance,'fee',p_fee); END IF;
 IF public.market_scope_2176(p_team_id,NULL) THEN v_locked:=public.team_market_commitment(p_team_id,NULL); END IF;
 IF v_balance-v_locked<p_fee THEN RETURN jsonb_build_object('status','insufficient_available_balance',
   'available',greatest(v_balance-v_locked,0),'locked',v_locked,'fee',p_fee); END IF;
 IF p_academy THEN
   UPDATE riders SET team_id=NULL,pending_team_id=NULL,is_academy=false,salary=NULL,
     contract_length=NULL,contract_end_season=NULL,acquired_at=NULL WHERE id=r.id;
   v_result:=jsonb_build_object('status','released','rider_id',r.id);
 ELSE
   v_result:=public.auto_accept_release_rider(p_rider_id,p_team_id,p_min_riders,p_at_risk_rider_ids);
 END IF;
 IF v_result->>'status' IS DISTINCT FROM 'released' THEN RETURN v_result; END IF;
 IF p_fee>0 THEN PERFORM public.increment_balance_with_audit(p_team_id,-p_fee,p_finance_payload); END IF;
 RETURN v_result||jsonb_build_object('payment_handled',true);
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_release_paid_2176(uuid,uuid,integer,uuid[],boolean,bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_accept_claim_swap_paid(
 p_offered_rider_id uuid,p_requested_rider_id uuid,p_proposing_team_id uuid,p_receiving_team_id uuid,
 p_defer_registration boolean,p_now timestamptz,p_offered_patch jsonb,p_requested_patch jsonb,
 p_deal_id uuid,p_cash bigint,p_payment jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_claim jsonb; v_amount bigint; v_payer uuid; v_payee uuid; v_balance bigint; v_locked bigint;
 v_payer_payload jsonb; v_payee_payload jsonb; v_hold jsonb; v_team uuid; v_message text; v_detail text;
BEGIN
 IF NOT public.market_beta_mode_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
 IF p_cash IS NULL OR p_deal_id IS NULL THEN RAISE EXCEPTION 'invalid swap payment' USING ERRCODE='22023'; END IF;
 PERFORM public.auto_accept_lock_teams(p_proposing_team_id,p_receiving_team_id);
 v_amount:=abs(p_cash);
 IF v_amount>0 THEN
   v_payer:=CASE WHEN p_cash>0 THEN p_proposing_team_id ELSE p_receiving_team_id END;
   v_payee:=CASE WHEN p_cash>0 THEN p_receiving_team_id ELSE p_proposing_team_id END;
   v_payer_payload:=p_payment->'payer_payload'; v_payee_payload:=p_payment->'payee_payload';
   IF (p_payment->>'payer_team_id')::uuid IS DISTINCT FROM v_payer
     OR (p_payment->>'payee_team_id')::uuid IS DISTINCT FROM v_payee
     OR (p_payment->>'amount')::bigint IS DISTINCT FROM v_amount
     OR v_payer_payload->>'type' IS DISTINCT FROM 'transfer_out' OR v_payee_payload->>'type' IS DISTINCT FROM 'transfer_in'
     OR (v_payer_payload->>'amount')::bigint IS DISTINCT FROM -v_amount OR (v_payee_payload->>'amount')::bigint IS DISTINCT FROM v_amount
     OR v_payer_payload->>'idempotency_key' IS DISTINCT FROM 'swap_payer:'||p_deal_id::text
     OR v_payee_payload->>'idempotency_key' IS DISTINCT FROM 'swap_receiver:'||p_deal_id::text THEN
     RAISE EXCEPTION 'invalid swap audit' USING ERRCODE='22023';
   END IF;
   IF EXISTS(SELECT 1 FROM sale_escrows WHERE deal_type='swap' AND deal_id=p_deal_id)
     OR EXISTS(SELECT 1 FROM finance_transactions WHERE idempotency_key IN ('swap_payer:'||p_deal_id::text,'swap_receiver:'||p_deal_id::text)) THEN
     RETURN jsonb_build_object('status','rider_state_changed');
   END IF;
   IF public.market_scope_2176(v_payer,NULL) THEN
     SELECT balance INTO v_balance FROM teams WHERE id=v_payer;
     v_locked:=public.team_market_commitment(v_payer,NULL);
     IF coalesce(v_balance,0)-v_locked<v_amount THEN RETURN jsonb_build_object('status','payer_insufficient_balance','payer_team_id',v_payer); END IF;
   END IF;
 END IF;
 BEGIN
   v_claim:=public.auto_accept_claim_swap(p_offered_rider_id,p_requested_rider_id,p_proposing_team_id,p_receiving_team_id,
     p_defer_registration,p_now,p_offered_patch,p_requested_patch);
   IF v_claim->>'status' IS DISTINCT FROM 'claimed' THEN RETURN v_claim; END IF;
   FOREACH v_team IN ARRAY ARRAY[p_proposing_team_id,p_receiving_team_id] LOOP
     IF public.market_scope_2176(v_team,NULL) AND public.team_seat_commitment(v_team,NULL)>public.market_squad_max() THEN
       RAISE EXCEPTION 'market_beta_2176:swap_squad_full' USING ERRCODE='P0001',DETAIL=v_team::text;
     END IF;
   END LOOP;
   IF v_amount>0 THEN
     IF p_defer_registration AND EXISTS(SELECT 1 FROM app_config WHERE key='sale_escrow_enabled' AND value IN ('"on"'::jsonb,'true'::jsonb)) THEN
       v_hold:=public.hold_sale_escrow('swap',p_deal_id,v_payer,v_payee,v_amount,
         ARRAY[p_offered_rider_id,p_requested_rider_id],ARRAY[p_receiving_team_id,p_proposing_team_id],
         v_payer_payload,v_payee_payload,coalesce(p_payment->'rider_restore','{}'::jsonb));
       IF v_hold->>'status' IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'swap escrow failed (%)',v_hold->>'status'; END IF;
     ELSE
       PERFORM public.increment_balance_with_audit(v_payer,-v_amount,v_payer_payload);
       PERFORM public.increment_balance_with_audit(v_payee,v_amount,v_payee_payload);
     END IF;
   END IF;
   RETURN v_claim||jsonb_build_object('payment_handled',true);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT,v_detail=PG_EXCEPTION_DETAIL;
   IF v_message='market_beta_2176:swap_squad_full' THEN
     RETURN jsonb_build_object('status','swap_squad_full','team_id',v_detail,'max_riders',public.market_squad_max());
   END IF;
   RAISE;
 END;
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_swap_paid(uuid,uuid,uuid,uuid,boolean,timestamptz,jsonb,jsonb,uuid,bigint,jsonb) TO service_role;

-- The assignment and its existing travel debit share one transaction. Other
-- business eligibility checks/candidate generation stay in their existing code.
CREATE OR REPLACE FUNCTION public.market_scout_assignment_2176(p_team_id uuid,p_assignment jsonb,p_finance_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE v_cost bigint; v public.scout_assignments;
BEGIN
 IF NOT public.market_beta_mode_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
 v_cost:=(p_assignment->>'travel_cost')::bigint;
 IF p_team_id IS NULL OR (p_assignment->>'team_id')::uuid IS DISTINCT FROM p_team_id OR v_cost IS NULL OR v_cost<0
   OR p_finance_payload->>'type' IS DISTINCT FROM 'scout_travel'
   OR (p_finance_payload->>'amount')::bigint IS DISTINCT FROM -v_cost
   OR p_finance_payload->>'reason_code' IS DISTINCT FROM 'scout_travel'
   OR coalesce(p_finance_payload->>'source_path','') NOT IN ('scoutAssignmentService.startTargetAssignment','scoutAssignmentService.startMission') THEN
   RAISE EXCEPTION 'invalid scouting payment' USING ERRCODE='22023';
 END IF;
 PERFORM public.auto_accept_lock_teams(p_team_id,p_team_id);
 INSERT INTO scout_assignments(team_id,staff_id,kind,rider_id,target_level,mission_criteria,travel_cost,started_on,ready_on,season_id)
 VALUES(p_team_id,(p_assignment->>'staff_id')::uuid,p_assignment->>'kind',(p_assignment->>'rider_id')::uuid,
   (p_assignment->>'target_level')::smallint,p_assignment->'mission_criteria',v_cost,(p_assignment->>'started_on')::date,
   (p_assignment->>'ready_on')::date,(p_assignment->>'season_id')::uuid) RETURNING * INTO v;
 PERFORM public.increment_balance_with_audit(p_team_id,-v_cost,p_finance_payload||jsonb_build_object('idempotency_key','scout_travel:'||p_team_id::text||':'||v.id::text));
 RETURN jsonb_build_object('status','created','assignment',jsonb_build_object('id',v.id,'created_at',v.created_at),'skipped',false);
END; $$;
REVOKE ALL ON FUNCTION public.market_scout_assignment_2176(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_scout_assignment_2176(uuid,jsonb,jsonb) TO service_role;


-- The beta transaction envelope also covers ordinary creation: first public
-- participation may race with a seller operation before its scope is visible.
CREATE OR REPLACE FUNCTION public.create_market_auction_2176(
 p_auction jsonb,p_expected_owner uuid,p_min_riders integer,p_at_risk_rider_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE r public.riders; a public.auctions; v_seller uuid:=(p_auction->>'seller_team_id')::uuid;
 v_count integer; v_risk integer; v_outgoing uuid[];
BEGIN
 IF NOT public.market_beta_mode_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
 PERFORM public.auto_accept_lock_teams(v_seller,coalesce(p_expected_owner,v_seller));
 SELECT * INTO r FROM riders WHERE id=(p_auction->>'rider_id')::uuid FOR UPDATE;
 IF NOT FOUND OR r.team_id IS DISTINCT FROM p_expected_owner OR r.pending_team_id IS NOT NULL THEN
   RETURN jsonb_build_object('status','rider_state_changed'); END IF;
 IF r.team_id=v_seller AND public.market_scope_2176(v_seller,NULL) THEN
   SELECT count(*) INTO v_count FROM riders x WHERE x.squad='senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired,false)
    AND ((x.team_id=v_seller AND (x.pending_team_id IS NULL OR x.pending_team_id=v_seller))
      OR (x.pending_team_id=v_seller AND x.team_id IS DISTINCT FROM v_seller));
   v_outgoing:=public.auto_accept_seller_outgoing_rider_ids(v_seller,r.id);
   SELECT count(*) INTO v_risk FROM riders x WHERE x.id=ANY(coalesce(p_at_risk_rider_ids,'{}')) AND x.id<>r.id
     AND x.team_id=v_seller AND x.pending_team_id IS NULL AND NOT(x.id=ANY(v_outgoing));
   IF v_count-1-cardinality(v_outgoing)-v_risk<p_min_riders THEN
     RETURN jsonb_build_object('status','seller_squad_floor','min_riders',p_min_riders); END IF;
 END IF;
 INSERT INTO auctions(rider_id,seller_team_id,starting_price,current_price,current_bidder_id,min_increment,calculated_end,is_flash)
 VALUES(r.id,v_seller,(p_auction->>'starting_price')::integer,(p_auction->>'current_price')::integer,
   (p_auction->>'current_bidder_id')::uuid,(p_auction->>'min_increment')::integer,
   (p_auction->>'calculated_end')::timestamptz,(p_auction->>'is_flash')::boolean) RETURNING * INTO a;
 RETURN jsonb_build_object('status','created','auction',to_jsonb(a));
END; $$;
REVOKE ALL ON FUNCTION public.create_market_auction_2176(jsonb,uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_market_auction_2176(jsonb,uuid,integer,uuid[]) TO service_role;

-- Repeat ACLs in this replacement migration as well as retaining the deployed
-- signatures. Trigger functions are never directly callable by API roles.
REVOKE ALL ON FUNCTION public.market_commitment_6181_bid_gate() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_start_gate() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_proxy_gate() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.auto_accept_offer_boundary_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.auto_accept_seller_outgoing_rider_ids(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_seller_outgoing_rider_ids(uuid,uuid) TO service_role;

-- Signed-in clients read ordinary listing fields directly. Auto-prices are projected by
-- the server for the current viewer; an RLS row policy cannot hide a column.
REVOKE SELECT ON public.transfer_listings FROM PUBLIC,anon,authenticated;
REVOKE SELECT(id,rider_id,seller_team_id,asking_price,status,created_at,auto_accept_price)
 ON public.transfer_listings FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,rider_id,seller_team_id,asking_price,status,created_at)
 ON public.transfer_listings TO authenticated;
GRANT SELECT ON public.transfer_listings TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
