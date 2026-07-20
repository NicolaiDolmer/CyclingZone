-- #1980 PR-B "Nedrykningsfaldskærm" — tilføj 'parachute' til
-- finance_transactions_type_check + idempotens-index.
--
-- economyEngine.processSeasonStart betaler nu en engangs-nedrykningsfaldskærm
-- (finance_transactions type='parachute') ved sæson-start for hold der blev
-- nedrykket fra D1→D2 eller D2→D3 (economyConstants.PARACHUTE_FACTOR = 0.5,
-- ejer-låst kontrakt 5/7 — se economyConstants.js for beløbs-formlen). Typen
-- skal tilføjes til CHECK-constrainten FØR koden kører mod prod, ellers fejler
-- INSERT'et (samme klasse bug som #1441/2026-06-18-finance-upkeep-type.sql —
-- opdaget der FØR relaunch, undgås her ved at lave migrationen samtidig med koden).
--
-- Constraint-listen herunder er verificeret mod prod's AKTUELLE constraint
-- (execute_sql read-only, 2026-07-20) FØR denne migration blev skrevet, så ingen
-- eksisterende type droppes utilsigtet:
--   sponsor, prize, salary, transfer_in, transfer_out, interest, bonus,
--   starting_budget, loan_received, loan_repayment, loan_interest,
--   emergency_loan, admin_adjustment, auto_squad_purchase, auto_squad_sale,
--   squad_violation_fine, academy_signing, academy_drift, upkeep,
--   forced_debt_sale, facility_purchase, facility_upkeep, staff_salary,
--   staff_severance, scout_travel
-- + NY: parachute
--
-- Idempotens-index mirror'er uniq_sponsor_per_team_season (2026-05-07-economy-
-- idempotency.sql) — partial UNIQUE på (team_id, season_id) WHERE type='parachute'.
-- Bemærk: incrementBalanceWithAudit's idempotency_key (uniq_finance_idempotency_key)
-- dækker allerede idempotens for det enkelte kald, men vi tilføjer samme type-
-- specifikke index som de øvrige sæson-baserede payouts for defense-in-depth og
-- konsistens med det etablerede mønster.
--
-- Kun ADD af ny type => ingen eksisterende række brydes. Idempotent
-- (DROP IF EXISTS + re-ADD for constraint; CREATE UNIQUE INDEX IF NOT EXISTS for index).
-- Claude applier denne migration SELV, POST-merge (#2642-rammer: idempotent +
-- post-verify; ikke-destruktiv klasse — ren ADD, intet ejer-gate nødvendigt).

BEGIN;

ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale',
  'facility_purchase','facility_upkeep','staff_salary','staff_severance','scout_travel',
  'parachute'
));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_parachute_per_team_season
  ON finance_transactions(team_id, season_id)
  WHERE type = 'parachute' AND season_id IS NOT NULL;

COMMIT;

-- ── Post-verify (kør efter apply) ────────────────────────────────────────────
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'finance_transactions'::regclass AND conname = 'finance_transactions_type_check';
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'finance_transactions' AND indexname = 'uniq_parachute_per_team_season';

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS uniq_parachute_per_team_season;
-- (gen-declare CHECK uden 'parachute' — kun sikkert hvis ingen 'parachute'-rows findes endnu)
