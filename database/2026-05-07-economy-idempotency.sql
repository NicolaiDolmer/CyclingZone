-- Slice 07b · TOCTOU-fixes + idempotency-keys for sponsor/salary/bonus/loan-interest payouts.
--
-- Problem: 4 cron-payouts har ingen DB-håndhævet uniqueness. App-niveau "alreadyPaid"-checks
-- (payDivisionBonuses) er TOCTOU-følsomme: 2 cron-runs kan begge bestå tjekket og INSERT'e
-- duplicate finance_transactions. processLoanInterest har slet ingen idempotency. Resultat
-- ved retry/timeout: dobbelt-charge, dobbelt-bonus, dobbelt-sponsor.
--
-- Reference-mønster: 2026-05-06-auctions-unique-active-rider.sql (partial UNIQUE index på
-- auctions(rider_id) WHERE status IN ('active','extended')) løste samme race for auktioner
-- den 5. maj 2026.
--
-- Backend-fix (separate commits): unique_violation (PG 23505) fanges i økonomi-engines og
-- mappes til en stille skip + log. Cron-retry bliver dermed sikker.
--
-- VIGTIGT FØR MIGRATION KØRES:
--   Validér at ingen eksisterende dubletter findes som ville bryde indexet:
--     SELECT team_id, season_id, type, COUNT(*) FROM finance_transactions
--      WHERE type IN ('sponsor','salary','bonus') AND season_id IS NOT NULL
--      GROUP BY 1,2,3 HAVING COUNT(*) > 1;
--   Hvis rows returneres → ryd manuelt (eller behold ÉN per gruppe og soft-delete resten)
--   før denne migration kører.
--
-- Idempotent (IF NOT EXISTS).

-- ── 1. Sponsor: én per (team, season) ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sponsor_per_team_season
  ON finance_transactions(team_id, season_id)
  WHERE type = 'sponsor' AND season_id IS NOT NULL;

-- ── 2. Salary: én per (team, season) ──────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_salary_per_team_season
  ON finance_transactions(team_id, season_id)
  WHERE type = 'salary' AND season_id IS NOT NULL;

-- ── 3. Division-bonus: én per (team, season) ──────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bonus_per_team_season
  ON finance_transactions(team_id, season_id)
  WHERE type = 'bonus' AND season_id IS NOT NULL;

-- ── 4. Loan-interest: kræver ny related_loan_id-kolonne ──────────────────────
-- Kolonnen tilføjes så DB kan håndhæve UNIQUE per (loan, season). Backend
-- (loanEngine.processLoanInterest) skal sende related_loan_id i finance_transactions.insert.
ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS related_loan_id UUID REFERENCES loans(id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_loan_interest_per_loan_season
  ON finance_transactions(related_loan_id, season_id)
  WHERE type = 'loan_interest' AND related_loan_id IS NOT NULL AND season_id IS NOT NULL;

-- ── 5. createLoan atomic — beskyt debt_ceiling mod TOCTOU ─────────────────────
-- App-koden (loanEngine.createLoan) beregner currentDebt + tjekker ceiling, så
-- INSERT'er. Mellem disse 2 trin kan en parallel call udføre den samme
-- beregning og pass-through ceiling-check. Resultat: 2 lån over loftet.
--
-- Denne RPC samler tjek + INSERT i én Postgres-transaktion med
-- pg_advisory_xact_lock(team_id), så concurrent calls serialiseres på team-id
-- niveauet. Lock frigives automatisk ved COMMIT/ROLLBACK.
CREATE OR REPLACE FUNCTION create_loan_atomic(
  p_team_id UUID,
  p_loan_type TEXT,
  p_principal BIGINT,
  p_origination_fee BIGINT,
  p_interest_rate NUMERIC,
  p_seasons INTEGER,
  p_debt_ceiling BIGINT
) RETURNS loans AS $$
DECLARE
  v_current_debt BIGINT;
  v_total_owed BIGINT;
  v_loan loans;
BEGIN
  -- Lock on team_id space (high 64 bits = team UUID hash). Concurrent calls
  -- for the same team queue up; calls for different teams run in parallel.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  v_total_owed := p_principal + p_origination_fee;

  SELECT COALESCE(SUM(amount_remaining), 0)
    INTO v_current_debt
    FROM loans
    WHERE team_id = p_team_id AND status = 'active';

  IF v_current_debt + v_total_owed > p_debt_ceiling THEN
    RAISE EXCEPTION 'Gældsloft på % CZ$ nået for denne division', p_debt_ceiling
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO loans(
    team_id, loan_type, principal, origination_fee, interest_rate,
    seasons_total, seasons_remaining, amount_remaining, status
  ) VALUES (
    p_team_id, p_loan_type, p_principal, p_origination_fee, p_interest_rate,
    p_seasons, p_seasons, v_total_owed, 'active'
  ) RETURNING * INTO v_loan;

  RETURN v_loan;
END;
$$ LANGUAGE plpgsql;

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS create_loan_atomic(UUID, TEXT, BIGINT, BIGINT, NUMERIC, INTEGER, BIGINT);
-- DROP INDEX IF EXISTS uniq_sponsor_per_team_season;
-- DROP INDEX IF EXISTS uniq_salary_per_team_season;
-- DROP INDEX IF EXISTS uniq_bonus_per_team_season;
-- DROP INDEX IF EXISTS uniq_loan_interest_per_loan_season;
-- ALTER TABLE finance_transactions DROP COLUMN IF EXISTS related_loan_id;
