-- #2176 A7: commit ownership and payment before releasing the shared team locks.
-- Additive/idempotent, service-only. Apply after merge by Claude/auto-migrate.
-- Market gate off retains the old unpaid claim and JavaScript payment sequence.
-- Payment/audit/escrow failure aborts the whole RPC, including ownership changes.
-- Rollback: revert the JS caller first, then drop this new function if desired.
BEGIN;
SET LOCAL lock_timeout = '5s';

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
  IF NOT public.market_commitment_6181_on() THEN
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
REVOKE ALL ON FUNCTION public.auto_accept_claim_transfer_paid(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_accept_claim_transfer_paid(uuid,uuid,uuid,boolean,timestamptz,jsonb,integer,uuid[],integer,bigint,uuid,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
