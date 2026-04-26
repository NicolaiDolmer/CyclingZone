-- Add race_results_sheets to import_log import_type constraint
ALTER TABLE import_log DROP CONSTRAINT IF EXISTS import_log_import_type_check;
ALTER TABLE import_log ADD CONSTRAINT import_log_import_type_check
  CHECK (import_type IN ('riders_worlddb', 'uci_points_sheets', 'race_results', 'dyn_cyclist_sheets', 'race_results_sheets'));
