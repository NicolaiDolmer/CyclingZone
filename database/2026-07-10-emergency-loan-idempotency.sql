-- #2301 — Nødlån ikke idempotent ved cron-genkørsel (dobbelt-udstedelse) + loft
-- 1/sæson + bestyrelses-eskalering.
--
-- Fund (finance-audit 10/7): createEmergencyLoan havde ingen idempotency_key på
-- balance-krediteringen, og loans-tabellen manglede season_id — så JSDoc'ens
-- påstand om idempotens via partial unique indices holdt ikke. Ved cron-
-- genkørsel af season-start sprang lønnen over (allerede idempotent-debiteret),
-- men balancen var stadig for lav → et NYT nødlån blev udstedt (penge skabt +
-- ekstra gæld).
--
-- 1) loans.season_id (mangler i dag) — nødvendig for pr.-sæson-uniqueness.
--    NULL for eksisterende rows (pre-fix) — UNIQUE ekskluderer NULL <> NULL i
--    Postgres, så backfill er ufarlig/unødvendig.
-- 2) DB-guard: maks ét emergency-lån pr. (team_id, season_id).
-- 3) teams.emergency_loan_streak — eskalering: tæller sammenhængende sæsoner
--    med nødlån (adskilt fra debt_breach_streak, som måler gælds-LOFT-brud,
--    ikke nødlåns-HYPPIGHED). Håndhæves i app-koden (economyEngine.js).
-- 4) create_emergency_loan_atomic: check-existing FØR insert (idempotent no-op)
--    + season_id på insert. Advisory-lock (uændret, pr. team_id) serialiserer
--    allerede concurrent calls, så check-then-insert er race-safe.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE). Rollback nederst.
BEGIN;

ALTER TABLE loans ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_emergency_loan_per_team_season
  ON loans (team_id, season_id)
  WHERE loan_type = 'emergency' AND season_id IS NOT NULL;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS emergency_loan_streak INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION create_emergency_loan_atomic(
  p_team_id UUID, p_amount_needed BIGINT, p_origination_fee_pct NUMERIC,
  p_interest_rate NUMERIC, p_debt_ceiling BIGINT, p_season_id UUID DEFAULT NULL
) RETURNS loans AS $$
DECLARE v_current_debt BIGINT; v_headroom BIGINT; v_principal BIGINT; v_fee BIGINT; v_loan loans;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  IF p_season_id IS NOT NULL THEN
    SELECT * INTO v_loan FROM loans
      WHERE team_id = p_team_id AND loan_type = 'emergency' AND season_id = p_season_id
      LIMIT 1;
    IF FOUND THEN RETURN v_loan; END IF;
  END IF;

  SELECT COALESCE(SUM(amount_remaining), 0) INTO v_current_debt FROM loans WHERE team_id = p_team_id AND status = 'active';
  v_headroom := GREATEST(0, p_debt_ceiling - v_current_debt);
  v_principal := LEAST(p_amount_needed, FLOOR(v_headroom / (1 + p_origination_fee_pct)));
  IF v_principal <= 0 THEN RETURN NULL; END IF;
  v_fee := ROUND(v_principal * p_origination_fee_pct);
  INSERT INTO loans(team_id, loan_type, principal, origination_fee, interest_rate,
    seasons_total, seasons_remaining, amount_remaining, status, season_id)
  VALUES (p_team_id, 'emergency', v_principal, v_fee, p_interest_rate, 1, 1, v_principal + v_fee, 'active', p_season_id)
  RETURNING * INTO v_loan;
  RETURN v_loan;
END; $$ LANGUAGE plpgsql;

COMMIT;
-- Rollback:
--   DROP INDEX IF EXISTS uniq_emergency_loan_per_team_season;
--   ALTER TABLE loans DROP COLUMN IF EXISTS season_id;
--   ALTER TABLE teams DROP COLUMN IF EXISTS emergency_loan_streak;
--   -- Gendan create_emergency_loan_atomic uden p_season_id/check-existing:
--   -- se database/2026-06-17-e3-emergency-hard-floor.sql for forrige version.
