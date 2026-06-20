-- #1558 · Atomær akademi-optagelse (lukker race + dobbelt-debit)
--
-- Problem: tre akademi-write-stier (finalizeYouthAuctionRecord,
-- signAcademyCandidate, signFreeAgentYouth) udførte hver et ULÅST
-- getTeamAcademyCount() (separat SELECT) efterfulgt af ubeskyttede skrivninger
-- (UPDATE riders + increment_balance_with_audit). Lockingen sad KUN inde i
-- balance-RPC'en og spændte hverken over count-tjek eller rider-update.
--
-- To krydser gav reelt penge-/cap-tab:
--   1. finalizeYouthAuctionRecord vs. en samtidig finalize (samme team).
--   2. finalizeYouthAuctionRecord vs. signAcademyCandidate — de brugte
--      FORSKELLIGE idempotency-keys (youth_auction_winner:<id> vs. INGEN key på
--      academy_signing) → to separate finance_transactions → idempotency-key
--      alene lukkede IKKE racen.
--
-- Løsning: én plpgsql-funktion der under pg_advisory_xact_lock(team_id) (SAMME
-- lock-nøgle som increment_balance_with_audit, så de serialiserer på samme team)
-- udfører count-tjek → balance-tjek → rider-update → (betinget) debit atomisk i
-- én DB-transaktion. 8-plads-cap (GAME_INVARIANTS.md) håndhæves nu INDE i låsen.
--
-- Rider-update'en har en guard (team_id IS NULL OR is_academy = false) så en
-- allerede-optaget rytter giver 0 rows → 'already_assigned' UDEN debit; det
-- lukker det omvendte tab (køber debiteret uden at få rytteren).
--
-- Idempotens bevares: debit-grenen indsætter stadig en finance_transactions-row
-- med idempotency_key fra payload (uniq_finance_idempotency_key), så
-- cron-retries ikke double-pay'er. Den atomære lås lukker racen; idempotency-key
-- gør cron-retries sikre. Begge nødvendige.
--
-- p_price = 0 (free-agent direct-sign) → kun cap + rider-update under lås, ingen
-- debit/finance-insert.
--
-- Returnerer JSONB:
--   { ok: false, code: 'academy_full' }          — cap nået, ingen writes
--   { ok: false, code: 'insufficient_balance' }  — balance < price, ingen writes
--   { ok: false, code: 'already_assigned' }      — rytter allerede optaget, ingen debit
--   { ok: true,  balance: <bigint>, academy_count: <int> }
--
-- Idempotent: CREATE OR REPLACE.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS finalize_academy_acquisition(
--     UUID, UUID, BIGINT, BIGINT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB);

CREATE OR REPLACE FUNCTION finalize_academy_acquisition(
  p_team_id UUID,
  p_rider_id UUID,
  p_price BIGINT,
  p_salary BIGINT,
  p_contract_length INTEGER,
  p_contract_end_season INTEGER,
  p_acquired_at TIMESTAMPTZ,
  p_finance_payload JSONB
) RETURNS JSONB
  -- Forward-guard (#927): hold search_path sat så et re-run af denne migration
  -- ikke nulstiller hærdningen (advisor 0011).
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_academy_count INTEGER;
  v_balance BIGINT;
  v_before_balance BIGINT;
  v_after_balance BIGINT;
  v_updated INTEGER;
  v_type TEXT;
  v_amount BIGINT;
BEGIN
  -- Serialize concurrent calls for the same team. SAMME lock-nøgle som
  -- increment_balance_with_audit, så de to RPC'er serialiserer på samme team.
  -- Lock frigives automatisk ved COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- (a) 8-plads akademi-cap (hård) — NU inde i låsen. Tæller akademiryttere på
  -- holdet. Fyldt → ingen writes.
  SELECT count(*) INTO v_academy_count
    FROM riders
    WHERE team_id = p_team_id AND is_academy = true;

  IF v_academy_count >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'academy_full');
  END IF;

  -- (b) Balance-tjek (kun ved betalende optagelse). FOR UPDATE låser team-rækken
  -- så balancen ikke ændres mellem tjek og debit (advisory-låsen serialiserer
  -- allerede mod andre kald af denne RPC + balance-RPC'en; FOR UPDATE er
  -- belt-and-suspenders mod direkte UPDATE teams udenom RPC'erne).
  IF p_price > 0 THEN
    SELECT balance INTO v_balance
      FROM teams
      WHERE id = p_team_id
      FOR UPDATE;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Team % not found', p_team_id USING ERRCODE = 'no_data_found';
    END IF;

    IF v_balance < p_price THEN
      RETURN jsonb_build_object('ok', false, 'code', 'insufficient_balance');
    END IF;
  END IF;

  -- (c) Optag rytteren i akademiet. Guard: kun en fri rytter (team_id IS NULL)
  -- eller en eksisterende ikke-akademi-rytter må optages — en allerede optaget
  -- akademirytter giver 0 rows → 'already_assigned' UDEN debit (lukker det
  -- omvendte tab: køber debiteret uden at få rytteren).
  UPDATE riders
    SET team_id = p_team_id,
        is_academy = true,
        salary = p_salary,
        contract_length = p_contract_length,
        contract_end_season = p_contract_end_season,
        acquired_at = p_acquired_at,
        pending_team_id = NULL
    WHERE id = p_rider_id
      AND (team_id IS NULL OR is_academy = false);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_assigned');
  END IF;

  -- (d) Debit (kun ved betalende optagelse). Replikerer
  -- increment_balance_with_audit's UPDATE + INSERT så debit + finance-row sker
  -- under SAMME lås som cap/rider-update. p_price = 0 (free-agent) → ingen debit.
  IF p_price > 0 THEN
    UPDATE teams
      SET balance = balance - p_price
      WHERE id = p_team_id
      RETURNING balance + p_price, balance
      INTO v_before_balance, v_after_balance;

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

    v_balance := v_after_balance;
  ELSE
    -- Gratis optagelse: balance uændret. Læs den til returværdien.
    SELECT balance INTO v_balance FROM teams WHERE id = p_team_id;
  END IF;

  -- (e) Succes. academy_count = før-optagelse-tællingen + 1 (den nye rytter).
  RETURN jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'academy_count', v_academy_count + 1
  );
END;
$$ LANGUAGE plpgsql;

-- Sikr at PostgREST kan kalde funktionen via service-role + authenticated
-- (signAcademyCandidate/signFreeAgentYouth kører authenticated-side; cron via
-- service_role).
GRANT EXECUTE ON FUNCTION finalize_academy_acquisition(
  UUID, UUID, BIGINT, BIGINT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_academy_acquisition(
  UUID, UUID, BIGINT, BIGINT, INTEGER, INTEGER, TIMESTAMPTZ, JSONB
) TO authenticated;
