-- Slice 07c · Atomic balance updates (Postgres-RPC)
-- Sub-issue: #81 (Slice 07 Economy Overhaul)
--
-- Problem: alle ~22 callsites i backend muterer teams.balance via 2 separate
-- Supabase calls (SELECT balance → UPDATE balance + delta) efterfulgt af et
-- 3. INSERT i finance_transactions. Mellem SELECT og UPDATE kan en parallel
-- request læse samme balance og overskrive resultatet → tabt update. Mellem
-- UPDATE og INSERT kan request crashe → balance ændret uden audit-trail.
--
-- Løsning: én Postgres-funktion der atomic UPDATE'er teams.balance OG INSERT'er
-- finance_transactions i samme DB-transaktion. pg_advisory_xact_lock(team_id)
-- serialiserer concurrent calls på samme team så lost-update-races elimineres.
--
-- Audit-kolonnerne (07d Fase A leveret 2026-05-09: actor_type, actor_id,
-- source_path, reason_code, before_balance, after_balance, related_entity_type,
-- related_entity_id, idempotency_key) accepteres allerede her i payload — men
-- 07c populerer kun before_balance + after_balance automatisk. De øvrige 7
-- audit-felter populeres af callsites i 07d Fase B (#235).
--
-- Idempotency-håndhævelse: hvis payload indeholder idempotency_key og en row
-- med samme key allerede findes (uniq_finance_idempotency_key), kaster INSERT
-- 23505 og hele RPC'en rulles tilbage — balance forbliver uændret. Callers der
-- vil håndtere duplicate-skip i stedet for fejl, fanger 23505 (samme mønster
-- som 07b's processLoanInterest / payDivisionBonuses).
--
-- Tilsvarende beskytter de eksisterende partial UNIQUE-indices fra 07b
-- (uniq_sponsor_per_team_season, uniq_salary_per_team_season,
-- uniq_bonus_per_team_season, uniq_loan_interest_per_loan_season) mod
-- duplicate writes selv uden idempotency_key — deres 23505 fanges også her.
--
-- Idempotent: CREATE OR REPLACE.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS increment_balance_with_audit(UUID, BIGINT, JSONB);

CREATE OR REPLACE FUNCTION increment_balance_with_audit(
  p_team_id UUID,
  p_delta BIGINT,
  p_finance_payload JSONB
) RETURNS BIGINT
  -- Forward-guard (#927): hold search_path sat så et re-run af denne migration
  -- ikke nulstiller phase-a/phase-b-hærdningen (advisor 0011).
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_before_balance BIGINT;
  v_after_balance BIGINT;
  v_type TEXT;
  v_amount BIGINT;
BEGIN
  -- Serialize concurrent calls for the same team. Calls for different teams
  -- run in parallel. Lock frigives automatisk ved COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- Atomic UPDATE: læs gammel balance + skriv ny i samme statement, ingen
  -- TOCTOU-vindue. Hvis team ikke findes → RETURNING returnerer ingen rows
  -- og v_after_balance forbliver NULL.
  UPDATE teams
    SET balance = balance + p_delta
    WHERE id = p_team_id
    RETURNING balance - p_delta, balance
    INTO v_before_balance, v_after_balance;

  IF v_after_balance IS NULL THEN
    RAISE EXCEPTION 'Team % not found', p_team_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Påkrævede payload-felter: type + amount.
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
    -- 07d Fase A audit-kolonner; alle nullable i payload, RPC udfylder
    -- before_balance/after_balance automatisk.
    actor_type, actor_id, source_path, reason_code,
    before_balance, after_balance,
    related_entity_type, related_entity_id, idempotency_key
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
    p_finance_payload->>'idempotency_key'
  );

  RETURN v_after_balance;
END;
$$ LANGUAGE plpgsql;

-- Sikr at PostgREST kan kalde funktionen via service-role + authenticated.
GRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION increment_balance_with_audit(UUID, BIGINT, JSONB) TO authenticated;
