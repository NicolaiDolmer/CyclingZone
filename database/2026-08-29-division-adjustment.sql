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

-- Backfill KUN aktive og pending raekker. Udloebne/erstattede bruges aldrig til udbetaling.
--
-- HVORFOR IKKE BARE HOLDETS STANDING I SAESONEN FOER start_season:
-- Det var foerste udkast, og det er forkert for 38 af 230 aktive kontrakter (maalt 29/8).
-- Grunden er sekvensen ved et saesonskifte: komprimeringen skriver den NYE division FOER
-- expireAndRenewContracts genererer default-aftaler. En kontrakt oprettet af transitionen
-- er derfor prissat mod holdets NYE division, mens dets standing fra den forrige saeson
-- stadig peger paa den gamle. Eksempel maalt i prod: et hold med guaranteed_base 772.800
-- (= target 840.000 = D1-basen x 1,40) fik standings_div = 3, hvilket ville have udloest
-- et tillaeg paa 130.000 til et hold der allerede ER korrekt baseret i D1.
--
-- REGLEN I STEDET (samme invariant som docs/SPONSOR_RULES.md §1):
--   target = guaranteed_base / guaranteed_fraction, og target SKAL ligge i
--   [base[d] ; base[d] x 1,40] for den division d aftalen blev prissat mod.
-- 1. Find alle divisioner der opfylder baandet (kandidater).
-- 2. Er holdets standing-division blandt kandidaterne, vinder den (mest praecis kilde).
-- 3. Ellers: er der praecis EN kandidat, er det svaret.
-- 4. Ellers NULL. Et tvetydigt baand (fx target 400.000 passer baade D2x1,00, D3x1,18 og
--    D4x1,27) er ikke noget at gaette paa - NULL giver tillaeg 0, aldrig en forkert
--    udbetaling. Maalt: 209 af 230 opløses, 21 forbliver NULL.
WITH bases(d, base) AS (
  VALUES (1, 600000), (2, 400000), (3, 340000), (4, 315000)
),
target AS (
  SELECT sc.id,
         round(sc.guaranteed_base::numeric / NULLIF(sc.guaranteed_fraction, 0)) AS ct,
         (SELECT ss.division
            FROM season_standings ss
            JOIN seasons s ON s.id = ss.season_id
           WHERE ss.team_id = sc.team_id
             AND s.number = sc.start_season - 1
           LIMIT 1) AS standings_div
    FROM sponsor_contracts sc
   WHERE sc.status IN ('active', 'pending')
     AND sc.signed_division IS NULL
),
cand AS (
  SELECT t.id, t.standings_div,
         array_agg(b.d ORDER BY b.d)
           FILTER (WHERE t.ct BETWEEN b.base AND b.base * 1.4001) AS cands
    FROM target t CROSS JOIN bases b
   GROUP BY t.id, t.standings_div
)
UPDATE sponsor_contracts sc
   SET signed_division = CASE
         WHEN c.cands IS NULL THEN NULL
         WHEN c.standings_div IS NOT NULL AND c.standings_div = ANY (c.cands) THEN c.standings_div
         WHEN array_length(c.cands, 1) = 1 THEN c.cands[1]
         ELSE NULL
       END
  FROM cand c
 WHERE sc.id = c.id;

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
-- (a) Backfillen opløser det forventede antal. NULL er en GYLDIG tilstand (tvetydigt baand
--     -> intet tillaeg), saa dette er ikke en "mangler = 0"-test:
--     SELECT count(*) FILTER (WHERE signed_division IS NOT NULL) AS oploest,
--            count(*) FILTER (WHERE signed_division IS NULL) AS uoploest, count(*) AS i_alt
--       FROM sponsor_contracts WHERE status IN ('active','pending');
--     Forventet paa S3-populationen: 209 oploest, 21 uoploest af 230 aktive.
--
-- (b) INVARIANTEN holder for hver backfilled raekke - target skal ligge i signed_division's
--     baand. Dette er den egentlige test af at reglen ovenfor virkede:
--     SELECT count(*) FROM sponsor_contracts sc
--      WHERE sc.signed_division IS NOT NULL AND sc.guaranteed_fraction > 0
--        AND round(sc.guaranteed_base::numeric / sc.guaranteed_fraction) NOT BETWEEN
--            (CASE sc.signed_division WHEN 1 THEN 600000 WHEN 2 THEN 400000
--                                     WHEN 3 THEN 340000 WHEN 4 THEN 315000 END)
--        AND (CASE sc.signed_division WHEN 1 THEN 600000 WHEN 2 THEN 400000
--                                     WHEN 3 THEN 340000 WHEN 4 THEN 315000 END) * 1.4001;
--     Forventet: 0. Er den > 0, er backfillen forkert og tillaegget maa IKKE koeres.
--
-- (c) Antal hold der faktisk faar et tillaeg i S3 (kun opad foer saeson 4):
--     Forventet: 54 hold, +3.901.500 CZ$ efter bestyrelses-modifier. Dry-run-scriptet
--     (scripts/creditDivisionAdjustment-4376.mjs) er facit - koer det, sammenlign, og
--     forelaeg tallene FOER --execute.
--
-- (c) Constraint accepterer den nye type:
--     SELECT pg_get_constraintdef(oid) FROM pg_constraint
--      WHERE conname = 'finance_transactions_type_check';
--     Forventet: listen indeholder 'division_adjustment'.
