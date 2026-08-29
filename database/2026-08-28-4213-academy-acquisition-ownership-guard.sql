-- #4213 · Ejerskabs-guard i finalize_academy_acquisition
--
-- Problem: guarden på rider-update'en var
--     AND (team_id IS NULL OR is_academy = false)
-- `is_academy = false`-grenen var tænkt til at et hold kunne flytte sin EGEN
-- seniorrytter ind i sit EGET akademi, men den var ikke bundet til holdet.
-- Konsekvens: en manager der accepterede et stale akademitilbud på en rytter
-- der i mellemtiden var ejet af et ANDET hold, tog rytteren direkte — uden
-- handel, uden betaling til sælgeren og uden ejerskabslog. Målt 28/8: 278
-- 'offered'-rækker pegede på ryttere ejet af AI-hold, alle synlige for
-- menneskehold, alle med is_academy = false → guarden lukkede dem igennem.
--
-- Verificeret før stramningen (28/8):
--   • Kun to callers i produktion: signAcademyCandidate (academyIntake.js) og
--     finalizeYouthAuctionRecord (auctionFinalization.js). Begge optager en FRI
--     rytter; auktions-stien er team-løs pr. konstruktion (deleteUnsoldYouthRider
--     er fallback).
--   • Demote-stien (egen senior → eget akademi) bruger sin EGEN RPC,
--     demote_rider_to_academy (migration 2026-06-25) — den går IKKE her igennem.
--     `is_academy = false`-grenen tjener altså ingen legitim sti længere.
--
-- Ny guard:
--     AND (team_id IS NULL OR (team_id = p_team_id AND is_academy = false))
-- • fri rytter                              → optages (uændret)
-- • egen ikke-akademi-rytter                → optages (legacy-grenen, nu team-bundet)
-- • egen akademi-rytter (gen-signering)     → 0 rows → 'already_assigned', ingen debit (uændret)
-- • rytter ejet af ANDET hold               → 0 rows → NY kode 'rider_owned', ingen debit
--
-- 'rider_owned' skelnes fra 'already_assigned' så backend kan selv-hele den
-- stale intake-række (flip til 'rejected') og spilleren får en præcis besked.
--
-- Idempotent: CREATE OR REPLACE med uændret signatur (ACL bevares — funktionen
-- er service_role-only siden 2026-07-11/2026-07-12; gen-asserteres nederst).
--
-- Rollback: erstat guard-linjen med
--     AND (team_id IS NULL OR is_academy = false)
-- og fjern v_owner-blokken (gen-kør derefter denne fils CREATE OR REPLACE-form
-- fra git-historikken før denne fil).

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
  v_owner UUID;
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

  -- (c) Optag rytteren. Guard (#4213): kun en fri rytter, eller holdets EGEN
  -- ikke-akademi-rytter, må optages. En rytter ejet af et andet hold giver 0
  -- rows → 'rider_owned'; en allerede optaget akademirytter giver 0 rows →
  -- 'already_assigned'. Begge UDEN debit (lukker det omvendte tab: køber
  -- debiteret uden at få rytteren).
  UPDATE riders
    SET team_id = p_team_id,
        is_academy = true,
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

-- Gen-assert ACL'en fra 2026-07-11/2026-07-12-hærdningen. CREATE OR REPLACE
-- bevarer ACL, så dette er dokumenterende no-ops — men de gør hensigten læsbar
-- og sikrer at et re-run af DENNE fil alene efterlader den rigtige tilstand.
REVOKE ALL     ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) TO service_role;
