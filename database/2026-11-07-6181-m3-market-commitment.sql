-- #6181 + #2176 · Pengelaas M3: holdets markedsforpligtelse (penge + pladser) og
-- en atomisk bud-gate i databasen. Alt bag kontakten market_commitment_6181,
-- som oprettes 'off'. Off = triggerne returnerer med det samme: ingen laas,
-- ingen opslag, ingen aendring af nogen raekke (bit-identisk med i dag).
--
-- Problemet (ejer-beslutning 5, 7/11): en vinder maa aldrig mangle penge eller
-- plads ved auktionens slut. I dag tjekker bud-ruten og proxy-cascaden penge og
-- plads i JS og skriver bagefter i flere kald (tjek-saa-skriv). Samtidige bud
-- fra samme hold kan derfor alle passere tjekket. Den lokale PG17-baseline (6/11)
-- overbookede i hver eneste runde; samme tjek under holdlaasen gjorde det aldrig.
--
-- Dele:
--   1. market_commitment_6181_on(): laeser kontakten. Kun 'on' (eller true) taender.
--   2. market_squad_max(): senior-loftet. Skal matche MAX_SQUAD_SIZE i
--      backend/lib/marketUtils.js; marketCommitment6181.pglite.test.js vogter det.
--   3. team_market_commitment(team, udelad_auktion): worst case-forpligtelsen,
--      samme regel som computeWorstCaseCommitment (auctionRules.ts): foerende
--      auktion = max(pris, eget autobud), autobud uden foering = loftet.
--   4. team_seat_commitment(team, udelad_auktion): fremtidig senior-trup
--      (samme taelling som getTeamMarketState.future_count) + foerende auktioner.
--   5. team_outgoing_auction_count(team, udelad_rytter): holdets egne senior-
--      ryttere paa aktiv auktion. Taeller som udgaaende i saelgers gulv-tjek, saa
--      en saelger ikke kan saelge sig under gulvet og faa auktionen annulleret.
--      team_outgoing_auction_rider_ids giver de samme ryttere som id'er.
--   6. market_bid_issue_6181(...): den rene regel (NULL = ok). Bruges af triggerne
--      og af backenden som for-tjek (proxy-cascaden), saa reglen findes eet sted.
--   7. Tre BEFORE-triggere, der under holdlaasen (samme noegle som
--      increment_balance_with_audit) haandhaever reglen atomisk:
--        - auction_bids INSERT: penge + plads, pris maa ikke falde; buddet tager
--          foeringen i SAMME transaktion (current_price/current_bidder_id), saa
--          det naeste bud fra holdet ser forpligtelsen. Gatede cascader bruger
--          databasens foerer; legacy-stien synkroniserer fortsat i JS.
--        - auctions INSERT med en foerer (POST /auctions paa en fri rytter):
--          penge + plads for startbyderen.
--        - auction_proxy_bids INSERT/haevet loft: penge (autobud uden foering
--          optager ingen plads; ejer-spoergsmaal 7 er ubesvaret, og pladsen tjekkes,
--          naar autobuddet faktisk tager foeringen via auction_bids-triggeren).
--      Navnet trg_market_commitment_6181_* sorterer efter
--      reject_late_auction_bid_trigger, saa et for sent bud stadig afvises med
--      sin egen fejl foerst.
--   8. Kontakten seedes 'off' (ON CONFLICT DO NOTHING).
--   9. set_auction_proxy_6181: loft og eventuelt aabningsbud i samme transaktion.
--
-- Fejlform: RAISE 'market_gate_6181:<kode>' med ERRCODE P0001. Koder:
-- insufficient_available_balance, squad_full, price_changed.
-- backend/lib/marketCommitment6181.js oversaetter dem til de eksisterende
-- fejlkoder (ingen ny spillertekst).
--
-- Ungdomsauktioner (is_youth): pladsen tjekkes ikke i databasen, fordi en ung
-- rytter ogsaa kan gaa til akademiet (#2701/#5568), og akademiloftet afhaenger
-- af rytterens alder. Ruten tjekker stadig pladsen som i dag; pengene gates altid.
--
-- Et forsvarsbud (holdet foerer allerede auktionen) bruger ingen ny plads og
-- blokeres aldrig paa plads, kun paa penge (samme regel som #1694b).
--
-- Laaseraekkefoelge: holdlaas foerst, saa auktionsraekken. Samme som M1
-- (sale_escrow_lock_teams) og increment_balance_with_audit.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642).
-- Ingen data roeres ud over seed-raekken i app_config.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT value FROM public.app_config WHERE key = 'market_commitment_6181';  -- "off"
--   2. SELECT public.market_commitment_6181_on();  -- false
--   3. SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_market_commitment_6181_%' ORDER BY 1;  -- 3 raekker
--   4. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('team_market_commitment','team_seat_commitment',
--          'team_outgoing_auction_count','team_outgoing_auction_rider_ids','market_bid_issue_6181',
--          'market_commitment_6181_on','market_squad_max','set_auction_proxy_6181');
--      -- anon=false, auth=false for alle otte
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_auction_proxy_6181(uuid, uuid, bigint, integer, timestamptz);
--   DROP TRIGGER IF EXISTS trg_market_commitment_6181_bid ON public.auction_bids;
--   DROP TRIGGER IF EXISTS trg_market_commitment_6181_start ON public.auctions;
--   DROP TRIGGER IF EXISTS trg_market_commitment_6181_proxy ON public.auction_proxy_bids;
--   DROP FUNCTION IF EXISTS public.market_commitment_6181_bid_gate();
--   DROP FUNCTION IF EXISTS public.market_commitment_6181_start_gate();
--   DROP FUNCTION IF EXISTS public.market_commitment_6181_proxy_gate();
--   DROP FUNCTION IF EXISTS public.market_bid_issue_6181(uuid, uuid, bigint, boolean);
--   DROP FUNCTION IF EXISTS public.team_outgoing_auction_rider_ids(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.team_outgoing_auction_count(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.team_seat_commitment(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.team_market_commitment(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.market_squad_max();
--   DROP FUNCTION IF EXISTS public.market_commitment_6181_on();
--   DELETE FROM public.app_config WHERE key = 'market_commitment_6181';
--
-- Refs #6181 #2176

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.app_config (key, value, description)
VALUES (
  'market_commitment_6181',
  '"off"'::jsonb,
  'Stage flag (off|on) for #6181 PR 5: bids, auto-bids and auction starts check available money and squad room atomically under the team lock; transfer confirmation counts leading auctions; a seller''s riders on auction count as outgoing. Off = today''s market, bit-identical. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.market_commitment_6181_on()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(
    (SELECT value IN ('true'::jsonb, '"on"'::jsonb) FROM public.app_config WHERE key = 'market_commitment_6181'),
    false)
$$;

-- Senior-loftet. Samme tal som MAX_SQUAD_SIZE (marketUtils.js); testen vogter det.
CREATE OR REPLACE FUNCTION public.market_squad_max()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$ SELECT 30 $$;

CREATE OR REPLACE FUNCTION public.team_market_commitment(p_team_id uuid, p_exclude_auction_id uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(sum(
           CASE WHEN a.current_bidder_id = p_team_id
                THEN greatest(coalesce(a.current_price, 0), coalesce(p.max_amount, 0))
                ELSE coalesce(p.max_amount, 0)
           END), 0)::bigint
    FROM public.auctions a
    LEFT JOIN public.auction_proxy_bids p ON p.auction_id = a.id AND p.team_id = p_team_id
   WHERE a.status IN ('active', 'extended')
     AND (a.current_bidder_id = p_team_id OR p.team_id IS NOT NULL)
     AND (p_exclude_auction_id IS NULL OR a.id <> p_exclude_auction_id)
$$;

-- future_count = ejede - paa vej vaek + paa vej ind (senior, ikke pensioneret),
-- praecis som getTeamMarketState, plus de auktioner holdet foerer.
CREATE OR REPLACE FUNCTION public.team_seat_commitment(p_team_id uuid, p_exclude_auction_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT (
      (SELECT count(*) FROM public.riders r
        WHERE r.team_id = p_team_id AND r.squad = 'senior' AND r.is_academy = false AND r.is_retired = false)
    - (SELECT count(*) FROM public.riders r
        WHERE r.team_id = p_team_id AND r.squad = 'senior' AND r.is_academy = false AND r.is_retired = false
          AND r.pending_team_id IS NOT NULL AND r.pending_team_id <> p_team_id)
    + (SELECT count(*) FROM public.riders r
        WHERE r.pending_team_id = p_team_id AND r.squad = 'senior' AND r.is_academy = false AND r.is_retired = false)
    + (SELECT count(*) FROM public.auctions a
        WHERE a.status IN ('active', 'extended') AND a.current_bidder_id = p_team_id
          AND (p_exclude_auction_id IS NULL OR a.id <> p_exclude_auction_id))
  )::integer
$$;

-- Holdets egne senior-ryttere paa aktiv auktion. En rytter der allerede er paa
-- vej vaek (pending mod et andet hold) er talt i future_count og taelles ikke igen.
CREATE OR REPLACE FUNCTION public.team_outgoing_auction_count(p_team_id uuid, p_exclude_rider_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT count(DISTINCT r.id)::integer
    FROM public.auctions a
    JOIN public.riders r ON r.id = a.rider_id
   WHERE a.status IN ('active', 'extended')
     AND r.team_id = p_team_id
     AND r.squad = 'senior' AND r.is_academy = false AND r.is_retired = false
     AND NOT (r.pending_team_id IS NOT NULL AND r.pending_team_id <> p_team_id)
     AND (p_exclude_rider_id IS NULL OR r.id <> p_exclude_rider_id)
$$;

-- Samme ryttere som id'er: backenden udelader dem fra risiko-taellingen
-- (kontraktudloeb/pension), saa en rytter paa auktion aldrig taelles to gange.
CREATE OR REPLACE FUNCTION public.team_outgoing_auction_rider_ids(p_team_id uuid, p_exclude_rider_id uuid DEFAULT NULL)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(array_agg(DISTINCT r.id), '{}')
    FROM public.auctions a
    JOIN public.riders r ON r.id = a.rider_id
   WHERE a.status IN ('active', 'extended')
     AND r.team_id = p_team_id
     AND r.squad = 'senior' AND r.is_academy = false AND r.is_retired = false
     AND NOT (r.pending_team_id IS NOT NULL AND r.pending_team_id <> p_team_id)
     AND (p_exclude_rider_id IS NULL OR r.id <> p_exclude_rider_id)
$$;

-- Den rene regel. p_amount er holdets samlede forpligtelse paa DENNE auktion
-- efter handlingen (kalderen tager max med et eksisterende autobud); resten af
-- forpligtelsen laeses uden denne auktion. p_seat=false springer pladsen over
-- (ungdomsauktion eller forsvarsbud). NULL = ok.
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

-- auction_bids BEFORE INSERT: buddet maa kun lande, hvis holdet har penge og
-- plads under holdlaasen; buddet tager foeringen i samme transaktion.
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
  IF NOT public.market_commitment_6181_on() THEN
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
      AND a.current_bidder_id IS DISTINCT FROM NEW.team_id AND NOT coalesce(NEW.is_proxy, false)) THEN
    RAISE EXCEPTION 'market_gate_6181:price_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT max_amount INTO v_own_proxy FROM public.auction_proxy_bids
   WHERE auction_id = a.id AND team_id = NEW.team_id;

  v_issue := public.market_bid_issue_6181(
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

-- auctions BEFORE INSERT med en foerer: startbyderen skal have penge og plads.
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
  IF NOT public.market_commitment_6181_on() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.current_bidder_id::text, 0));
  v_issue := public.market_bid_issue_6181(
    NEW.current_bidder_id,
    NEW.id,
    coalesce(NEW.current_price, 0),
    NOT coalesce(NEW.is_youth, false)
  );
  IF v_issue IS NOT NULL THEN
    RAISE EXCEPTION 'market_gate_6181:%', v_issue USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- auction_proxy_bids BEFORE INSERT/UPDATE: et nyt eller haevet loft skal kunne
-- betales. Et saenket loft frigiver kun penge og tjekkes ikke.
CREATE OR REPLACE FUNCTION public.market_commitment_6181_proxy_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  a public.auctions;
  v_issue text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.max_amount <= OLD.max_amount
     AND NEW.team_id = OLD.team_id AND NEW.auction_id = OLD.auction_id THEN
    RETURN NEW;
  END IF;
  IF NOT public.market_commitment_6181_on() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));
  SELECT * INTO a FROM public.auctions WHERE id = NEW.auction_id;
  IF NOT FOUND OR a.status NOT IN ('active', 'extended') THEN
    RETURN NEW;
  END IF;

  v_issue := public.market_bid_issue_6181(
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

DROP TRIGGER IF EXISTS trg_market_commitment_6181_bid ON public.auction_bids;
CREATE TRIGGER trg_market_commitment_6181_bid
  BEFORE INSERT ON public.auction_bids
  FOR EACH ROW
  EXECUTE FUNCTION public.market_commitment_6181_bid_gate();

DROP TRIGGER IF EXISTS trg_market_commitment_6181_start ON public.auctions;
CREATE TRIGGER trg_market_commitment_6181_start
  BEFORE INSERT ON public.auctions
  FOR EACH ROW
  EXECUTE FUNCTION public.market_commitment_6181_start_gate();

DROP TRIGGER IF EXISTS trg_market_commitment_6181_proxy ON public.auction_proxy_bids;
CREATE TRIGGER trg_market_commitment_6181_proxy
  BEFORE INSERT OR UPDATE OF max_amount, team_id, auction_id ON public.auction_proxy_bids
  FOR EACH ROW
  EXECUTE FUNCTION public.market_commitment_6181_proxy_gate();

REVOKE ALL ON FUNCTION public.market_commitment_6181_on() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_commitment_6181_on() TO service_role;
REVOKE ALL ON FUNCTION public.market_squad_max() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_squad_max() TO service_role;
-- Gated proxy-program write and optional opening bid share one transaction.
CREATE OR REPLACE FUNCTION public.set_auction_proxy_6181(
  p_auction_id uuid, p_team_id uuid, p_max_amount bigint, p_opening_amount integer, p_bid_time timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_auction_id IS NULL OR p_team_id IS NULL OR p_max_amount IS NULL OR p_max_amount <= 0 OR p_bid_time IS NULL THEN
    RAISE EXCEPTION 'set_auction_proxy_6181: invalid argument' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text,0));
  SELECT status INTO v_status FROM public.auctions WHERE id=p_auction_id FOR UPDATE;
  IF NOT FOUND OR v_status IS NULL OR v_status NOT IN ('active','extended') THEN
    RAISE EXCEPTION 'auction_not_active' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.auction_proxy_bids(auction_id,team_id,max_amount)
    VALUES(p_auction_id,p_team_id,p_max_amount)
    ON CONFLICT(auction_id,team_id) DO UPDATE SET max_amount=EXCLUDED.max_amount;
  IF p_opening_amount IS NOT NULL THEN
    INSERT INTO public.auction_bids(auction_id,team_id,amount,bid_time,triggered_extension,is_proxy)
      VALUES(p_auction_id,p_team_id,p_opening_amount,p_bid_time,false,true);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_auction_proxy_6181(uuid, uuid, bigint, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_auction_proxy_6181(uuid, uuid, bigint, integer, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.team_market_commitment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_market_commitment(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.team_seat_commitment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_seat_commitment(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.team_outgoing_auction_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_outgoing_auction_count(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.team_outgoing_auction_rider_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_outgoing_auction_rider_ids(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.market_bid_issue_6181(uuid, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_bid_issue_6181(uuid, uuid, bigint, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_bid_gate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_start_gate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_proxy_gate() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
