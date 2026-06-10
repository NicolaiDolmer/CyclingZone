-- #1101 slice 2 CUTOVER: økonomien flipper fra uci_points til base_value (v3).
--
-- market_value/salary var GENERATED fra uci_points (juridisk + designmæssig
-- IRL-afhængighed). base_value (model v3: alsidigheds-blend + krumning,
-- ejer-verificeret i shadow 9-10/6) er nu kilden. Generated-kolonner kan ikke
-- ALTER'es — DROP+ADD (præcedens: 2026-05-04-salary-generated-column.sql).
-- DB genberegner alle rækker ved ADD.
--
-- price DROPPES helt: ingen runtime-læser (guard-grep 10/6) — den var uci*4000.
-- COALESCE(base_value, 1000): fiktiv-generatorens insert→backfill-vindue må
-- aldrig give NULL-økonomi; 1000 = bundskala (ejer-direktiv "ingen bund",
-- dårligste ryttere ≈ 1.000). Konstanten spejles i marketUtils.js
-- (RIDER_BASE_VALUE_FALLBACK) og frontend marketValues.js — SKAL holdes i sync.
-- Audit: backend/scripts/auditValuationCutover.js fejler hvis NULL/0 base_value
-- persisterer eller formlerne divergerer.
--
-- Rollback: DROP de to kolonner + ADD med de gamle uci-formler fra git-historik
-- (2026-05-04-salary-generated-column.sql + 2026-04-30-rider-market-value.sql).

BEGIN;

ALTER TABLE riders DROP COLUMN price;
ALTER TABLE riders DROP COLUMN market_value;
ALTER TABLE riders DROP COLUMN salary;

ALTER TABLE riders ADD COLUMN market_value INTEGER GENERATED ALWAYS AS (
  COALESCE(base_value, 1000) + prize_earnings_bonus
) STORED;

ALTER TABLE riders ADD COLUMN salary INTEGER GENERATED ALWAYS AS (
  GREATEST(1, ROUND(
    (COALESCE(base_value, 1000) + prize_earnings_bonus) * 0.10
  ))::INTEGER
) STORED;

-- idx_riders_market_value blev droppet sammen med kolonnen (2026-04-30) — genskab.
CREATE INDEX idx_riders_market_value ON riders (market_value DESC);

COMMENT ON COLUMN riders.base_value IS
  'Data-drevet rytter-værdi (#1101, model v3). LIVE siden cutover 2026-06-10: '
  'market_value/salary er GENERATED herfra. uci_points er afkoblet (ikke droppet '
  '- oprydning post-launch). Skrives af backfillRiderBaseValue/relaunch-orchestrator.';

COMMIT;
