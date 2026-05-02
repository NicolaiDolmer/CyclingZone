-- Dekobler præmieudbetaling fra løbsresultat-import.
-- Admin kontrollerer hvornår præmier udbetales via dedikeret handling.

ALTER TABLE races ADD COLUMN IF NOT EXISTS prize_paid_at TIMESTAMPTZ;

-- Udvid import_log constraint til at inkludere prize_payout
ALTER TABLE import_log DROP CONSTRAINT IF EXISTS import_log_import_type_check;
ALTER TABLE import_log ADD CONSTRAINT import_log_import_type_check
  CHECK (import_type IN (
    'riders_worlddb',
    'uci_points_sheets',
    'race_results',
    'dyn_cyclist_sheets',
    'race_results_sheets',
    'prize_payout'
  ));

-- Backfill: løb der allerede har præmie-finanstransaktioner markeres som betalt
UPDATE races r
SET prize_paid_at = NOW()
WHERE r.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM finance_transactions ft
    WHERE ft.race_id = r.id
      AND ft.type = 'prize'
  );
