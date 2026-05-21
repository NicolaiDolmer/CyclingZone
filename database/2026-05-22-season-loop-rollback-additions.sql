-- Sæson-loop forensik 2026-05-22 — rest-cleanup efter original rollback (2026-05-21)
-- ===============================================================================
--
-- Original rollback (database/2026-05-21-season-loop-rollback.sql) subtraherede
-- SUM(ghost-tx.amount) fra teams.balance. Det inkluderede ghost loan_interest-
-- amounts som ALDRIG rørte teams.balance: processLoanInterest opdaterer
-- loans.amount_remaining, ikke balance (backend/lib/loanEngine.js:419-437).
-- Resultat: 8 hold med lån fik uretmæssig balance-bonus + deres lån er pumpet
-- med 3 ekstra ghost-rente-cykler.
--
-- processLoanInterest kørte 4× på hvert af 10 aktive lån (1 legit sæson 0→1
-- + 3 ghost-transitions 1→2, 2→3, 3→4). Vi roller 3 ghost-runs tilbage på alle
-- 10 lån + reducerer balance med samme beløb. Zero-sum: manager's net worth
-- (balance - debt) er uændret per hold.
--
-- Skadeperimeter (1.09M CZ$ total):
--   Swatt Team:               -271,431  ⟵  (long 12%, biggest)
--   Vega-Vitalcare:           -144,452
--   Camp Cycling:             -158,674
--   Soudal Quick-Step:        -143,400
--   Team Visma | Lease a Bike: -162,656  (short -115,562 + long -47,094)
--   Team Give Steel:            -97,148
--   Modern Adventure:           -51,891
--   Hopplà Team:                -59,225  (loan 1 -50,558 + loan 2 -8,667)
--
-- Audit-trail strategi: BØR ikke INSERT'e admin_adjustment finance_transactions.
-- Det ville skabe double-correction: subtraktion af balance + subtraktion af
-- expected-fra-finance_tx via SUM(amount). Audit lever i admin_log meta-snapshots
-- (samme mønster som original 2026-05-21 rollback brugte).
--
-- Idempotent: aborter hvis cleanup_phase='loans_rest_correction' allerede findes.
--
-- KØRT MOD PROD: 2026-05-22 ~01:00 CEST. Verifikation: alle 19 hold's balancer
-- matcher rekonstruktion fra non-loan-interest finance_tx (diff=0, ± 1 CZ$ rounding).

BEGIN;

-- ── Sanity-check ────────────────────────────────────────────────────────────
DO $$
DECLARE
  prior_cleanup_count INT;
BEGIN
  SELECT COUNT(*) INTO prior_cleanup_count
  FROM admin_log
  WHERE action_type = 'season_repaired'
    AND meta->>'cleanup_phase' = 'loans_rest_correction';
  IF prior_cleanup_count > 0 THEN
    RAISE EXCEPTION 'Cleanup allerede kørt (cleanup_phase=loans_rest_correction findes). Aborter.';
  END IF;
END $$;

-- ── 1. Audit-snapshot FØR ──────────────────────────────────────────────────
INSERT INTO admin_log (admin_user_id, action_type, description, meta)
VALUES (
  NULL,
  'season_repaired',
  'Sæson-loop forensik 2026-05-22 (rest-correction): ruller 3 ghost-renter tilbage på 10 lån + reducerer 8 holds balance med samme beløb.',
  jsonb_build_object(
    'cleanup_phase', 'loans_rest_correction',
    'incident_date', '2026-05-21',
    'follow_up_date', '2026-05-22',
    'rollback_strategy', 'iterativ rente-rolling: corrected = current / (1+rate)^3; balance -= sum(overshoot) per loan',
    'pre_cleanup_balances', (
      SELECT jsonb_object_agg(name, balance) FROM teams
      WHERE is_ai = false AND COALESCE(is_bank, false) = false AND user_id IS NOT NULL
    ),
    'pre_cleanup_loans', (
      SELECT jsonb_agg(jsonb_build_object(
        'loan_id', id, 'team_id', team_id, 'amount_remaining', amount_remaining, 'seasons_remaining', seasons_remaining
      )) FROM loans WHERE status = 'active'
    )
  )
);

