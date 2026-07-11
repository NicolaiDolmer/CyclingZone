-- repay_loan_atomic — rente/hovedstol-split på repayment-poster, interest-first (#2326)
--
-- Opfølgning fra #2304 (bevidst udskudt dér pga. samtidig #2324-ændring af
-- denne funktion). Ejer-valgt model: INTEREST-FIRST — en betaling dækker
-- først lånets påløbne rente (loans.accrued_interest), derefter hovedstol.
--
-- Ændringer ift. database/2026-07-10-repay-loan-atomic-forced-sale-metadata.sql
-- (den hidtil nyeste definition — #2303-metadata-override bevares uændret):
--   1. v_interest_paid := LEAST(v_actual_amount, loans.accrued_interest)
--      v_principal_paid := v_actual_amount - v_interest_paid
--   2. loans.accrued_interest reduceres med v_interest_paid i samme UPDATE
--      som amount_remaining (kolonnen var før en ren livstids-sum, se
--      kommentar-opdateringen nederst).
--   3. finance_transactions.metadata får interest_paid/principal_paid som
--      top-level nøgler ved siden af den eksisterende {code, params}-struktur,
--      så UI'et kan vise splittet uden at røre message-rendering. Gamle
--      repayment-poster uden nøglerne er fortsat gyldige (UI viser kun split
--      når nøglerne findes — backwards compatible).
--   4. RETURN-JSONB'en udvides med interest_paid/principal_paid (additivt —
--      eksisterende callers der kun læser paid/remaining/paid_off/balance
--      påvirkes ikke).
--
-- Idempotent: CREATE OR REPLACE + COMMENT.
--
-- Rollback:
--   Re-apply database/2026-07-10-repay-loan-atomic-forced-sale-metadata.sql
--   (fjerner splittet og accrued_interest-reduktionen) + genskab den gamle
--   kolonne-kommentar fra database/2026-07-10-loans-accrued-interest.sql.

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
  v_interest_paid BIGINT;
  v_principal_paid BIGINT;
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

  -- #2326: interest-first split. GREATEST(...,0) forsvarer mod evt. negative
  -- accrued_interest-værdier fra manuelle datarettelser.
  v_interest_paid := LEAST(v_actual_amount, GREATEST(COALESCE(v_loan.accrued_interest, 0), 0));
  v_principal_paid := v_actual_amount - v_interest_paid;

  UPDATE teams
    SET balance = balance - v_actual_amount
    WHERE id = p_team_id
    RETURNING balance INTO v_after_balance;

  UPDATE loans
    SET amount_remaining = v_new_remaining,
        accrued_interest = GREATEST(COALESCE(accrued_interest, 0) - v_interest_paid, 0),
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

  -- #2326: split-nøgler ved siden af code/params — UI viser kun split når de findes.
  v_metadata := v_metadata || jsonb_build_object(
    'interest_paid', v_interest_paid,
    'principal_paid', v_principal_paid
  );

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
    'balance', v_after_balance,
    'interest_paid', v_interest_paid,
    'principal_paid', v_principal_paid
  );
END;
$$ LANGUAGE plpgsql;

-- #2327 (PR #2345): funktionen må IKKE være PostgREST-eksponeret for klienter —
-- kun backend (service_role) kalder den. REVOKE er defensiv/idempotent, så
-- rækkefølgen ift. #2327-migrationen er ligegyldig. Kopiér ikke det gamle
-- "GRANT ... TO authenticated"-mønster fra 2026-07-10-filerne.
REVOKE EXECUTE ON FUNCTION repay_loan_atomic(UUID, UUID, BIGINT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION repay_loan_atomic(UUID, UUID, BIGINT, JSONB) TO service_role;

-- #2326: kolonnen er ikke længere en ren livstids-sum — repayments reducerer den.
COMMENT ON COLUMN loans.accrued_interest IS
  'Udestående (endnu ikke betalt) kapitaliseret rente på lånet. Forøges af processLoanInterest ved sæsonstart (#2304); reduceres interest-first af repay_loan_atomic ved enhver repayment (#2326). Vises i UI som "påløbet rente".';
