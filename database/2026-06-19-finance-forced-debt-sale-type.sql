-- Reviewet + ejer-godkendt til apply (dag-boelge close-out 2026-06-19). Auto-applies ved merge til main.
--
-- #1465 backwards-check (twin af 'upkeep'-bug'en fra #1463 / 2026-06-18-finance-upkeep-type.sql):
-- tilføj 'forced_debt_sale' til finance_transactions_type_check.
--
-- economyEngine.processTeamSeasonPayroll B3-eskalering (#1441/#97 debt-ceiling forced sale,
-- economyEngine.js:540) krediterer holdet markedsværdien af den tvangssolgte rytter som en
-- finance_transaction af type 'forced_debt_sale' — men typen blev aldrig tilføjet til
-- CHECK-constraintet (hverken i kode-PR'en eller en migration). Søster-stien
-- squadEnforcement.executeAutoSale bruger 'auto_squad_sale' (som ER i CHECK'et); B3-stien
-- har bevidst sin EGEN type (jf. docs/GAME_INVARIANTS.md §Eskalerende gældhåndhævelse +
-- economyEngine.test.js:3011-3013 der asserter en distinkt 'forced_debt_sale'-row).
--
-- LATENT fordi den kun fyrer ved sæson-slut-payroll for et hold der har været over sit
-- divisions-gældsloft i >=2 på hinanden følgende sæsoner. Unit-testene bruger en mock-supabase
-- uden ægte CHECK, så de er grønne mens en RIGTIG INSERT i prod ville fejle med en
-- check_violation (23514) midt i processTeamSeasonPayroll-cron'en → halv-kørt payroll.
--
-- Kun ADD af ny type => ingen eksisterende række brydes. Idempotent (DROP IF EXISTS + re-ADD).
-- Rollback: gen-declare CHECK uden 'forced_debt_sale'.

BEGIN;

ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale'
));

COMMIT;
