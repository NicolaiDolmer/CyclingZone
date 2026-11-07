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
-- ADDITIV OG IDEMPOTENT. Applies post-merge af auto-migrate.yml (#2642), efter
-- M1 (filnavnet sorterer efter M1). Ingen data roeres.
--
-- POST-VERIFY (read-only, efter apply):
--   1. SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.finance_transactions'::regclass
--        AND tgname = 'finance_transactions_sale_escrow_payee_guard';  -- 1 raekke
--   2. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
--        FROM pg_proc p WHERE p.proname IN ('resolve_stuck_sale_escrow', 'sale_escrow_guard_payee_credit');
--      -- anon=false, auth=false for begge
--
-- Rollback:
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

REVOKE ALL ON FUNCTION public.sale_escrow_guard_payee_credit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_stuck_sale_escrow(uuid, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stuck_sale_escrow(uuid, text, jsonb, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
