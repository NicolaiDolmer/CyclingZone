-- Refs #666 · backend message-codes
--
-- Problem: backend/lib/* hardcoder DA-strings i finance_transactions.description
-- og notifications.title/message. På EN-locale renderes disse direkte → DA-leaks
-- på FinancePage (debt-warning, sponsor-tx, loan-repay-tx) + alle notif-flows.
--
-- Løsning: tilføj nullable `metadata` JSONB-kolonne til begge tabeller. Backend
-- skriver fremad strukturerede payloads ({ code, params } for tx; { titleCode,
-- titleParams, messageCode, messageParams } for notifs). Frontend renderer via
-- i18next når metadata er sat; falder tilbage til description/title/message
-- for legacy-rows (vises som DA — acceptabelt for historik per #666 Option A).
--
-- description/title/message-kolonnerne beholdes som fallback + dedup-signatur
-- for notifications-service. Backend skriver fortsat informative strenge dér,
-- men fra denne PR i EN (ikke DA), så selv uden metadata viser EN-locale EN-tekst.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
--
-- Rollback:
--   ALTER TABLE finance_transactions DROP COLUMN IF EXISTS metadata;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS metadata;
--   (RPC: re-apply database/2026-05-09-balance-rpc.sql for at vende tilbage til
--    versionen uden metadata-insert.)

ALTER TABLE finance_transactions
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN finance_transactions.metadata IS
  '#666: structured {code, params} for locale-aware rendering. NULL for legacy rows; description is fallback.';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN notifications.metadata IS
  '#666: structured {titleCode, titleParams, messageCode, messageParams}. NULL for legacy rows; title/message are fallback.';

-- Opdatér increment_balance_with_audit RPC til at inkludere metadata i INSERT.
-- Bagudkompatibel: payload uden metadata-key indsætter NULL (DEFAULT i kolonne-
-- definitionen er NULL — eksisterende callsites påvirkes ikke).
--
-- p_finance_payload->'metadata' returnerer JSONB (vs ->>'metadata' der ville
-- coerce til text). PostgreSQL accepterer JSONB null som NULL ved insert.

CREATE OR REPLACE FUNCTION increment_balance_with_audit(
  p_team_id UUID,
  p_delta BIGINT,
  p_finance_payload JSONB
) RETURNS BIGINT AS $$
DECLARE
  v_before_balance BIGINT;
  v_after_balance BIGINT;
  v_type TEXT;
  v_amount BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  UPDATE teams
    SET balance = balance + p_delta
    WHERE id = p_team_id
    RETURNING balance - p_delta, balance
    INTO v_before_balance, v_after_balance;

  IF v_after_balance IS NULL THEN
    RAISE EXCEPTION 'Team % not found', p_team_id USING ERRCODE = 'no_data_found';
  END IF;

  v_type := p_finance_payload->>'type';
  v_amount := (p_finance_payload->>'amount')::BIGINT;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'finance_payload.type er påkrævet';
  END IF;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'finance_payload.amount er påkrævet';
  END IF;

  INSERT INTO finance_transactions(
    team_id, type, amount, description,
    season_id, race_id, related_loan_id,
    actor_type, actor_id, source_path, reason_code,
    before_balance, after_balance,
    related_entity_type, related_entity_id, idempotency_key,
    metadata
  ) VALUES (
    p_team_id,
    v_type,
    v_amount,
    p_finance_payload->>'description',
    NULLIF(p_finance_payload->>'season_id', '')::UUID,
    NULLIF(p_finance_payload->>'race_id', '')::UUID,
    NULLIF(p_finance_payload->>'related_loan_id', '')::UUID,
    p_finance_payload->>'actor_type',
    NULLIF(p_finance_payload->>'actor_id', '')::UUID,
    p_finance_payload->>'source_path',
    p_finance_payload->>'reason_code',
    v_before_balance,
    v_after_balance,
    p_finance_payload->>'related_entity_type',
    NULLIF(p_finance_payload->>'related_entity_id', '')::UUID,
    p_finance_payload->>'idempotency_key',
    p_finance_payload->'metadata'
  );

  RETURN v_after_balance;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO authenticated;
