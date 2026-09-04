-- #4376: S3-korrektionens tilbageførsel (timing-hullet) skriver finance_transactions
-- med type 'sponsor_division_correction_clawback'. Typen skal i CHECK-constraintet,
-- ellers fejler apply med check_violation (23514) - fanget af scripts/lint-finance-types.mjs.
-- Idempotent: DROP IF EXISTS + re-ADD. Listen er 2026-08-29-division-adjustment.sql + den nye vaerdi.

BEGIN;

ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_type_check;

ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
    'sponsor', 'prize', 'salary', 'transfer_in', 'transfer_out', 'interest', 'bonus',
    'starting_budget', 'loan_received', 'loan_repayment', 'loan_interest',
    'emergency_loan', 'admin_adjustment', 'auto_squad_purchase', 'auto_squad_sale',
    'squad_violation_fine', 'academy_signing', 'academy_drift', 'upkeep',
    'forced_debt_sale', 'facility_purchase', 'facility_upkeep', 'staff_salary',
    'staff_severance', 'scout_travel', 'parachute', 'sponsor_race_day',
    'sponsor_signing_bonus', 'sponsor_result_bonus', 'sponsor_objective_bonus',
    'division_adjustment', 'sponsor_division_correction_clawback'
  ));

COMMIT;

-- Post-verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'finance_transactions_type_check';
--   Forventet: listen indeholder 'sponsor_division_correction_clawback'.
