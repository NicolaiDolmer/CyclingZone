-- repay_loan_atomic — atomic loan-repayment RPC (#2302)
--
-- Problem (finance-audit 10/7): loanEngine.repayLoan() was a non-atomic,
-- unlocked read-modify-write:
--   1. Read loans.amount_remaining, UPDATE loans.amount_remaining/status
--      FIRST, THEN debit teams.balance in a separate increment_balance_with_audit
--      RPC call. If that second call failed, the debt was already wiped out
--      with no matching balance debit — money created out of thin air.
--   2. No lock around the loan row: two concurrent repayments on the same
--      loan can both read the same amount_remaining and both pass the
--      balance/remaining checks (last-writer-wins).
--   3. No idempotency_key on the debit ledger row.
--
-- Fix: fold the whole repay flow (lock → validate → debit balance → write
-- the finance_transactions ledger row → update the loan) into ONE Postgres
-- function, following the increment_balance_with_audit pattern
-- (database/2026-05-09-balance-rpc.sql, redefined with metadata support in
-- database/2026-05-26-backend-message-codes.sql). pg_advisory_xact_lock on
-- the team_id serializes concurrent repayments for the same team (matches
-- create_loan_atomic / create_emergency_loan_atomic / increment_balance_with_audit).
-- SELECT ... FOR UPDATE on the loan row additionally protects against
-- concurrent repayments on the SAME loan racing across different teams'
-- advisory-lock namespaces (not possible today since a loan belongs to one
-- team, but keeps the row-level guarantee explicit and cheap).
--
-- Design note (deviation from issue text): the issue suggested an optional
-- p_delta-vs-payload.amount mismatch guard "if you redefine
-- increment_balance_with_audit". This migration does NOT touch
-- increment_balance_with_audit — repay_loan_atomic is a new, separate
-- function that computes the actual repaid amount itself
-- (LEAST(p_amount, loans.amount_remaining)) rather than accepting a
-- caller-supplied delta, so there is no separate delta/payload.amount pair
-- that could drift — the mismatch class of bug does not apply here.
--
-- Scope note: this migration does NOT touch createEmergencyLoan or
-- create_emergency_loan_atomic (PR #2314 is in flight on that function) —
-- only the repay path.
--
-- Idempotent: CREATE OR REPLACE.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS repay_loan_atomic(UUID, UUID, BIGINT, JSONB);

CREATE OR REPLACE FUNCTION repay_loan_atomic(
  p_loan_id UUID,
  p_team_id UUID,
  p_amount BIGINT,
  p_finance_payload JSONB
) RETURNS JSONB
  -- Forward-guard (#927 pattern): pin search_path so a re-run never regresses
  -- the phase-a/phase-b security hardening (advisor 0011).
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_loan loans;
  v_before_balance BIGINT;
  v_after_balance BIGINT;
  v_actual_amount BIGINT;
  v_new_remaining BIGINT;
  v_is_paid_off BOOLEAN;
  v_metadata JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    RAISE EXCEPTION 'p_amount skal være >= 1' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize concurrent repay/create/increment calls for the same team.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- Lock the loan row so a concurrent repay on the same loan can't read a
  -- stale amount_remaining while this transaction is in flight.
  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id FOR UPDATE;

  IF NOT FOUND OR v_loan.team_id <> p_team_id THEN
    RAISE EXCEPTION 'Lån ikke fundet' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_loan.status = 'paid_off' THEN
    RAISE EXCEPTION 'Lånet er allerede betalt' USING ERRCODE = 'check_violation';
  END IF;

  v_actual_amount := LEAST(p_amount, v_loan.amount_remaining);

  SELECT balance INTO v_before_balance FROM teams WHERE id = p_team_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team % not found', p_team_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_before_balance < v_actual_amount THEN
    RAISE EXCEPTION 'Ikke nok midler' USING ERRCODE = 'check_violation';
  END IF;

  v_new_remaining := v_loan.amount_remaining - v_actual_amount;
  v_is_paid_off := v_new_remaining <= 0;
  IF v_new_remaining < 0 THEN
    v_new_remaining := 0;
  END IF;

  UPDATE teams
    SET balance = balance - v_actual_amount
    WHERE id = p_team_id
    RETURNING balance INTO v_after_balance;

  UPDATE loans
    SET amount_remaining = v_new_remaining,
        status = CASE WHEN v_is_paid_off THEN 'paid_off' ELSE 'active' END,
        updated_at = now()
    WHERE id = p_loan_id;

  v_metadata := CASE WHEN v_is_paid_off
    THEN jsonb_build_object('code', 'tx.loanRepaymentFinal', 'params', '{}'::jsonb)
    ELSE jsonb_build_object('code', 'tx.loanRepaymentRemaining', 'params', jsonb_build_object('remaining', v_new_remaining))
  END;

  INSERT INTO finance_transactions(
    team_id, type, amount, description,
    season_id, related_loan_id,
    actor_type, actor_id, source_path, reason_code,
    before_balance, after_balance,
    related_entity_type, related_entity_id, idempotency_key,
    metadata
  ) VALUES (
    p_team_id,
    'loan_repayment',
    -v_actual_amount,
    NULL,
    NULLIF(p_finance_payload->>'season_id', '')::UUID,
    p_loan_id,
    p_finance_payload->>'actor_type',
    NULLIF(p_finance_payload->>'actor_id', '')::UUID,
    p_finance_payload->>'source_path',
    p_finance_payload->>'reason_code',
    v_before_balance,
    v_after_balance,
    p_finance_payload->>'related_entity_type',
    NULLIF(p_finance_payload->>'related_entity_id', '')::UUID,
    NULLIF(p_finance_payload->>'idempotency_key', ''),
    v_metadata
  );

  RETURN jsonb_build_object(
    'paid', v_actual_amount,
    'remaining', v_new_remaining,
    'paid_off', v_is_paid_off,
    'balance', v_after_balance
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION repay_loan_atomic(UUID, UUID, BIGINT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION repay_loan_atomic(UUID, UUID, BIGINT, JSONB) TO authenticated;
