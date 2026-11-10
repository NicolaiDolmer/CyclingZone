-- #2176 + #6181 · Dommer-fund 10/11 (backend):
--
--   1. Ejer 10/11: auto-prisen Y maa vaere LIG listeprisen X (Y >= X, foer Y > X).
--      CHECK paa transfer_listings.auto_accept_price og set_listing_auto_accept_price
--      folger med. Ny status 'below_asking' (backend kender ogsaa den gamle
--      'not_above_asking', saa raekkefoelgen af deploy og apply er ligegyldig).
--      En lempelse: eksisterende raekker opfylder allerede den nye regel.
--   2. Direkte koeb og auktionsstart i samme splitsekund: transfer-claimet under
--      holdlaasen (auto_accept_claim_transfer_at_price) tjekker nu ogsaa koeberens
--      disponible saldo (saldo minus team_market_commitment), naar pengelaasen
--      (market_commitment_6181) er taendt. Samme holdlaas-noegle som M3-gatens
--      bud-/start-triggere, saa et samtidigt startbud og claimet ser hinanden.
--      Slukket pengelaas = uaendret (kontakten laeses foer M3-funktionen kaldes,
--      saa filen ogsaa virker uden M3). Betalingen foelger stadig efter claimet i JS.
--
-- Idempotent (DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE), ikke-destruktiv.
-- Lokal verifikation: autoAccept2176Autopris.pglite.test.js. Applies post-merge (#2642).
--
-- Rollback (kun mens ingen listing har auto_accept_price = asking_price):
--   ALTER TABLE public.transfer_listings DROP CONSTRAINT IF EXISTS transfer_listings_auto_accept_price_check;
--   ALTER TABLE public.transfer_listings ADD CONSTRAINT transfer_listings_auto_accept_price_check
--     CHECK (auto_accept_price IS NULL OR (auto_accept_price > asking_price AND auto_accept_price <= 2147483647));
--   og genkoer funktionerne fra 2026-11-07-2176-m2-auto-accept.sql og
--   2026-11-09-2176-counter-auction-boundary.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Y >= X -----------------------------------------------------------------
ALTER TABLE public.transfer_listings
  DROP CONSTRAINT IF EXISTS transfer_listings_auto_accept_price_check;
ALTER TABLE public.transfer_listings
  ADD CONSTRAINT transfer_listings_auto_accept_price_check
  CHECK (auto_accept_price IS NULL
         OR (auto_accept_price >= asking_price AND auto_accept_price <= 2147483647));

COMMENT ON COLUMN public.transfer_listings.auto_accept_price IS
  '#2176: seller''s auto-accept price Y (>= asking_price, owner 10/11). A bid at Y or above starts an open auction (start_auto_accept_auction_bid); bids below Y are negotiated as before. Set only through set_listing_auto_accept_price. NULL = none.';

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
REVOKE ALL ON FUNCTION public.set_listing_auto_accept_price(uuid, uuid, bigint, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_listing_auto_accept_price(uuid, uuid, bigint, bigint, uuid) TO service_role;

-- 2. Koeberens penge under holdlaasen ----------------------------------------
CREATE OR REPLACE FUNCTION public.auto_accept_claim_transfer_at_price(
  p_rider_id uuid,p_seller_team_id uuid,p_buyer_team_id uuid,p_defer_registration boolean,
  p_now timestamptz,p_acquire_patch jsonb,p_min_seller_riders integer,p_seller_at_risk_rider_ids uuid[],p_max_riders integer,p_price bigint
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public,pg_catalog AS $$
DECLARE v_issue jsonb; v_balance bigint;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'invalid transfer price' USING ERRCODE='22023'; END IF;
  v_issue := public.auto_accept_direct_price_issue(p_rider_id,p_seller_team_id,p_buyer_team_id,p_price);
  IF v_issue IS NOT NULL THEN RETURN v_issue; END IF;
  IF EXISTS (SELECT 1 FROM public.app_config WHERE key='market_commitment_6181'
             AND value IN ('"on"'::jsonb,'true'::jsonb)) THEN
    -- Holdlaasen holdes til transaktionens slut; et samtidigt startbud venter paa den.
    PERFORM public.auto_accept_lock_teams(p_seller_team_id,p_buyer_team_id);
    SELECT balance INTO v_balance FROM public.teams WHERE id=p_buyer_team_id;
    IF coalesce(v_balance,0) - public.team_market_commitment(p_buyer_team_id, NULL) < p_price THEN
      RETURN jsonb_build_object('status','buyer_insufficient_balance');
    END IF;
  END IF;
  RETURN public.auto_accept_claim_transfer(p_rider_id,p_seller_team_id,p_buyer_team_id,p_defer_registration,
    p_now,p_acquire_patch,p_min_seller_riders,p_seller_at_risk_rider_ids,p_max_riders);
END; $$;
REVOKE ALL ON FUNCTION public.auto_accept_claim_transfer_at_price(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_transfer_at_price(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