-- ── 2. Snapshot per-loan overshoot + per-team aggregate ─────────────────────
CREATE TEMP TABLE _ghost_loan_correction AS
SELECT
  l.id AS loan_id, l.team_id, l.interest_rate,
  l.amount_remaining AS current_amount_remaining,
  ROUND(l.amount_remaining / POWER(1 + l.interest_rate, 3))::BIGINT AS corrected_amount_remaining,
  (l.amount_remaining - ROUND(l.amount_remaining / POWER(1 + l.interest_rate, 3))::BIGINT) AS ghost_overshoot
FROM loans l
WHERE l.status = 'active'
  AND l.team_id IN (SELECT id FROM teams WHERE is_ai = false AND COALESCE(is_bank, false) = false AND user_id IS NOT NULL);

CREATE TEMP TABLE _team_overshoot AS
SELECT c.team_id, SUM(c.ghost_overshoot)::BIGINT AS total_overshoot, t.balance AS current_balance
FROM _ghost_loan_correction c JOIN teams t ON t.id = c.team_id
GROUP BY c.team_id, t.balance;

-- ── 3. Rul 3 ghost-renter tilbage på alle aktive lån ────────────────────────
UPDATE loans l
SET amount_remaining = c.corrected_amount_remaining,
    seasons_remaining = l.seasons_remaining + 3
FROM _ghost_loan_correction c
WHERE l.id = c.loan_id;

-- ── 4. Reducer balance med sum(ghost_overshoot) per hold ────────────────────
UPDATE teams t
SET balance = t.balance - oc.total_overshoot
FROM _team_overshoot oc
WHERE t.id = oc.team_id;

-- ── 5. Audit-snapshot EFTER ────────────────────────────────────────────────
INSERT INTO admin_log (admin_user_id, action_type, description, meta)
VALUES (
  NULL,
  'season_repaired',
  'Sæson-loop forensik 2026-05-22 (rest-correction COMPLETED): cleanup gennemført. Zero-sum justering.',
  jsonb_build_object(
    'cleanup_phase', 'loans_rest_correction_completed',
    'incident_date', '2026-05-21',
    'total_overcorrection_removed', (SELECT SUM(ghost_overshoot) FROM _ghost_loan_correction),
    'loans_corrected', (SELECT COUNT(*) FROM _ghost_loan_correction),
    'teams_corrected', (SELECT COUNT(*) FROM _team_overshoot),
    'post_cleanup_balances', (
      SELECT jsonb_object_agg(name, balance) FROM teams
      WHERE is_ai = false AND COALESCE(is_bank, false) = false AND user_id IS NOT NULL
    ),
    'post_cleanup_loans', (
      SELECT jsonb_agg(jsonb_build_object(
        'loan_id', id, 'team_id', team_id, 'amount_remaining', amount_remaining, 'seasons_remaining', seasons_remaining
      )) FROM loans WHERE status = 'active'
    )
  )
);

COMMIT;

-- ── Verifikations-queries (kør efter COMMIT for at bekræfte) ────────────────
-- Q1: Balance reconciliation skal vise diff=0 (± 1 rounding) for ALLE hold:
--   WITH bct AS (
--     SELECT team_id, SUM(amount)::BIGINT AS net_tx FROM finance_transactions
--     WHERE type != 'loan_interest' GROUP BY team_id
--   )
--   SELECT t.name, t.balance, (800000 + COALESCE(bct.net_tx, 0)) AS expected,
--          (t.balance - 800000 - COALESCE(bct.net_tx, 0)) AS diff
--   FROM teams t LEFT JOIN bct ON bct.team_id = t.id
--   WHERE is_ai=false AND COALESCE(is_bank,false)=false AND user_id IS NOT NULL AND is_frozen=false
--   ORDER BY diff DESC;
--
-- Q2: seasons_remaining skal være positiv for ALLE aktive lån:
--   SELECT loan_type, MIN(seasons_remaining), MAX(seasons_remaining), COUNT(*)
--   FROM loans WHERE status='active' GROUP BY loan_type;
--   Forventet: short {2, 2, 7}, long {4, 4, 3}
