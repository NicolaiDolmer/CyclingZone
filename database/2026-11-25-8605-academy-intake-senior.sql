-- #8605: allow direct senior placement through the existing locked intake settlement.
-- The #8034 rider trigger remains the authority for club and reserved places.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.finalize_academy_acquisition(
  p_team_id UUID,
  p_rider_id UUID,
  p_price BIGINT,
  p_salary BIGINT,
  p_contract_length INTEGER,
  p_contract_end_season INTEGER,
  p_acquired_at TIMESTAMPTZ,
  p_finance_payload JSONB,
  p_squad TEXT,
  p_squad_cap INTEGER
) RETURNS JSONB
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_squad_count INTEGER;
  v_balance BIGINT;
  v_before_balance BIGINT;
  v_after_balance BIGINT;
  v_updated INTEGER;
  v_owner UUID;
  v_type TEXT;
  v_amount BIGINT;
  v_defer BOOLEAN := false;
  v_intake_id uuid := NULLIF(p_finance_payload->>'academy_intake_id', '')::uuid;
BEGIN
  IF p_squad IS NULL OR p_squad NOT IN ('junior', 'u23', 'senior')
     OR (p_squad = 'senior' AND v_intake_id IS NULL)
     OR p_squad_cap IS NULL OR p_squad_cap < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_squad');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- Lock the offer through capacity checking, registration and settlement.
  -- Auction callers keep their existing contract and cannot select senior.
  IF v_intake_id IS NOT NULL OR p_finance_payload->>'idempotency_key' = 'academy_signing:' || p_rider_id::text THEN
    SELECT id INTO v_intake_id FROM public.academy_intake
    WHERE team_id = p_team_id AND rider_id = p_rider_id AND status = 'offered'
      AND (v_intake_id IS NULL OR id = v_intake_id)
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_offered');
    END IF;
  END IF;

  -- (a) Loft pr. MÅL-trup, inde i låsen. Fyldt → ingen writes. (Uændret: en
  -- udskudt optagelse tæller ikke — han er ikke i akademiet endnu, kun på vej.)
  v_squad_count := count_team_squad_members(p_team_id, p_squad, p_rider_id);
  IF v_squad_count >= p_squad_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'academy_full');
  END IF;

  -- (b) Balance-tjek (kun ved betalende optagelse). Uændret.
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

  -- (c0) #4423: udskyd selve akademi-flippet hvis rytteren kører et aktivt
  -- fleretape-løb for DETTE hold. Uændret.
  SELECT p_squad <> 'senior' AND EXISTS (
    SELECT 1
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.rider_id = p_rider_id
      AND re.team_id = p_team_id
      AND r.race_type = 'stage_race'
      AND r.status != 'completed'
      AND r.stages_completed > 0
  ) INTO v_defer;

  -- (c) Optag rytteren. is_academy OG squad skrives i SAMME række-skrivning. Er
  -- flippet udskudt, røres ingen af dem: rytteren kører videre som seniorrytter,
  -- og de to kolonner forbliver enige. Guard (#4213) uændret.
  UPDATE riders
    SET team_id = p_team_id,
        is_academy = CASE WHEN v_defer THEN is_academy ELSE p_squad <> 'senior' END,
        squad = CASE WHEN v_defer THEN squad ELSE p_squad END,
        pending_academy_signing = v_defer,
        salary = p_salary,
        contract_length = p_contract_length,
        contract_end_season = p_contract_end_season,
        acquired_at = p_acquired_at,
        pending_team_id = NULL
    WHERE id = p_rider_id
      AND (team_id IS NULL OR (team_id = p_team_id AND is_academy = false));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    SELECT team_id INTO v_owner FROM riders WHERE id = p_rider_id;
    IF v_owner IS NOT NULL AND v_owner <> p_team_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'rider_owned');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'already_assigned');
  END IF;

  -- (d) Debit + finance-række under SAMME lås. Uændret. En dublet-idempotency_key
  -- (23505) ruller HELE transaktionen tilbage, også is_academy/squad-skrivningen.
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
    SELECT balance INTO v_balance FROM teams WHERE id = p_team_id;
  END IF;

  IF v_intake_id IS NOT NULL THEN
    UPDATE public.academy_intake
    SET status = 'signed', resolved_at = p_acquired_at, signing_fee = p_price
    WHERE id = v_intake_id;
  END IF;

  -- (e) Succes. squad_count = pladser i mål-truppen efter optagelsen (uændret hvis
  -- flippet er udskudt — så er han ikke reelt i truppen endnu).
  RETURN jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'squad', p_squad,
    'squad_count', v_squad_count + (CASE WHEN v_defer THEN 0 ELSE 1 END),
    'deferred', v_defer,
    'intake_resolved', v_intake_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer) TO service_role;

-- Protect signed offers from stale rejection/expiry writes during a rolling deploy.
CREATE OR REPLACE FUNCTION public.guard_signed_academy_intake_8605()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'signed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'not_offered' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_signed_academy_intake_8605() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_signed_academy_intake_8605 ON public.academy_intake;
CREATE TRIGGER guard_signed_academy_intake_8605 BEFORE UPDATE OF status ON public.academy_intake
FOR EACH ROW EXECUTE FUNCTION public.guard_signed_academy_intake_8605();

COMMIT;
