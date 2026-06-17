-- #1441/#97 Fase 1 — hård nødlåns-gældsbund + eskalerende transfer-fryse.
-- 1) Align emergency-loftet til division-loftet (var BEVIDST flad 1.5M, #97 reverserer det,
--    supersederer noten i 2026-06-17-e2-debt-ceiling-d1.sql om at 1.5M er urørt sikkerhedsnet).
-- 2) Nye teams-kolonner: transfer_frozen (debt-fryse, smallere end is_frozen) + debt_breach_streak.
-- 3) create_emergency_loan_atomic: clamp-not-throw udstedelse under advisory-lock (TOCTOU-safe).
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Rollback nederst.
BEGIN;

UPDATE loan_config SET debt_ceiling = 1200000 WHERE division = 1 AND loan_type = 'emergency';
UPDATE loan_config SET debt_ceiling = 900000  WHERE division = 2 AND loan_type = 'emergency';
UPDATE loan_config SET debt_ceiling = 600000  WHERE division = 3 AND loan_type = 'emergency';

ALTER TABLE teams ADD COLUMN IF NOT EXISTS transfer_frozen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS debt_breach_streak INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION create_emergency_loan_atomic(
  p_team_id UUID, p_amount_needed BIGINT, p_origination_fee_pct NUMERIC,
  p_interest_rate NUMERIC, p_debt_ceiling BIGINT
) RETURNS loans AS $$
DECLARE v_current_debt BIGINT; v_headroom BIGINT; v_principal BIGINT; v_fee BIGINT; v_loan loans;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));
  SELECT COALESCE(SUM(amount_remaining), 0) INTO v_current_debt FROM loans WHERE team_id = p_team_id AND status = 'active';
  v_headroom := GREATEST(0, p_debt_ceiling - v_current_debt);
  v_principal := LEAST(p_amount_needed, FLOOR(v_headroom / (1 + p_origination_fee_pct)));
  IF v_principal <= 0 THEN RETURN NULL; END IF;
  v_fee := ROUND(v_principal * p_origination_fee_pct);
  INSERT INTO loans(team_id, loan_type, principal, origination_fee, interest_rate,
    seasons_total, seasons_remaining, amount_remaining, status)
  VALUES (p_team_id, 'emergency', v_principal, v_fee, p_interest_rate, 1, 1, v_principal + v_fee, 'active')
  RETURNING * INTO v_loan;
  RETURN v_loan;
END; $$ LANGUAGE plpgsql;

COMMIT;
-- Rollback:
--   UPDATE loan_config SET debt_ceiling = 1500000 WHERE loan_type = 'emergency';
--   ALTER TABLE teams DROP COLUMN IF EXISTS transfer_frozen;
--   ALTER TABLE teams DROP COLUMN IF EXISTS debt_breach_streak;
--   DROP FUNCTION IF EXISTS create_emergency_loan_atomic(UUID,BIGINT,NUMERIC,NUMERIC,BIGINT);
