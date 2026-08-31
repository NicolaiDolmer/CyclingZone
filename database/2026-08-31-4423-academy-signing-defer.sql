-- #4423 · Udskudt akademi-optagelse mens rytteren kører et etapeløb
--
-- Problem (rod-årsag B, udskilt fra #4418): finalize_academy_acquisition satte
-- is_academy=true STRAKS ved signering. isEligibleRider (riderEligibility.js)
-- afviser akademiryttere, og filterEligibleEntries (raceRunner.js) smider dem
-- derfor ud af feltet på NÆSTE etape-build. En manager der skrev en akademi-
-- kontrakt med en kandidat der lige nu kører et etapeløb for hans EGET hold
-- (den "egen ikke-akademi-rytter"-gren #4213 bevarede som legacy-sti — typisk
-- en stale academy_intake-offer der peger på en rytter der i mellemtiden er
-- landet på tilbudsholdets egen seniortrup) fik ham fjernet fra løbet uden
-- varsel. Målt i prod 30/8: 3 ryttere, alle Wander Riders, forsvundet fra
-- Giro della Penisola / Tour of South Australia efter etape 2.
--
-- Ejer-retning (#4418's afsluttende kommentar, 30/8): "en handel der flytter
-- en rytter væk fra et løb han er i gang med, håndteres allerede korrekt af
-- stageRaceTransferDefer (#1995) — akademi-stien mangler det værn." #4423's
-- egen "Foreslået løsning" markerede (a) udskyd som foretrukket.
--
-- Løsning: spejl #1995's "handel nu, fysisk flytning senere"-princip, men for
-- is_academy-flippet i stedet for team_id (som IKKE ændres i denne gren — se
-- riders.pending_team_id's kommentar i riderEligibility.js). Betaling +
-- kontrakt sker STRAKS uændret; kun selve løbs-berettigelses-flippet udskydes
-- til rytterens aktive fleretape-løb er kørt færdigt (flushDeferredAcademy-
-- SigningsForRace, backend/lib/academySigningDefer.js, kaldt fra raceRunner.js
-- SAMME to steder som #1995's flushDeferredTransfersSafe).
--
-- Ny kolonne: riders.pending_academy_signing (spejler pending_team_id — en
-- boolean er nok her, da target-holdet altid er kaldt allerede via team_id;
-- kun ØJEBLIKKET for is_academy-flippet udskydes, ikke ejerskabet).
--
-- "Aktivt fleretape-løb" = SAMME grænse som stageRaceTransferDefer/
-- raceActiveGuard: race_type='stage_race' AND status != 'completed' AND
-- stages_completed > 0.
--
-- En FRI kandidat (team_id IS NULL før signering) kan pr. definition ikke
-- allerede have en race_entries-række med team_id = p_team_id (han har aldrig
-- været på holdet), så tjekket er reelt kun aktivt for "egen senior → eget
-- akademi"-grenen — den normale intake-signering (fri rytter) er upåvirket.
--
-- IKKE i scope her: demote_rider_to_academy (academyTransfer.js's demote-flow)
-- har en BESLÆGTET, men adskilt, mangel — den rydder kun fremtidige
-- (status='scheduled' AND stages_completed=0) race_entries og lader en
-- akademi-rytter falde stille ud af et IGANGVÆRENDE løb (kommentar #3805 i
-- academyTransfer.js:210-213 anerkender det allerede). Egen sag, egen fix.
--
-- Idempotent:
--   • ADD COLUMN IF NOT EXISTS
--   • CREATE OR REPLACE FUNCTION (uændret signatur, ACL bevares → gen-asserteres)
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--
-- Rollback:
--   • Erstat funktionen med FØR-versionen fra database/2026-08-28-4213-academy-
--     acquisition-ownership-guard.sql (CREATE OR REPLACE med den gamle krop).
--   • ALTER TABLE riders DROP COLUMN IF EXISTS pending_academy_signing;
--     (kun hvis ingen rytter reelt står udskudt — tjek `SELECT count(*) FROM
--     riders WHERE pending_academy_signing` FØRST; en droppet kolonne med
--     en rytter fanget midt i udskydelsen ville tabe hans "vent på løbs-slut"-
--     tilstand og lade ham stå permanent uden for akademiet).

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS pending_academy_signing BOOLEAN NOT NULL DEFAULT false;

-- riders bruger KOLONNE-grants, ikke tabel-grants (#2238/#1309): uden denne er
-- kolonnen usynlig for klienten og en select af den 403'er tavst. Flaget er
-- ikke foelsomt (spilleren notificeres selv om tilstanden), og et fremtidigt
-- "afventer akademi-flytning"-badge skal kunne laese det.
GRANT SELECT (pending_academy_signing) ON public.riders TO anon, authenticated;

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
  v_defer BOOLEAN := false;
BEGIN
  -- Serialize concurrent calls for the same team. SAMME lock-nøgle som
  -- increment_balance_with_audit, så de to RPC'er serialiserer på samme team.
  -- Lock frigives automatisk ved COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- (a) 8-plads akademi-cap (hård) — NU inde i låsen. Tæller akademiryttere på
  -- holdet. Fyldt → ingen writes. (Uændret: en udskudt optagelse tæller IKKE
  -- med her — han er ikke i akademiet endnu, kun på vej.)
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

  -- (c0) #4423: skal selve løbs-berettigelses-flippet (is_academy=true) UDSKYDES?
  -- Ja, hvis rytteren lige nu har en levende race_entries-binding hos DETTE hold
  -- i et aktivt fleretape-løb — spejler getRidersInActiveStageRace
  -- (stageRaceTransferDefer.js). Relevant kun for "egen senior → eget akademi"-
  -- grenen: en fri rytter (team_id IS NULL) kan aldrig matche re.team_id = p_team_id.
  SELECT EXISTS (
    SELECT 1
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.rider_id = p_rider_id
      AND re.team_id = p_team_id
      AND r.race_type = 'stage_race'
      AND r.status != 'completed'
      AND r.stages_completed > 0
  ) INTO v_defer;

  -- (c) Optag rytteren. Guard (#4213): kun en fri rytter, eller holdets EGEN
  -- ikke-akademi-rytter, må optages. En rytter ejet af et andet hold giver 0
  -- rows → 'rider_owned'; en allerede optaget akademirytter giver 0 rows →
  -- 'already_assigned'. Begge UDEN debit (lukker det omvendte tab: køber
  -- debiteret uden at få rytteren). #4423: er v_defer sand, IKKE flip is_academy
  -- endnu — kontrakt/løn/team_id sættes stadig med det samme, kun berettigelses-
  -- flaget venter (pending_academy_signing=true). flushDeferredAcademySigningsForRace
  -- flipper den når løbet er kørt færdigt.
  UPDATE riders
    SET team_id = p_team_id,
        is_academy = CASE WHEN v_defer THEN is_academy ELSE true END,
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

  -- (d) Debit (kun ved betalende optagelse). Replikerer
  -- increment_balance_with_audit's UPDATE + INSERT så debit + finance-row sker
  -- under SAMME lås som cap/rider-update. p_price = 0 (free-agent) → ingen debit.
  -- Uændret af #4423: betalingen sker STRAKS uanset om flippet er udskudt.
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

  -- (e) Succes. academy_count = før-optagelse-tællingen + 1, MEDMINDRE flippet
  -- er udskudt (så er han ikke reelt i akademiet endnu). 'deferred' lader
  -- signAcademyCandidate vælge den rigtige notifikations-besked.
  RETURN jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'academy_count', v_academy_count + (CASE WHEN v_defer THEN 0 ELSE 1 END),
    'deferred', v_defer
  );
END;
$$ LANGUAGE plpgsql;

-- Gen-assert ACL'en fra 2026-07-11/2026-07-12-hærdningen. CREATE OR REPLACE
-- bevarer ACL, så dette er dokumenterende no-ops — men de gør hensigten læsbar
-- og sikrer at et re-run af DENNE fil alene efterlader den rigtige tilstand.
REVOKE ALL     ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb) TO service_role;
