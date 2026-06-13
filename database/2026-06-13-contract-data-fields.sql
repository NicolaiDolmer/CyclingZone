-- #1309 kontrakt-data-seed: erstat den GENERATED salary-kolonne med en frossen
-- (plain) kolonne + tilføj contract_length + contract_end_season.
--
-- Beslutninger (ejer, 13/6):
--  • Konvertér salary PÅ STEDET (behold navnet → ~40 læse-steder uændret).
--  • Kontrakter kun på EJEDE ryttere; free agents = NULL (UI estimerer 10% af value).
--
-- DROP EXPRESSION (PG 13+; Supabase = PG 15) fjerner generation-udtrykket OG
-- bevarer de nuværende beregnede værdier som lagrede data. (Cutover 2026-06-10
-- brugte DROP+ADD fordi den ÆNDREDE formlen; vi vil BEHOLDE værdierne, så
-- DROP EXPRESSION er det rette værktøj.) market_value forbliver GENERATED.
--
-- Rollback: ALTER TABLE riders DROP COLUMN contract_length, DROP COLUMN
-- contract_end_season; og re-generér salary:
--   ALTER TABLE riders DROP COLUMN salary;
--   ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
--     GREATEST(1, ROUND((COALESCE(base_value,1000)+prize_earnings_bonus)*0.10))::INTEGER
--   ) STORED;

BEGIN;

ALTER TABLE riders ALTER COLUMN salary DROP EXPRESSION;

COMMENT ON COLUMN riders.salary IS
  'Frossen kontrakt-løn (#1309, 13/6). Var GENERATED (10% af market_value); nu '
  'sat ved kontrakt-signering og fast til udløb. Kun ejede ryttere har en værdi; '
  'free agents = NULL (UI estimerer via resolveRiderSalary). Seedes i relaunch-'
  'orchestratoren (runContractSeed) og auto-oprettes ved erhvervelse hvis NULL.';

ALTER TABLE riders ADD COLUMN contract_length INTEGER
  CHECK (contract_length IS NULL OR contract_length BETWEEN 1 AND 3);
COMMENT ON COLUMN riders.contract_length IS
  'Kontraktlængde i sæsoner (1-3). NULL = free agent (ingen kontrakt). #1309.';

ALTER TABLE riders ADD COLUMN contract_end_season INTEGER
  CHECK (contract_end_season IS NULL OR contract_end_season >= 1);
COMMENT ON COLUMN riders.contract_end_season IS
  'Sidste sæson-number kontrakten er aktiv (= start_season + length - 1). '
  'Forlængelses-vindue i denne sæson; udløb ved skiftet ud af den. NULL = free agent. #1309.';

COMMIT;
