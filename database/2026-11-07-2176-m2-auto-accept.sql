-- #2176 + #6181 · Auto-accept M2: saelgers auto-pris paa en listing, prislog til
-- fair-play, auktionens oprindelse og RPC'erne der saetter prisen og starter
-- auktionen. Koden kalder dem kun bag flaget auto_accept_enabled (ejer-go kraeves
-- til flippet). Ingen UI i denne PR (PR 7).
--
-- Ejer-beslutninger (#2176, 6/11 og 7/11):
--   - Saelger kan saette en auto-pris Y over listeprisen X. Prisen er synlig for alle.
--   - Direkte bud under Y bevares og forhandles som i dag. Et bud paa Y eller
--     derover starter i stedet en aaben auktion, hvor andre kan byde med.
--   - Koeberen vaelger laengden frit mellem 30 min og 24 t AKTIV tid (08-24), med
--     praecist sluttidspunkt. Sluttidspunktet regnes i backend med
--     calculateAuctionEnd og sendes ind; flash-stien bruges aldrig.
--   - Det skal vaere umuligt at starte en auktion uden penge eller plads: det
--     foerende bud reserverer pengene og pladsen.
--   - En prisaendring gaelder kun nye bud, og alt logges til fair-play.
--   - Saelgers aktive auktioner taeller som udgaaende, saa han ikke kan saelge sig
--     under loebsgulvet og faa auktionen annulleret ved slut.
--
-- Dele:
--   1. transfer_listings.auto_accept_price (bigint, NULL = ingen auto-pris) med
--      CHECK: Y > X og inden for auktionernes heltalsomraade.
--   2. transfer_listing_price_log: en raekke pr. prisaendring paa en listing med
--      auto-pris (Y sat/aendret/fjernet, eller X aendret mens Y findes). Skrives
--      af en trigger, saa ingen sti kan aendre prisen uden spor. Listings uden
--      auto-pris logges ikke (slukket flag = ingen nye raekker).
--   3. Vagt-trigger: anon/authenticated maa aldrig selv aendre auto_accept_price
--      (RLS-politikken "Owners can update listings" ville ellers tillade det uden
--      om backendens tjek og prislog-aktoeren).
--   4. auctions.origin ('standard' | 'auto_accept'), source_listing_id og
--      buyer_duration_minutes (30-1440) med en form-CHECK: en auto-accept-auktion
--      har altid begge, en almindelig auktion har ingen af dem.
--   5. public.set_listing_auto_accept_price(...): saelger saetter/aendrer/fjerner Y.
--      Kraever den pris, klienten saa (p_expected_price); forskel giver
--      'price_changed' (backend: 409).
--   6. public.start_auto_accept_auction(...): i EEN transaktion under holdlaase
--      (samme noegle som increment_balance_with_audit) tjekkes listing, pris,
--      rytter, koeberens penge og plads samt saelgers gulv; saa oprettes auktion
--      og foerende bud, og listingen saettes paa pause (#4211-reglen).
--
-- Laaseraekkefoelge (deadlock-fri, samme som M1 og de eksisterende RPC'er):
-- holdlaase (pg_advisory_xact_lock paa begge hold i fast raekkefoelge), saa
-- rytter-raekken, saa listing-raekken. set_listing_auto_accept_price tager
-- saelgerens holdlaas og saa listing-raekken.
--
-- Afhaenger IKKE af M1 (2026-11-07-6181-sale-escrow-m1.sql); filerne kan
-- applies i vilkaarlig raekkefoelge.
--
-- Ingen FK fra auctions.source_listing_id eller prisloggen til listings/hold med
-- vilje: beta-reset sletter hold og listings (#1471), og loggen er et
-- revisionsspor, der hverken maa blokere eller kaskade-slettes.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- Ingen eksisterende raekke aendres: nye kolonner er NULL / 'standard'.
--
-- RLS paa prisloggen: enabled, INGEN policy, kun service_role kan laese.
-- Triggeren skriver som ejer (SECURITY DEFINER).
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT count(*) FROM public.transfer_listings WHERE auto_accept_price IS NOT NULL;  -- 0
--   2. SELECT origin, count(*) FROM public.auctions GROUP BY 1;  -- kun 'standard'
--   3. SELECT count(*) FROM public.transfer_listing_price_log;  -- 0
--   4. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.transfer_listing_price_log'::regclass;  -- true
--   5. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('set_listing_auto_accept_price','start_auto_accept_auction',
--          'transfer_listing_auto_accept_guard','transfer_listing_price_log_write','auto_accept_lock_teams');
--      -- anon=false, auth=false for alle fem
--   6. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.transfer_listings'::regclass
--        AND tgname LIKE 'transfer_listings_auto_accept%';  -- 4 raekker
--   7. SELECT conname FROM pg_constraint WHERE conname IN
--        ('transfer_listings_auto_accept_price_check','auctions_origin_check','auctions_auto_accept_shape');  -- 3 raekker
--
-- Rollback (kun mens ingen listing har en auto-pris og ingen auto-accept-auktion findes):
--   DROP FUNCTION IF EXISTS public.start_auto_accept_auction(uuid, uuid, bigint, integer, timestamptz, integer, integer, uuid[], timestamptz);
--   DROP FUNCTION IF EXISTS public.set_listing_auto_accept_price(uuid, uuid, bigint, bigint, uuid);
--   DROP TRIGGER IF EXISTS transfer_listings_auto_accept_guard_ins ON public.transfer_listings;
--   DROP TRIGGER IF EXISTS transfer_listings_auto_accept_guard_upd ON public.transfer_listings;
--   DROP TRIGGER IF EXISTS transfer_listings_auto_accept_log_ins ON public.transfer_listings;
--   DROP TRIGGER IF EXISTS transfer_listings_auto_accept_log_upd ON public.transfer_listings;
--   DROP FUNCTION IF EXISTS public.transfer_listing_auto_accept_guard();
--   DROP FUNCTION IF EXISTS public.transfer_listing_price_log_write();
--   DROP FUNCTION IF EXISTS public.auto_accept_lock_teams(uuid, uuid);
--   DROP TABLE IF EXISTS public.transfer_listing_price_log;
--   ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_auto_accept_shape,
--     DROP CONSTRAINT IF EXISTS auctions_origin_check, DROP COLUMN IF EXISTS buyer_duration_minutes,
--     DROP COLUMN IF EXISTS source_listing_id, DROP COLUMN IF EXISTS origin;
--   ALTER TABLE public.transfer_listings DROP CONSTRAINT IF EXISTS transfer_listings_auto_accept_price_check,
--     DROP COLUMN IF EXISTS auto_accept_price;
--
-- Refs #2176 #6181
-- data-api-access: {"table":"public.transfer_listing_price_log","roles":{"anon":[],"authenticated":[],"service_role":["SELECT"]},"reason":"Fair-play audit trail of auto-accept price changes; written only by a SECURITY DEFINER trigger, read by the backend"}

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Auto-prisen ------------------------------------------------------------
ALTER TABLE public.transfer_listings
  ADD COLUMN IF NOT EXISTS auto_accept_price bigint;

ALTER TABLE public.transfer_listings
  DROP CONSTRAINT IF EXISTS transfer_listings_auto_accept_price_check;
ALTER TABLE public.transfer_listings
  ADD CONSTRAINT transfer_listings_auto_accept_price_check
  CHECK (auto_accept_price IS NULL
         OR (auto_accept_price > asking_price AND auto_accept_price <= 2147483647));

COMMENT ON COLUMN public.transfer_listings.auto_accept_price IS
  '#2176: seller''s auto-accept price Y (> asking_price). A bid at Y or above starts an open auction (start_auto_accept_auction); bids below Y are negotiated as before. Set only through set_listing_auto_accept_price. NULL = none.';

-- 4. Auktionens oprindelse -------------------------------------------------
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS source_listing_id uuid,
  ADD COLUMN IF NOT EXISTS buyer_duration_minutes integer;

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_origin_check;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_origin_check CHECK (origin IN ('standard', 'auto_accept'));

ALTER TABLE public.auctions DROP CONSTRAINT IF EXISTS auctions_auto_accept_shape;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_auto_accept_shape CHECK (
    CASE origin
      WHEN 'auto_accept' THEN source_listing_id IS NOT NULL
                          AND buyer_duration_minutes IS NOT NULL
                          AND buyer_duration_minutes BETWEEN 30 AND 1440
      ELSE source_listing_id IS NULL AND buyer_duration_minutes IS NULL
    END
  );

COMMENT ON COLUMN public.auctions.origin IS
  '#2176: standard | auto_accept. auto_accept = started by a buyer bidding the seller''s auto-accept price (start_auto_accept_auction).';
COMMENT ON COLUMN public.auctions.source_listing_id IS
  '#2176: the transfer listing whose auto-accept price started this auction (origin = auto_accept only).';
COMMENT ON COLUMN public.auctions.buyer_duration_minutes IS
  '#2176: active-time length (30-1440 min) the buyer chose; calculated_end was derived from it with calculateAuctionEnd.';

-- 2. Prisloggen ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transfer_listing_price_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  rider_id uuid NOT NULL,
  seller_team_id uuid NOT NULL,
  old_asking_price bigint,
  new_asking_price bigint NOT NULL,
  old_auto_accept_price bigint,
  new_auto_accept_price bigint,
  actor_user_id uuid,
  source text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfer_listing_price_log_listing_idx
  ON public.transfer_listing_price_log (listing_id, changed_at);
CREATE INDEX IF NOT EXISTS transfer_listing_price_log_seller_idx
  ON public.transfer_listing_price_log (seller_team_id, changed_at);

ALTER TABLE public.transfer_listing_price_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.transfer_listing_price_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.transfer_listing_price_log TO service_role;

COMMENT ON TABLE public.transfer_listing_price_log IS
  '#2176: fair-play log of price changes on listings with an auto-accept price. Written only by the transfer_listings trigger. service_role read only.';

-- 3. Vagt: klienten aendrer aldrig auto-prisen selv. Koerer som kalderen
-- (ikke SECURITY DEFINER), saa current_user er den rolle PostgREST bruger.
CREATE OR REPLACE FUNCTION public.transfer_listing_auto_accept_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'auto_accept_price can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfer_listings_auto_accept_guard_ins ON public.transfer_listings;
CREATE TRIGGER transfer_listings_auto_accept_guard_ins
  BEFORE INSERT ON public.transfer_listings
  FOR EACH ROW
  WHEN (NEW.auto_accept_price IS NOT NULL)
  EXECUTE FUNCTION public.transfer_listing_auto_accept_guard();

DROP TRIGGER IF EXISTS transfer_listings_auto_accept_guard_upd ON public.transfer_listings;
CREATE TRIGGER transfer_listings_auto_accept_guard_upd
  BEFORE UPDATE OF auto_accept_price ON public.transfer_listings
  FOR EACH ROW
  WHEN (OLD.auto_accept_price IS DISTINCT FROM NEW.auto_accept_price)
  EXECUTE FUNCTION public.transfer_listing_auto_accept_guard();

-- Loggen skrives efter raekken er gemt. Aktoer og kilde saettes af RPC'en med
-- set_config(..., true) (gaelder kun transaktionen); andre stier logges med
-- kilden 'listing_update' og uden aktoer.
CREATE OR REPLACE FUNCTION public.transfer_listing_price_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor text := nullif(current_setting('cz.auto_accept_actor', true), '');
  v_source text := coalesce(nullif(current_setting('cz.auto_accept_source', true), ''), 'listing_update');
BEGIN
  INSERT INTO public.transfer_listing_price_log (
    listing_id, rider_id, seller_team_id,
    old_asking_price, new_asking_price, old_auto_accept_price, new_auto_accept_price,
    actor_user_id, source)
  VALUES (
    NEW.id, NEW.rider_id, NEW.seller_team_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.asking_price END, NEW.asking_price,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.auto_accept_price END, NEW.auto_accept_price,
    v_actor::uuid, v_source);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS transfer_listings_auto_accept_log_ins ON public.transfer_listings;
CREATE TRIGGER transfer_listings_auto_accept_log_ins
  AFTER INSERT ON public.transfer_listings
  FOR EACH ROW
  WHEN (NEW.auto_accept_price IS NOT NULL)
  EXECUTE FUNCTION public.transfer_listing_price_log_write();

DROP TRIGGER IF EXISTS transfer_listings_auto_accept_log_upd ON public.transfer_listings;
CREATE TRIGGER transfer_listings_auto_accept_log_upd
  AFTER UPDATE OF asking_price, auto_accept_price ON public.transfer_listings
  FOR EACH ROW
  WHEN (OLD.auto_accept_price IS DISTINCT FROM NEW.auto_accept_price
        OR (NEW.auto_accept_price IS NOT NULL AND OLD.asking_price IS DISTINCT FROM NEW.asking_price))
  EXECUTE FUNCTION public.transfer_listing_price_log_write();

-- Holdlaase i fast raekkefoelge. Samme noegle som increment_balance_with_audit,
-- saa en start serialiseres med enhver anden pengebevaegelse paa begge hold.
CREATE OR REPLACE FUNCTION public.auto_accept_lock_teams(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(least(p_a, p_b)::text, 0));
  IF p_a IS DISTINCT FROM p_b THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(greatest(p_a, p_b)::text, 0));
  END IF;
END;
$$;

-- 5. Saelger saetter, aendrer eller fjerner Y -------------------------------
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
  -- Prisen klienten saa. NULL betyder "ingen auto-pris".
  IF l.auto_accept_price IS DISTINCT FROM p_expected_price THEN
    RETURN jsonb_build_object('status', 'price_changed', 'auto_accept_price', l.auto_accept_price);
  END IF;
  IF p_price IS NOT DISTINCT FROM l.auto_accept_price THEN
    RETURN jsonb_build_object('status', 'unchanged', 'auto_accept_price', l.auto_accept_price);
  END IF;
  IF p_price IS NOT NULL THEN
    IF p_price <= l.asking_price THEN
      RETURN jsonb_build_object('status', 'not_above_asking', 'asking_price', l.asking_price);
    END IF;
    IF p_price > 2147483647 THEN
      RETURN jsonb_build_object('status', 'price_too_high');
    END IF;
    -- En akademirytter kan ikke saettes paa auktion; en auto-pris ville vaere tom.
    SELECT r.is_academy INTO v_academy FROM public.riders r WHERE r.id = l.rider_id;
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

-- 6. Koeberen byder Y og starter auktionen ---------------------------------
-- Tilstandskonflikter returneres som status; programmeringsfejl kastes.
-- p_calculated_end er regnet af backend (calculateAuctionEnd, aktiv tid);
-- RPC'en tjekker kun, at det er plausibelt for den valgte laengde.
-- p_max_riders = koeberens trup-loft, p_min_seller_riders = loebsgulvet,
-- p_seller_at_risk_rider_ids = saelgers ryttere, der forlader holdet af sig selv
-- ved naeste saesonskifte (squadRiskGuard), uden rytteren her.
CREATE OR REPLACE FUNCTION public.start_auto_accept_auction(
  p_listing_id uuid,
  p_buyer_team_id uuid,
  p_expected_price bigint,
  p_duration_minutes integer,
  p_calculated_end timestamptz,
  p_max_riders integer,
  p_min_seller_riders integer,
  p_seller_at_risk_rider_ids uuid[] DEFAULT '{}',
  p_now timestamptz DEFAULT now()
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
  v_auction_id uuid;
BEGIN
  IF p_listing_id IS NULL OR p_buyer_team_id IS NULL OR p_expected_price IS NULL
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
  v_price := l.auto_accept_price;

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
  SELECT count(*) INTO v_seller_out
    FROM public.auctions a
    JOIN public.riders x ON x.id = a.rider_id
   WHERE a.status IN ('active', 'extended')
     AND x.team_id = v_seller AND x.pending_team_id IS NULL
     AND x.squad = 'senior' AND NOT x.is_academy AND NOT coalesce(x.is_retired, false)
     AND a.current_bidder_id IS NOT NULL AND a.current_bidder_id <> v_seller
     AND x.id <> r.id;
  SELECT count(*) INTO v_seller_risk
    FROM public.riders x
   WHERE x.id = ANY (coalesce(p_seller_at_risk_rider_ids, '{}'))
     AND x.id <> r.id AND x.team_id = v_seller AND x.pending_team_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.auctions a
                      WHERE a.rider_id = x.id AND a.status IN ('active', 'extended')
                        AND a.current_bidder_id IS NOT NULL AND a.current_bidder_id <> v_seller);
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

REVOKE ALL ON FUNCTION public.transfer_listing_auto_accept_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transfer_listing_price_log_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.auto_accept_lock_teams(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_lock_teams(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.set_listing_auto_accept_price(uuid, uuid, bigint, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_listing_auto_accept_price(uuid, uuid, bigint, bigint, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.start_auto_accept_auction(uuid, uuid, bigint, integer, timestamptz, integer, integer, uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_auto_accept_auction(uuid, uuid, bigint, integer, timestamptz, integer, integer, uuid[], timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
