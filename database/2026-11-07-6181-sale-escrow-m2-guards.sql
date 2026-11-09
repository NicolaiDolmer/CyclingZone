-- #6181 PR 3 · Pengelaas M2: to vaern oven paa M1 (2026-11-07-6181-sale-escrow-m1.sql),
-- begge krav fra det uafhaengige review af M1 (ejer-krav paa #7871).
--
-- 1. Ejer-krav 1, "gammel saelger-kredit efter refusion skaber penge":
--    settle_sale_escrow(refund) afviser, hvis saelger-noeglen findes, men intet
--    stoppede den gamle sti i at kreditere transfer_seller:/auction_seller:/
--    swap_receiver: EFTER en refusion (fx en gentagelse af handlen: koeberens
--    traek springes over som dublet, saelgers kredit ikke). En BEFORE INSERT-
--    trigger paa finance_transactions afviser nu en saelger-kredit, naar handlens
--    escrow er refunderet. Den koerer inde i increment_balance_with_audit EFTER
--    holdlaasen (pg_advisory_xact_lock paa holdet), og settle_sale_escrow tager
--    samme laas paa begge hold, saa tjekket og refusionen er serialiseret: enten
--    ser refusionen kreditten (payee_already_credited), eller kreditten ser
--    refusionen (afvist her). Fejlen ruller hele kaldet tilbage, ogsaa saldoen.
--    Koden (saleEscrowFlow6181.saleEscrowStatusForDeal) stopper handlen allerede
--    foer rytteren flyttes; triggeren er den endelige garanti.
--
-- 2. Ejer-krav 2, "bytte kan sidde fast": een rytter leveret og den anden mistet
--    parkering/slettet giver not_deliverable paa release og already_delivered paa
--    refund. public.resolve_stuck_sale_escrow(...) er den manuelle vej (admin-
--    ruten POST /api/admin/sale-escrows/:id/resolve): admin vaelger release
--    (modtageren krediteres) eller refund (betaleren faar beloebet tilbage). Ingen
--    rytter flyttes. Kun en escrow, der faktisk sidder fast, kan afgoeres her;
--    alt andet afregner settle_sale_escrow/reconcile som foer ('not_stuck').
--    Samme laaseraekkefoelge, noegler og vagter som settle_sale_escrow.
--
-- 3. Codex P1 (#7874), "et byttes ene ben kan flyttes mellem parkering og hold":
--    handlen parkerer rytterne og kalder bagefter hold_sale_escrow. Flytter
--    heal-sweepet det ene ben imellem (loebet sluttede), afviste M1 med
--    not_parked, og handlen fejlede, mens begge ryttere skiftede hold uden
--    betaling. hold_sale_escrow erstattes, saa et ben, der allerede staar paa sit
--    maalhold, taeller som leveret (noteret i delivered_rider_ids ved
--    oprettelsen), naar mindst eet ben stadig venter. Er ALLE ben leveret, svarer
--    den stadig not_parked, og kalderen betaler som foer (rytterne er leveret).
--    Samtidig (ejer-krav 3 og 4 fra M1-reviewet):
--      - ejerskab: et parkeret ben skal staa paa sit kildehold (saelger, eller
--        modparten i et bytte), ellers not_parked. Koebers raad tjekker
--        kalderne under handlen (samme tjek som den direkte sti).
--      - en eksisterende koeber-debitering stoles kun paa, naar koeberens poster
--        for handlen netto staar paa praecis beloebet; er den reverseret,
--        svares payer_debit_not_standing, og der oprettes ingen escrow.
--      - en rytter, der er leveret i en anden holdt escrow (fx et bytte, hvis
--        andet ben stadig venter), kan saelges videre: kun ikke-leverede ryttere
--        blokerer (rider_already_escrowed).
--    Den nye parameter p_rider_restore (se 4) giver en ny signatur; den gamle
--    droppes, saa PostgREST ikke har to kandidater. M1 har ingen kaldere foer
--    denne PR.
--
-- 4. Codex P1 (#7874), "refusion af et bytte gendanner ikke trup-status":
--    handlen graduerer en akademirytter (seniorSquadPatch) allerede ved
--    parkeringen. Refunderes handlen, bliver rytteren hos sit hold, men mistede
--    sin akademi-/ungdomsplads. Kolonnen rider_restore gemmer foer-billedet
--    (is_academy, squad) pr. rytter, og en trigger gendanner det, naar escrow'en
--    gaar fra held til refunded (settle og den manuelle vej): kun for en rytter,
--    der ikke er leveret, ikke er parkeret og stadig staar paa sit kildehold.
--
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642), efter
-- M1 (filnavnet sorterer efter M1). Ingen data roeres (sale_escrows er tom).
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT tgname FROM pg_trigger WHERE tgname IN
--        ('finance_transactions_sale_escrow_payee_guard', 'sale_escrows_restore_on_refund');  -- 2 raekker
--   2. SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('resolve_stuck_sale_escrow', 'sale_escrow_guard_payee_credit',
--                                           'hold_sale_escrow', 'sale_escrow_restore_on_refund');
--      -- anon=false, auth=false for alle; hold_sale_escrow har een raekke (10 argumenter)
--   3. SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'sale_escrows' AND column_name = 'rider_restore';  -- 1 raekke
--
-- Rollback (kun mens sale_escrows er tom):
--   DROP TRIGGER IF EXISTS sale_escrows_restore_on_refund ON public.sale_escrows;
--   DROP FUNCTION IF EXISTS public.sale_escrow_restore_on_refund();
--   DROP FUNCTION IF EXISTS public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb, jsonb);
--   (genskab derefter M1's hold_sale_escrow ved at koere M1 igen)
--   ALTER TABLE public.sale_escrows DROP COLUMN IF EXISTS rider_restore;
--   DROP TRIGGER IF EXISTS finance_transactions_sale_escrow_payee_guard ON public.finance_transactions;
--   DROP FUNCTION IF EXISTS public.sale_escrow_guard_payee_credit();
--   DROP FUNCTION IF EXISTS public.resolve_stuck_sale_escrow(uuid, text, jsonb, timestamptz);
--
-- Refs #6181 #7871

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Ingen saelger-kredit efter en refusion.
CREATE OR REPLACE FUNCTION public.sale_escrow_guard_payee_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prefix text := split_part(NEW.idempotency_key, ':', 1);
  v_deal text := substr(NEW.idempotency_key, length(split_part(NEW.idempotency_key, ':', 1)) + 2);
  v_type text;
BEGIN
  v_type := CASE v_prefix
    WHEN 'transfer_seller' THEN 'transfer'
    WHEN 'auction_seller'  THEN 'auction'
    WHEN 'swap_receiver'   THEN 'swap'
  END;
  IF v_type IS NULL
     OR v_deal !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_escrows
              WHERE deal_type = v_type AND deal_id = v_deal::uuid AND status = 'refunded') THEN
    RAISE EXCEPTION 'sale_escrow_refunded: % % was refunded to the buyer; the seller cannot be credited', v_type, v_deal
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_transactions_sale_escrow_payee_guard ON public.finance_transactions;
CREATE TRIGGER finance_transactions_sale_escrow_payee_guard
  BEFORE INSERT ON public.finance_transactions
  FOR EACH ROW
  WHEN (NEW.idempotency_key ~ '^(transfer_seller|auction_seller|swap_receiver):')
  EXECUTE FUNCTION public.sale_escrow_guard_payee_credit();

-- 2. Manuel afgoerelse af en fastlaast escrow.
CREATE OR REPLACE FUNCTION public.resolve_stuck_sale_escrow(
  p_escrow_id uuid,
  p_outcome text,
  p_payload jsonb,
  p_settled_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  e public.sale_escrows;
  v_n integer;
  v_parked integer;
  v_arrived integer;
  v_key text;
  v_already boolean := false;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('release', 'refund') THEN
    RAISE EXCEPTION 'resolve_stuck_sale_escrow: outcome must be release or refund' USING ERRCODE = '22023';
  END IF;
  IF p_settled_at IS NULL THEN
    RAISE EXCEPTION 'resolve_stuck_sale_escrow: settled_at is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'type' IS DISTINCT FROM 'transfer_in' THEN
    RAISE EXCEPTION 'resolve_stuck_sale_escrow: payload must be a transfer_in object' USING ERRCODE = '22023';
  END IF;

  -- Laaseraekkefoelge som settle_sale_escrow: hold, ryttere, escrow.
  SELECT * INTO e FROM public.sale_escrows WHERE id = p_escrow_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  PERFORM public.sale_escrow_lock_teams(e.payer_team_id, e.payee_team_id);
  PERFORM 1 FROM public.riders WHERE id = ANY (e.rider_ids) ORDER BY id FOR UPDATE;
  SELECT * INTO e FROM public.sale_escrows WHERE id = p_escrow_id FOR UPDATE;
  IF e.status <> 'held' THEN
    RETURN jsonb_build_object('status', 'already_settled', 'escrow_status', e.status);
  END IF;

  v_n := cardinality(e.rider_ids);
  SELECT count(*) FILTER (WHERE NOT (t.rider_id = ANY (e.delivered_rider_ids) OR r.team_id = t.target_team_id)
                            AND r.pending_team_id = t.target_team_id),
         count(*) FILTER (WHERE t.rider_id = ANY (e.delivered_rider_ids) OR r.team_id = t.target_team_id)
    INTO v_parked, v_arrived
    FROM unnest(e.rider_ids, e.target_team_ids) AS t(rider_id, target_team_id)
    LEFT JOIN public.riders r ON r.id = t.rider_id;

  -- Fast = mindst een leveret OG mindst een, der hverken er leveret eller parkeret.
  -- Alt andet kan settle_sale_escrow afregne (release, refund eller vent).
  IF NOT (v_arrived > 0 AND v_parked + v_arrived < v_n) THEN
    RETURN jsonb_build_object('status', 'not_stuck');
  END IF;

  IF p_outcome = 'release' THEN
    v_key := public.sale_escrow_finance_key(e.deal_type, 'payee', e.deal_id);
    BEGIN
      PERFORM public.increment_balance_with_audit(
        e.payee_team_id,
        e.amount,
        e.payee_payload || jsonb_strip_nulls(jsonb_build_object(
          'actor_type', p_payload->'actor_type',
          'actor_id', p_payload->'actor_id',
          'source_path', p_payload->'source_path'
        )) || jsonb_build_object(
          'amount', e.amount,
          'idempotency_key', v_key,
          'related_entity_type', e.deal_type,
          'related_entity_id', e.deal_id
        )
      );
    EXCEPTION WHEN unique_violation THEN
      v_already := true;
    END;
    UPDATE public.sale_escrows SET status = 'released', settled_at = p_settled_at WHERE id = e.id;
    RETURN jsonb_build_object('status', 'released', 'escrow_id', e.id, 'payee_already_credited', v_already);
  END IF;

  -- refund: aldrig oven i en saelger-kredit.
  IF EXISTS (SELECT 1 FROM public.finance_transactions
              WHERE idempotency_key = public.sale_escrow_finance_key(e.deal_type, 'payee', e.deal_id)) THEN
    RETURN jsonb_build_object('status', 'payee_already_credited');
  END IF;

  v_key := 'sale_escrow_refund:' || e.id::text;
  BEGIN
    PERFORM public.increment_balance_with_audit(
      e.payer_team_id,
      e.amount,
      p_payload || jsonb_build_object(
        'amount', e.amount,
        'reason_code', 'sale_escrow_refund',
        'idempotency_key', v_key,
        'related_entity_type', e.deal_type,
        'related_entity_id', e.deal_id
      )
    );
  EXCEPTION WHEN unique_violation THEN
    v_already := true;
  END;
  UPDATE public.sale_escrows SET status = 'refunded', settled_at = p_settled_at WHERE id = e.id;
  RETURN jsonb_build_object('status', 'refunded', 'escrow_id', e.id, 'payer_already_refunded', v_already);
END;
$$;

-- 4a. Foer-billedet af trup-felterne pr. rytter: {"<rider_id>": {"is_academy": bool, "squad": text}}.
ALTER TABLE public.sale_escrows ADD COLUMN IF NOT EXISTS rider_restore jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_escrows_rider_restore_object') THEN
    ALTER TABLE public.sale_escrows
      ADD CONSTRAINT sale_escrows_rider_restore_object CHECK (jsonb_typeof(rider_restore) = 'object');
  END IF;
END;
$$;

-- 3. hold_sale_escrow med leverede ben, ejerskab, staaende koeber-debitering og foer-billede.
DROP FUNCTION IF EXISTS public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb);
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
  -- Foer-billedet: kun handlens ryttere, kun is_academy (boolean) og squad (tekst).
  IF jsonb_typeof(v_restore) IS DISTINCT FROM 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(v_restore) AS x(k, v)
        WHERE CASE
          WHEN NOT (x.k = ANY (SELECT r::text FROM unnest(p_rider_ids) AS r)) THEN true
          WHEN jsonb_typeof(x.v) <> 'object' THEN true
          ELSE EXISTS (SELECT 1 FROM jsonb_object_keys(x.v) AS f WHERE f NOT IN ('is_academy', 'squad'))
            OR (x.v ? 'is_academy' AND jsonb_typeof(x.v->'is_academy') <> 'boolean')
            OR (x.v ? 'squad' AND jsonb_typeof(x.v->'squad') <> 'string')
        END) THEN
    RAISE EXCEPTION 'hold_sale_escrow: rider_restore must map the deal''s riders to {is_academy, squad}' USING ERRCODE = '22023';
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

