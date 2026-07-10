-- repay_loan_atomic — optional metadata-code override for forced-sale repayments (#2303)
--
-- Problem: forced debt-sale proceeds (economyEngine.processTeamSeasonPayroll,
-- debt-breach-streak block) now pay down loans.amount_remaining directly via
-- repay_loan_atomic (see loanEngine.repayLoansFromForcedSale, #2303). The RPC
-- always stamped finance_transactions.metadata with tx.loanRepaymentFinal /
-- tx.loanRepaymentRemaining — the same codes a VOLUNTARY manager-initiated
-- repayLoan() call produces. The player's transaction history couldn't tell
-- a forced debt paydown (board seized a rider) apart from a repayment they
-- chose to make themselves.
--
-- Fix: let callers optionally pass p_finance_payload.metadata_code_final /
-- metadata_code_remaining to override the default codes. Falls back to the
-- existing tx.loanRepaymentFinal/tx.loanRepaymentRemaining when absent, so
-- loanEngine.repayLoan() (the player-facing path) is byte-for-byte unchanged.
-- repayLoansFromForcedSale passes tx.forcedDebtRepaymentFinal /
-- tx.forcedDebtRepaymentRemaining (new i18n keys, en+da, backendMessages.json).
--
-- Idempotent: CREATE OR REPLACE.
--
-- Rollback:
--   Re-apply database/2026-07-10-repay-loan-atomic.sql (restores the
--   unconditional CASE, dropping the override lookup).

CREATE OR REPLACE FUNCTION repay_loan_atomic(
  p_loan_id UUID,
  p_team_id UUID,
  p_amount BIGINT,
  p_finance_payload JSONB
) RETURNS JSONB
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
  v_code_final TEXT;
  v_code_remaining TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    RAISE EXCEPTION 'p_amount skal være >= 1' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

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

  -- #2303: forced-sale caller may override the metadata code so the player's
  -- history can tell a forced debt paydown apart from a voluntary repayment.
  v_code_final := COALESCE(p_finance_payload->>'metadata_code_final', 'tx.loanRepaymentFinal');
  v_code_remaining := COALESCE(p_finance_payload->>'metadata_code_remaining', 'tx.loanRepaymentRemaining');

  v_metadata := CASE WHEN v_is_paid_off
    THEN jsonb_build_object('code', v_code_final, 'params', '{}'::jsonb)
    ELSE jsonb_build_object('code', v_code_remaining, 'params', jsonb_build_object('remaining', v_new_remaining))
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
