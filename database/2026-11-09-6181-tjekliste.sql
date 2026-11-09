-- #6181 · Pengelaas: databasedelen af tjeklisten foer sale_escrow_enabled og
-- market_commitment_6181 taendes (uafhaengigt review 9/11). Kontakterne roeres ikke.
--
-- 1. Fejlet laas efter parkering. Handlen parkerer rytteren og kalder bagefter
--    hold_sale_escrow. Fejler laasen, stod rytteren parkeret uden betaling, og
--    flushen flyttede ham senere gratis. sale_escrow_undo_failed_hold fjerner
--    parkeringen igen under samme laase som hold_sale_escrow og goer intet, hvis
--    laasen alligevel naaede at blive oprettet (fx et tabt svar paa et committet kald).
--
-- 2. Refusion. sale_escrow_restore_on_refund koerer i refusionens transaktion
--    (settle_sale_escrow og resolve_stuck_sale_escrow), saa alt herunder sker
--    praecis een gang eller slet ikke:
--      - trup-status (M2) og nu ogsaa den kontrakt, handlen oprettede
--      - academy_graduation, som salget lukkede, aabnes igen
--      - fremtidige loebstilmeldinger paa et andet hold end rytterens nuvaerende
--      - handlens status (transfer/bytte: withdrawn, auktion: cancelled)
--      - besked til begge parter (raekkerne i notifications er den varige levering)
--    Triggerens WHEN udvides, saa den ogsaa koerer uden foer-billede.
--
-- 3. Deadlock ved startbud. trg_ai_drain_auctions laaser holdraekken, og
--    Postgres koerer triggere i navneorden, saa start-gaten tog holdlaasen EFTER
--    raekkelaasen, mens enhver saldobevaegelse tager dem i omvendt raekkefoelge.
--    Triggeren omdoebes, saa den koerer foerst.
--
-- 4. Saenket autobud. Et upsert affyrer BEFORE INSERT, ogsaa naar raekken findes.
--    Gaten behandlede derfor et saenket loft som et nyt, og et overforpligtet hold
--    kunne ikke frigive penge. Gaten sammenligner nu med raekken, der staar.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642), efter M1,
-- M2 og M3. Ingen data roeres.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.auctions'::regclass
--        AND tgname LIKE '%market_commitment_6181%';  -- kun a_market_commitment_6181_start
--   2. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('sale_escrow_undo_failed_hold', 'sale_escrow_restore_riders',
--                                           'sale_escrow_restore_on_refund', 'hold_sale_escrow');
--      -- anon=false, auth=false for alle
--   3. SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'sale_escrows_restore_on_refund';
--      -- WHEN uden rider_restore
--
-- Rollback: koer M2 og M3 igen (gendanner funktioner og triggernavn), og derefter
--   DROP TRIGGER IF EXISTS a_market_commitment_6181_start ON public.auctions;
--   DROP FUNCTION IF EXISTS public.sale_escrow_undo_failed_hold(text, uuid, uuid, uuid, uuid[], uuid[], jsonb);
--   DROP FUNCTION IF EXISTS public.sale_escrow_restore_riders(uuid[], uuid[], uuid, uuid, uuid[], jsonb, timestamptz);
--
-- Refs #6181 #7872

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Faelles for refusionen og den fortrudte parkering: gendan en rytter, der bliver
-- hos sit kildehold, og aabn den graduering, salget lukkede.
CREATE OR REPLACE FUNCTION public.sale_escrow_restore_riders(
  p_rider_ids uuid[],
  p_target_team_ids uuid[],
  p_payer_team_id uuid,
  p_payee_team_id uuid,
  p_delivered uuid[],
  p_restore jsonb,
  p_since timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  WITH restored AS (
    UPDATE public.riders r
       SET is_academy = CASE WHEN x.v ? 'is_academy' THEN (x.v->>'is_academy')::boolean ELSE r.is_academy END,
           squad = CASE WHEN x.v ? 'squad' THEN x.v->>'squad' ELSE r.squad END,
           salary = CASE WHEN x.v ? 'salary' THEN (x.v->>'salary')::integer ELSE r.salary END,
           contract_length = CASE WHEN x.v ? 'contract_length' THEN (x.v->>'contract_length')::integer ELSE r.contract_length END,
           contract_end_season = CASE WHEN x.v ? 'contract_end_season' THEN (x.v->>'contract_end_season')::integer ELSE r.contract_end_season END
      FROM jsonb_each(p_restore) AS x(k, v),
           unnest(p_rider_ids, p_target_team_ids) AS t(rider_id, target_team_id)
     WHERE x.k = t.rider_id::text
       AND r.id = t.rider_id
       AND NOT (t.rider_id = ANY (p_delivered))
       AND r.pending_team_id IS NULL
       AND r.team_id = CASE WHEN t.target_team_id = p_payer_team_id
                            THEN p_payee_team_id ELSE p_payer_team_id END
    RETURNING r.id, r.team_id, coalesce((x.v->>'is_academy')::boolean, false) AS was_academy
  )
  -- Kun den raekke, netop dette salg lukkede: rytteren var i akademiet, og
  -- lukningen ligger taet paa handlen.
  UPDATE public.academy_graduation g
     SET status = 'pending', resolved_at = NULL
    FROM restored s
   WHERE s.was_academy
     AND g.rider_id = s.id
     AND g.team_id = s.team_id
     AND g.status = 'sold'
     AND g.resolved_at >= p_since
     AND NOT EXISTS (SELECT 1 FROM public.academy_graduation o
                      WHERE o.rider_id = s.id AND o.status = 'pending');
END;
$$;

-- 1. Fortryd parkeringen efter en fejlet laas. Samme laaseraekkefoelge som
-- hold_sale_escrow: hold, saa ryttere.
CREATE OR REPLACE FUNCTION public.sale_escrow_undo_failed_hold(
  p_deal_type text,
  p_deal_id uuid,
  p_payer_team_id uuid,
  p_payee_team_id uuid,
  p_rider_ids uuid[],
  p_target_team_ids uuid[],
  p_rider_restore jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_unparked uuid[];
  v_kept uuid[];
BEGIN
  PERFORM public.sale_escrow_lock_teams(p_payer_team_id, p_payee_team_id);
  PERFORM 1 FROM public.riders WHERE id = ANY (p_rider_ids) ORDER BY id FOR UPDATE;

  -- Laasen findes alligevel: escrow'en ejer parkeringen og pengene.
  IF EXISTS (SELECT 1 FROM public.sale_escrows WHERE deal_type = p_deal_type AND deal_id = p_deal_id) THEN
    RETURN jsonb_build_object('status', 'escrow_exists');
  END IF;

  WITH unparked AS (
    UPDATE public.riders r
       SET pending_team_id = NULL
      FROM unnest(p_rider_ids, p_target_team_ids) AS t(rider_id, target_team_id)
     WHERE r.id = t.rider_id
       AND r.pending_team_id = t.target_team_id
       AND r.team_id = CASE WHEN t.target_team_id = p_payer_team_id
                            THEN p_payee_team_id ELSE p_payer_team_id END
    RETURNING r.id
  )
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_unparked FROM unparked;

  -- Et ben, der allerede er flyttet (eller er parkeret i en anden handel), roeres ikke.
  SELECT coalesce(array_agg(x.rider_id), '{}') INTO v_kept
    FROM unnest(p_rider_ids) AS x(rider_id)
   WHERE NOT (x.rider_id = ANY (v_unparked));

  PERFORM public.sale_escrow_restore_riders(p_rider_ids, p_target_team_ids, p_payer_team_id, p_payee_team_id,
                                            v_kept, coalesce(p_rider_restore, '{}'::jsonb), now() - interval '7 days');
  RETURN jsonb_build_object('status', 'undone', 'unparked_rider_ids', to_jsonb(v_unparked));
END;
$$;

-- 2. Hele refusionen. SECURITY DEFINER som leverings-triggeren.
CREATE OR REPLACE FUNCTION public.sale_escrow_restore_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_riders text;
  v_first_rider uuid;
  v_type text := CASE WHEN NEW.deal_type = 'auction' THEN 'auction_cancelled' ELSE 'transfer_offer_rejected' END;
BEGIN
  PERFORM public.sale_escrow_restore_riders(NEW.rider_ids, NEW.target_team_ids, NEW.payer_team_id, NEW.payee_team_id,
                                            NEW.delivered_rider_ids, NEW.rider_restore, NEW.created_at - interval '7 days');

  -- Ikke-startede loeb paa et andet hold end det, rytteren nu staar paa. Hans
  -- tilmeldinger hos det hold, han bliver paa, er stadig gyldige.
  DELETE FROM public.race_entries re
   USING public.races rc, unnest(NEW.rider_ids) AS t(rider_id)
    LEFT JOIN public.riders r ON r.id = t.rider_id
   WHERE re.rider_id = t.rider_id
     AND NOT (t.rider_id = ANY (NEW.delivered_rider_ids))
     AND rc.id = re.race_id
     AND rc.status = 'scheduled'
     AND rc.stages_completed = 0
     AND re.team_id IS DISTINCT FROM r.team_id;

  IF NEW.deal_type = 'transfer' THEN
    UPDATE public.transfer_offers SET status = 'withdrawn', updated_at = NEW.settled_at
     WHERE id = NEW.deal_id AND status IN ('accepted', 'window_pending');
  ELSIF NEW.deal_type = 'swap' THEN
    UPDATE public.swap_offers SET status = 'withdrawn', updated_at = NEW.settled_at
     WHERE id = NEW.deal_id AND status IN ('accepted', 'window_pending');
  ELSE
    UPDATE public.auctions SET status = 'cancelled'
     WHERE id = NEW.deal_id AND status = 'completed';
  END IF;

  SELECT string_agg(concat_ws(' ', r.firstname, r.lastname), ' & ' ORDER BY x.ord),
         (array_agg(r.id ORDER BY x.ord))[1]
    INTO v_riders, v_first_rider
    FROM unnest(NEW.rider_ids) WITH ORDINALITY AS x(rider_id, ord)
    JOIN public.riders r ON r.id = x.rider_id
   WHERE NOT (x.rider_id = ANY (NEW.delivered_rider_ids));

  INSERT INTO public.notifications (user_id, type, title, message, related_id, metadata)
  SELECT t.user_id, v_type, p.title, p.message, NEW.deal_id,
         jsonb_build_object('titleCode', p.title_code, 'titleParams', '{}'::jsonb, 'messageCode', p.message_code,
                            'messageParams', jsonb_build_object('riders', coalesce(v_riders, ''), 'amount', NEW.amount))
         || CASE WHEN v_first_rider IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('riderId', v_first_rider) END
    FROM (VALUES
      (NEW.payer_team_id, 'Deal cancelled, money returned',
       coalesce(v_riders, '') || ' did not change teams, so ' || to_char(NEW.amount, 'FM999,999,999,999') || ' CZ$ is back in your balance.',
       'notif.saleEscrowRefund.buyerTitle', 'notif.saleEscrowRefund.buyerMessage'),
      (NEW.payee_team_id, 'Deal cancelled',
       coalesce(v_riders, '') || ' did not change teams, so the ' || to_char(NEW.amount, 'FM999,999,999,999') || ' CZ$ from the deal went back to the other team.',
       'notif.saleEscrowRefund.sellerTitle', 'notif.saleEscrowRefund.sellerMessage')
    ) AS p(team_id, title, message, title_code, message_code)
    JOIN public.teams t ON t.id = p.team_id
   WHERE t.user_id IS NOT NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sale_escrows_restore_on_refund ON public.sale_escrows;
CREATE TRIGGER sale_escrows_restore_on_refund
  AFTER UPDATE OF status ON public.sale_escrows
  FOR EACH ROW
  WHEN (OLD.status = 'held' AND NEW.status = 'refunded')
  EXECUTE FUNCTION public.sale_escrow_restore_on_refund();

-- Foer-billedet maa nu ogsaa rumme kontrakten. Resten af funktionen er M2's.
CREATE OR REPLACE FUNCTION public.hold_sale_escrow(
  p_deal_type text,
  p_deal_id uuid,
  p_payer_team_id uuid,
  p_payee_team_id uuid,
  p_amount bigint,
  p_rider_ids uuid[],
  p_target_team_ids uuid[],
  p_payer_payload jsonb,
  p_payee_payload jsonb,
  p_rider_restore jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_n integer := coalesce(cardinality(p_rider_ids), 0);
  v_restore jsonb := coalesce(p_rider_restore, '{}'::jsonb);
  v_existing public.sale_escrows;
  v_id uuid;
  v_payer_key text;
  v_payee_key text;
  v_parked integer;
  v_arrived integer;
  v_delivered uuid[];
  v_net bigint;
  v_payer_already boolean := false;
BEGIN
  -- Programmeringsfejl hos kalderen kastes; tilstandskonflikter returneres som status.
  IF p_deal_type IS NULL OR p_deal_type NOT IN ('transfer', 'auction', 'swap') THEN
    RAISE EXCEPTION 'hold_sale_escrow: unknown deal_type %', p_deal_type USING ERRCODE = '22023';
  END IF;
  IF p_deal_id IS NULL OR p_payer_team_id IS NULL OR p_payee_team_id IS NULL THEN
    RAISE EXCEPTION 'hold_sale_escrow: deal_id, payer and payee are required' USING ERRCODE = '22023';
  END IF;
  IF p_payer_team_id = p_payee_team_id THEN
    RAISE EXCEPTION 'hold_sale_escrow: payer and payee must differ' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'hold_sale_escrow: amount must be positive' USING ERRCODE = '22023';
  END IF;
  IF v_n NOT BETWEEN 1 AND 2
     OR coalesce(cardinality(p_target_team_ids), 0) <> v_n
     OR array_position(p_rider_ids, NULL) IS NOT NULL
     OR array_position(p_target_team_ids, NULL) IS NOT NULL
     OR (p_deal_type = 'swap') <> (v_n = 2) THEN
    RAISE EXCEPTION 'hold_sale_escrow: rider/target shape does not match deal_type %', p_deal_type USING ERRCODE = '22023';
  END IF;
  IF p_deal_type <> 'swap' AND p_target_team_ids[1] <> p_payer_team_id THEN
    RAISE EXCEPTION 'hold_sale_escrow: the rider must go to the payer' USING ERRCODE = '22023';
  END IF;
  IF p_deal_type = 'swap' AND (
       p_rider_ids[1] = p_rider_ids[2]
    OR p_target_team_ids[1] = p_target_team_ids[2]
    OR NOT (p_target_team_ids <@ ARRAY[p_payer_team_id, p_payee_team_id])) THEN
    RAISE EXCEPTION 'hold_sale_escrow: a swap moves two riders between payer and payee' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payer_payload) IS DISTINCT FROM 'object' OR p_payer_payload->>'type' IS DISTINCT FROM 'transfer_out' THEN
    RAISE EXCEPTION 'hold_sale_escrow: payer payload must be a transfer_out object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payee_payload) IS DISTINCT FROM 'object' OR p_payee_payload->>'type' IS DISTINCT FROM 'transfer_in' THEN
    RAISE EXCEPTION 'hold_sale_escrow: payee payload must be a transfer_in object' USING ERRCODE = '22023';
  END IF;
  -- Foer-billedet: kun handlens ryttere og kun trup- og kontraktfelterne.
  IF jsonb_typeof(v_restore) IS DISTINCT FROM 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(v_restore) AS x(k, v)
        WHERE CASE
          WHEN NOT (x.k = ANY (SELECT r::text FROM unnest(p_rider_ids) AS r)) THEN true
          WHEN jsonb_typeof(x.v) <> 'object' THEN true
          ELSE EXISTS (SELECT 1 FROM jsonb_object_keys(x.v) AS f
                        WHERE f NOT IN ('is_academy', 'squad', 'salary', 'contract_length', 'contract_end_season'))
            OR (x.v ? 'is_academy' AND jsonb_typeof(x.v->'is_academy') <> 'boolean')
            OR (x.v ? 'squad' AND jsonb_typeof(x.v->'squad') <> 'string')
            OR (x.v ? 'salary' AND jsonb_typeof(x.v->'salary') NOT IN ('number', 'null'))
            OR (x.v ? 'contract_length' AND jsonb_typeof(x.v->'contract_length') NOT IN ('number', 'null'))
            OR (x.v ? 'contract_end_season' AND jsonb_typeof(x.v->'contract_end_season') NOT IN ('number', 'null'))
        END) THEN
    RAISE EXCEPTION 'hold_sale_escrow: rider_restore must map the deal''s riders to squad and contract fields' USING ERRCODE = '22023';
  END IF;

  v_payer_key := public.sale_escrow_finance_key(p_deal_type, 'payer', p_deal_id);
  v_payee_key := public.sale_escrow_finance_key(p_deal_type, 'payee', p_deal_id);

  -- Laaseraekkefoelge som M1: hold, saa rytter-raekkerne sorteret.
  PERFORM public.sale_escrow_lock_teams(p_payer_team_id, p_payee_team_id);
  PERFORM 1 FROM public.riders WHERE id = ANY (p_rider_ids) ORDER BY id FOR UPDATE;

  SELECT * INTO v_existing FROM public.sale_escrows
   WHERE deal_type = p_deal_type AND deal_id = p_deal_id;
  IF FOUND THEN
    IF v_existing.payer_team_id <> p_payer_team_id
       OR v_existing.payee_team_id <> p_payee_team_id
       OR v_existing.amount <> p_amount
       OR v_existing.rider_ids <> p_rider_ids
       OR v_existing.target_team_ids <> p_target_team_ids THEN
      RAISE EXCEPTION 'hold_sale_escrow: % % already has a different escrow', p_deal_type, p_deal_id USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('status', 'exists', 'escrow_id', v_existing.id, 'escrow_status', v_existing.status);
  END IF;

  -- Hvert ben: parkeret mod maalholdet fra sit kildehold (saelger, eller modparten i
  -- et bytte), eller allerede leveret (staar paa maalholdet).
  SELECT count(*) FILTER (WHERE r.pending_team_id = t.target_team_id
                            AND r.team_id = CASE WHEN t.target_team_id = p_payer_team_id
                                                 THEN p_payee_team_id ELSE p_payer_team_id END),
         count(*) FILTER (WHERE r.team_id = t.target_team_id),
         coalesce(array_agg(t.rider_id ORDER BY t.rider_id) FILTER (WHERE r.team_id = t.target_team_id), '{}')
    INTO v_parked, v_arrived, v_delivered
    FROM unnest(p_rider_ids, p_target_team_ids) AS t(rider_id, target_team_id)
    JOIN public.riders r ON r.id = t.rider_id;
  -- Alle leveret: intet at laase, kalderen betaler som ved oejeblikkeligt skifte.
  IF v_arrived = v_n OR v_parked + v_arrived <> v_n THEN
    RETURN jsonb_build_object('status', 'not_parked');
  END IF;

  -- Kun en rytter, der stadig venter i en anden holdt escrow, blokerer.
  IF EXISTS (SELECT 1 FROM public.sale_escrows e
               CROSS JOIN LATERAL unnest(e.rider_ids) AS x(rider_id)
              WHERE e.status = 'held'
                AND x.rider_id = ANY (p_rider_ids)
                AND NOT (x.rider_id = ANY (e.delivered_rider_ids))) THEN
    RETURN jsonb_build_object('status', 'rider_already_escrowed');
  END IF;

  -- Den gamle sti har allerede betalt saelger: en escrow her ville kunne
  -- refundere koeberen oven i saelgers penge.
  IF EXISTS (SELECT 1 FROM public.finance_transactions WHERE idempotency_key = v_payee_key) THEN
    RETURN jsonb_build_object('status', 'payee_already_credited');
  END IF;

  -- En eksisterende koeber-debitering (en halvfaerdig handel fra den gamle sti)
  -- bruges kun, naar koeberens poster for handlen netto staar paa beloebet. Er den
  -- reverseret (eller bogfoert paa et andet hold), oprettes ingen escrow.
  IF EXISTS (SELECT 1 FROM public.finance_transactions WHERE idempotency_key = v_payer_key) THEN
    SELECT coalesce(sum(amount), 0) INTO v_net
      FROM public.finance_transactions
     WHERE team_id = p_payer_team_id
       AND related_entity_type = p_deal_type
       AND related_entity_id = p_deal_id;
    IF v_net <> -p_amount THEN
      RETURN jsonb_build_object('status', 'payer_debit_not_standing');
    END IF;
    v_payer_already := true;
  END IF;

  INSERT INTO public.sale_escrows (deal_type, deal_id, payer_team_id, payee_team_id, amount, rider_ids,
                                   target_team_ids, payee_payload, delivered_rider_ids, rider_restore)
  VALUES (p_deal_type, p_deal_id, p_payer_team_id, p_payee_team_id, p_amount, p_rider_ids,
          p_target_team_ids, p_payee_payload, v_delivered, v_restore)
  RETURNING id INTO v_id;

  IF NOT v_payer_already THEN
    BEGIN
      PERFORM public.increment_balance_with_audit(
        p_payer_team_id,
        -p_amount,
        p_payer_payload || jsonb_build_object(
          'amount', -p_amount,
          'idempotency_key', v_payer_key,
          'related_entity_type', p_deal_type,
          'related_entity_id', p_deal_id
        )
      );
    EXCEPTION WHEN unique_violation THEN
      v_payer_already := true;
    END;
  END IF;

  RETURN jsonb_build_object('status', 'held', 'escrow_id', v_id, 'payer_already_debited', v_payer_already,
                            'delivered_rider_ids', to_jsonb(v_delivered));
END;
$$;

-- 3. Start-gaten skal koere foer trg_ai_drain_auctions (navneorden).
DROP TRIGGER IF EXISTS trg_market_commitment_6181_start ON public.auctions;
DROP TRIGGER IF EXISTS a_market_commitment_6181_start ON public.auctions;
CREATE TRIGGER a_market_commitment_6181_start
  BEFORE INSERT ON public.auctions
  FOR EACH ROW
  EXECUTE FUNCTION public.market_commitment_6181_start_gate();

-- 4. Et saenket loft frigiver kun penge og tjekkes aldrig, heller ikke via upsert.
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
  IF NOT public.market_commitment_6181_on() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.team_id::text, 0));

  -- Laest under holdlaasen, saa en samtidig aendring af loftet ikke kan snyde.
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

REVOKE ALL ON FUNCTION public.sale_escrow_restore_riders(uuid[], uuid[], uuid, uuid, uuid[], jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_escrow_undo_failed_hold(text, uuid, uuid, uuid, uuid[], uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_escrow_undo_failed_hold(text, uuid, uuid, uuid, uuid[], uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sale_escrow_restore_riders(uuid[], uuid[], uuid, uuid, uuid[], jsonb, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.sale_escrow_restore_on_refund() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.market_commitment_6181_proxy_gate() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