-- 4b. Gendan trup-status ved refusion. Koerer i samme transaktion som refusionen
-- (settle_sale_escrow eller resolve_stuck_sale_escrow), som allerede holder
-- raekkelaasene paa rytterne. SECURITY DEFINER som leverings-triggeren.
CREATE OR REPLACE FUNCTION public.sale_escrow_restore_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.riders r
     SET is_academy = CASE WHEN x.v ? 'is_academy' THEN (x.v->>'is_academy')::boolean ELSE r.is_academy END,
         squad = CASE WHEN x.v ? 'squad' THEN x.v->>'squad' ELSE r.squad END
    FROM jsonb_each(NEW.rider_restore) AS x(k, v),
         unnest(NEW.rider_ids, NEW.target_team_ids) AS t(rider_id, target_team_id)
   WHERE x.k = t.rider_id::text
     AND r.id = t.rider_id
     AND NOT (t.rider_id = ANY (NEW.delivered_rider_ids))
     AND r.pending_team_id IS NULL
     AND r.team_id = CASE WHEN t.target_team_id = NEW.payer_team_id
                          THEN NEW.payee_team_id ELSE NEW.payer_team_id END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sale_escrows_restore_on_refund ON public.sale_escrows;
CREATE TRIGGER sale_escrows_restore_on_refund
  AFTER UPDATE OF status ON public.sale_escrows
  FOR EACH ROW
  WHEN (OLD.status = 'held' AND NEW.status = 'refunded' AND NEW.rider_restore <> '{}'::jsonb)
  EXECUTE FUNCTION public.sale_escrow_restore_on_refund();

REVOKE ALL ON FUNCTION public.sale_escrow_restore_on_refund() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_sale_escrow(text, uuid, uuid, uuid, bigint, uuid[], uuid[], jsonb, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.sale_escrow_guard_payee_credit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_stuck_sale_escrow(uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stuck_sale_escrow(uuid, text, jsonb, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
