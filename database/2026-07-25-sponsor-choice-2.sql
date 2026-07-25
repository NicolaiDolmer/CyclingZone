-- 2026-07-25-sponsor-choice-2.sql (#2948 Sponsorvalg 2.0)
-- Additiv + idempotent. Applies post-merge under #2642-rammer.
--
-- Nye kolonner på sponsor_contracts:
--   variant             tilbuds-arketypen ('safe'/'loyal'/'racing'/'results'/'ambition'
--                       eller legacy 'predictable'/'activity'/'long'). Dræber den
--                       skrøbelige length+base-match i getNegotiationState (#2589-mønstret).
--   guaranteed_fraction andel af renownTarget lagt i garanteret base (frosset ved pick)
--   race_day_share      andel af renownTarget i den variable per-etape-pulje
--   bonus_clauses       jsonb-array af frosne klausuler, fx
--                       [{"type":"signing","amount":27200},
--                        {"type":"stage_win","amount":6120},
--                        {"type":"podium","amount":2380},
--                        {"type":"results_cap","amount":170000},
--                        {"type":"season_objective","objective":"top_half","amount":61200}]
--   results_bonus_paid  akkumuleret udbetalt sejr/podie-bonus (håndhæver results_cap)

-- Finance-typer (twin-guard: type SKAL i CHECK'et i SAMME PR som koden, jf.
-- 2026-07-20-finance-parachute-type.sql). VIGTIGT fund under #2948: typen
-- 'sponsor_race_day' (sponsorRaceDayIncome.js, skrevet i #1663) blev ALDRIG
-- tilføjet til CHECK'et — mekanikken har 0 udbetalinger nogensinde (#2913), så
-- fejlen er aldrig detoneret. Den ville have væltet første kreditering efter
-- cutoveren. Tilføjes her sammen med de 3 nye bonus-typer.
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
  'sponsor','prize','salary','transfer_in','transfer_out','interest','bonus','starting_budget',
  'loan_received','loan_repayment','loan_interest','emergency_loan','admin_adjustment',
  'auto_squad_purchase','auto_squad_sale','squad_violation_fine',
  'academy_signing','academy_drift','upkeep','forced_debt_sale',
  'facility_purchase','facility_upkeep','staff_salary','staff_severance','scout_travel',
  'parachute',
  'sponsor_race_day','sponsor_signing_bonus','sponsor_result_bonus','sponsor_objective_bonus'
));

ALTER TABLE sponsor_contracts ADD COLUMN IF NOT EXISTS variant TEXT;
ALTER TABLE sponsor_contracts ADD COLUMN IF NOT EXISTS guaranteed_fraction NUMERIC;
ALTER TABLE sponsor_contracts ADD COLUMN IF NOT EXISTS race_day_share NUMERIC;
ALTER TABLE sponsor_contracts ADD COLUMN IF NOT EXISTS bonus_clauses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sponsor_contracts ADD COLUMN IF NOT EXISTS results_bonus_paid BIGINT NOT NULL DEFAULT 0;

-- Backfill legacy-rækker (skrevet før denne migration): variant + fraction kan
-- udledes entydigt af length_seasons i det gamle 3-variant-sæt. race_day_share
-- var altid resten (1 - fraction). Kun rækker hvor variant stadig er NULL rammes
-- (idempotent re-run er no-op).
UPDATE sponsor_contracts SET
  variant = CASE length_seasons WHEN 1 THEN 'predictable' WHEN 2 THEN 'activity' WHEN 3 THEN 'long' END,
  guaranteed_fraction = CASE length_seasons WHEN 1 THEN 0.88 WHEN 2 THEN 0.55 WHEN 3 THEN 0.73 END,
  race_day_share = CASE length_seasons WHEN 1 THEN 0.12 WHEN 2 THEN 0.45 WHEN 3 THEN 0.27 END
WHERE variant IS NULL;

-- Post-verify (kør efter apply):
--   SELECT count(*) FROM sponsor_contracts WHERE variant IS NULL;          -- forventet 0
--   SELECT variant, count(*) FROM sponsor_contracts GROUP BY variant;      -- kun kendte varianter
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='finance_transactions'::regclass AND conname='finance_transactions_type_check';
--    -- skal indeholde sponsor_race_day + de 3 nye bonus-typer
