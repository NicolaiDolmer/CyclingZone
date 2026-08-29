-- Divisions-tillægget (#4376) — ejer-besluttet 29/8, regel i docs/SPONSOR_RULES.md §3.
--
-- En sponsoraftale prissættes mod den division holdet var i DA det valgte. Rykker holdet
-- op, betaler det den nye divisions upkeep fra dag ét mod en sponsor prissat til den gamle.
-- Denne migration lægger fundamentet for korrektionen:
--
--   1. sponsor_contracts.signed_division — den division aftalen blev prissat mod.
--      Lagres i stedet for at rekonstrueres: 23 af 230 hold (målt 29/8) har INGEN
--      season_standings-række i sæsonen før start_season, fordi de blev oprettet midt
--      i en sæson. For dem er enhver rekonstruktion udefineret.
--   2. finance_transactions.type += 'division_adjustment' — tillægget er sin egen linje,
--      ikke en del af sponsor-udbetalingen. Spilleren skal kunne se den for sig selv.
--
-- IDEMPOTENT: kan køres flere gange. Ikke-destruktiv (tilføjer kolonne + udvider en
-- CHECK-liste; ingen data slettes eller overskrives ud over NULL-backfill).
-- Post-verify-queries står nederst.

BEGIN;

-- ── 1. signed_division ───────────────────────────────────────────────────────
ALTER TABLE sponsor_contracts
  ADD COLUMN IF NOT EXISTS signed_division INTEGER;

COMMENT ON COLUMN sponsor_contracts.signed_division IS
  'Den division aftalen blev prissat mod (renownTarget = SPONSOR_INCOME_BY_DIVISION[denne] x renownMultiplier). Skrives ved signering. Divisions-tillaegget (SPONSOR_RULES.md §3) er 0,5 x forskellen mellem holdets nuvaerende divisions base og denne. NULL => intet tillaeg, aldrig et gaet.';

-- Backfill KUN aktive og pending raekker. Udloebne/erstattede raekker bruges aldrig til
-- udbetaling, og et teams.division-fallback ville skrive misvisende historik paa dem.
-- Raekkefoelgen i COALESCE er reglen fra SPONSOR_RULES.md §3: standingen hvor den findes,
-- ellers holdets nuvaerende division (korrekt for et hold der kom ind midt i en saeson og
-- derfor ikke har naaet at skifte division -> tillaeg 0).
UPDATE sponsor_contracts sc
SET signed_division = COALESCE(
      (SELECT ss.division
         FROM season_standings ss
         JOIN seasons s ON s.id = ss.season_id
        WHERE ss.team_id = sc.team_id
          AND s.number = sc.start_season - 1
        LIMIT 1),
      (SELECT t.division FROM teams t WHERE t.id = sc.team_id)
    )
WHERE sc.status IN ('active', 'pending')
  AND sc.signed_division IS NULL;

-- ── 2. finance_transactions.type ─────────────────────────────────────────────
-- Hele listen gentages fordi en CHECK-constraint ikke kan udvides in-place. Listen er
-- kopieret fra prod 29/8 (pg_get_constraintdef) + 'division_adjustment'. Aendres den
-- her, skal FINANCE_TX_TYPES i backend foelge med — se #1464 (forward-guard mangler).
ALTER TABLE finance_transactions
  DROP CONSTRAINT IF EXISTS finance_transactions_type_check;

-- Formen `type IN (...)` er ikke tilfældig: scripts/lint-finance-types.mjs parser netop
-- dette moenster for at finde den autoritative liste, og bruger den nyeste
-- YYYY-MM-DD-praefiksede fil som sandhed. Skrives constraintet som
-- `type = ANY (ARRAY[...])` er det semantisk identisk for Postgres, men guarden ser den
-- ikke og falder tilbage paa en aeldre definition — praecis den drift #1464/#1465 handler om.
ALTER TABLE finance_transactions
  ADD CONSTRAINT finance_transactions_type_check CHECK (type IN (
    'sponsor', 'prize', 'salary', 'transfer_in', 'transfer_out', 'interest', 'bonus',
    'starting_budget', 'loan_received', 'loan_repayment', 'loan_interest',
    'emergency_loan', 'admin_adjustment', 'auto_squad_purchase', 'auto_squad_sale',
    'squad_violation_fine', 'academy_signing', 'academy_drift', 'upkeep',
    'forced_debt_sale', 'facility_purchase', 'facility_upkeep', 'staff_salary',
    'staff_severance', 'scout_travel', 'parachute', 'sponsor_race_day',
    'sponsor_signing_bonus', 'sponsor_result_bonus', 'sponsor_objective_bonus',
    'division_adjustment'
  ));

COMMIT;

-- ── Post-verify (koeres efter apply, jf. #2642) ──────────────────────────────
--
-- (a) Kolonnen findes og er backfilled for alle aktive/pending kontrakter:
--     SELECT count(*) FILTER (WHERE signed_division IS NULL) AS mangler,
--            count(*) AS i_alt
--       FROM sponsor_contracts WHERE status IN ('active','pending');
--     Forventet: mangler = 0.
--
-- (b) Backfillen rammer det maalte: 96 af 230 aktive kontrakter skal have
--     signed_division <> teams.division (de hold der skiftede division ved S3-omlaegningen):
--     SELECT count(*) FROM sponsor_contracts sc
--       JOIN teams t ON t.id = sc.team_id
--      WHERE sc.status='active' AND t.is_ai=false AND t.is_bank=false
--        AND t.is_frozen=false AND t.is_test_account=false
--        AND sc.signed_division IS DISTINCT FROM t.division;
--     Forventet: 96.
--
-- (c) Constraint accepterer den nye type:
--     SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conname = 'finance_transactions_type_check';
--     Forventet: listen indeholder 'division_adjustment'.
