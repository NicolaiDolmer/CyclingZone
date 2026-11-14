-- #2176: atomic market payments stay on when auto-accept goes from beta to on.
-- market_beta_mode_2176() is true only while auto-accept is in beta (with the
-- bid lock on) or while the bid lock itself is in beta. Its five money uses
-- (discretionary finance guard, paid release, paid cash swap, scouting
-- assignment, ordinary auction creation) would answer 'legacy' and switch off
-- for every team the moment auto-accept became on. They now use
-- market_atomic_payments_2176(), which equals the old gate in every flag state
-- except one: bid lock on/true AND auto-accept on/true is now protected too.
-- Beta scoping (who sees an auto-price, market_scope_2176, pair, transport,
-- bid scoping) is untouched. No flag values are changed.
-- Function bodies below are verbatim copies of 2026-11-10-2176-transfer-payment-beta-scope.sql
-- with only the gate call replaced; the PGlite test asserts that textually.
-- The guard trigger itself is not recreated (no table DDL). Additive/idempotent.
-- Production apply is post-merge (auto-migrate).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_atomic_payments_2176()
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_config m WHERE m.key='market_commitment_6181'
   AND (m.value='"beta"'::jsonb OR (m.value IN ('"on"'::jsonb,'true'::jsonb)
     AND EXISTS(SELECT 1 FROM public.app_config a WHERE a.key='auto_accept_enabled'
       AND a.value IN ('"beta"'::jsonb,'"on"'::jsonb,'true'::jsonb)))))
$$;
REVOKE ALL ON FUNCTION public.market_atomic_payments_2176() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_atomic_payments_2176() TO service_role;

CREATE OR REPLACE FUNCTION public.market_discretionary_finance_guard_2176()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_balance bigint; v_locked bigint;
BEGIN
 IF NOT public.market_atomic_payments_2176() OR NEW.amount>=0 THEN RETURN NEW; END IF;
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

-- Beta releases include the fee in the ownership transaction. Academy release
-- keeps its existing no-senior-floor policy and exact contract reset.
CREATE OR REPLACE FUNCTION public.auto_accept_release_paid_2176(
 p_rider_id uuid,p_team_id uuid,p_min_riders integer,p_at_risk_rider_ids uuid[],
 p_academy boolean,p_fee bigint,p_finance_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE r public.riders; v_result jsonb; v_balance bigint; v_locked bigint:=0;
BEGIN
 IF NOT public.market_atomic_payments_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
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
 IF NOT public.market_atomic_payments_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
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
 IF NOT public.market_atomic_payments_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
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
 IF NOT public.market_atomic_payments_2176() THEN RETURN jsonb_build_object('status','legacy'); END IF;
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

NOTIFY pgrst, 'reload schema';
COMMIT;
