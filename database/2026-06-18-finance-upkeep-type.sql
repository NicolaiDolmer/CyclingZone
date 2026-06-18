-- P0 (#1441 follow-up) — fundet i relaunch-rehearsal 18/6: tilføj 'upkeep' til
-- finance_transactions_type_check.
--
-- economyEngine.processSeasonStart (#1441 anti-inflation upkeep, merged 17/6) debiterer
-- division-skaleret operating cost som finance_transaction af type 'upkeep' (economyEngine.js:658),
-- men typen blev aldrig tilføjet til CHECK-constraintet — hverken i kode-PR'en eller en migration.
-- Upkeep kører først ved næste season-transition (= relaunch season 0→1), så bug'en var LATENT:
-- prod-relaunchen ville crashe midt i apply (efter legacy-retire + beta-reset, FØR season-transition
-- fuldfører) på den første upkeep-INSERT → halvt-anvendt, destruktivt state. Opdaget af
-- backend/scripts/dev/run-relaunch-rehearsal.mjs mod disposabel preview-branch.
--
-- Kun ADD af ny type => ingen eksisterende række brydes. Idempotent (DROP IF EXISTS + re-ADD).
-- Rollback: gen-declare CHECK uden 'upkeep'.

BEGIN;

ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep'
));

COMMIT;
