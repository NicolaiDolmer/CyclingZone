-- #5432 · Loft pr. trup i akademi-RPC'erne (rest fra #4619 slice 1)
--
-- Regler: docs/YOUTH_RULES.md §2.1 (trup-aldre) + §2.4 (loft pr. trup erstatter den
-- flade akademi-cap). Loftet og aldersgrænsen pr. trup bor ÉT sted:
-- backend/lib/squads.js (SQUAD_CAPS, SQUAD_MAX_AGE). Denne fil kender INGEN af
-- tallene — kalderen sender truppen, dens loft og (ved nedrykning) dens aldersloft
-- med ind som argumenter. Et tredje hårdkodet tal i SQL var netop fejlen: de to
-- RPC'er talte alle akademiryttere under ét mod et fladt tal og vandt dermed over
-- de nye lofter pr. trup.
--
-- HVAD DEN GØR
--   1) count_team_squad_members(team, trup, udeladt rytter) — ÉT tælle-prædikat for
--      alle tre RPC'er, kaldt INDE i advisory-låsen.
--   2) demote_rider_to_academy: tæller pr. MÅL-trup, aldersgaten bruger det
--      aldersloft kalderen sender, og squad skrives i SAMME UPDATE som is_academy.
--   3) finalize_academy_acquisition (ungdomsauktion + intake-signering): tæller pr.
--      mål-trup og skriver squad i SAMME UPDATE som is_academy. En udskudt optagelse
--      (#4423, rytteren kører et etapeløb) rører hverken is_academy eller squad.
--   4) move_academy_rider_squad (ny): flyt en akademirytter mellem junior og U23
--      under samme lås og samme tælling (backend/lib/academyTransfer.js moveRider).
--   5) Gen-assertér ACL'en (service_role only) og bed PostgREST genindlæse skemaet.
--
-- TÆLLINGEN I OVERGANGSPERIODEN [kritisk]
-- #4619-backfill'en (backend/scripts/backfill-4619-riders-squad.js) er ejer-gated.
-- Indtil den er kørt, står akademiryttere med is_academy = true OG squad = 'senior'
-- (kolonnens DEFAULT). En ren `squad = p_squad`-tælling ville ikke se dem og lade
-- truppen fylde op forbi loftet. Prædikatet tæller dem derfor med i BEGGE
-- ungdomstrupper: det kan kun gøre gaten STRENGERE (aldrig mildere) før
-- backfill'en, og efter backfill'en findes der ingen sådanne rækker, så tællingen
-- er eksakt. Backfill'en skal stadig køres før merge, ellers er lofterne for
-- stramme for hold med mange akademiryttere.
--
-- SIGNATURER
-- demote_rider_to_academy og finalize_academy_acquisition får nye argumenter.
-- Postgres identificerer en funktion ved sin argumentliste, så den gamle signatur
-- DROPPES eksplicit i samme transaktion — ellers ville den gamle overload med den
-- flade cap blive liggende ved siden af og kunne kaldes af gammel kode. DROP +
-- CREATE sker i én transaktion, så der findes intet øjeblik uden funktionen.
-- Backend deployer før auto-migrate.yml applier (3 min, docs/AUTO_MIGRATION_SETUP.md);
-- i det vindue svarer PostgREST "function not found" på de nye kald, og alle tre
-- stier fejler højlydt uden at skrive noget (auktions-cron'en prøver igen næste pas).
--
-- IDEMPOTENT: DROP FUNCTION IF EXISTS (gammel signatur) + CREATE OR REPLACE (ny).
-- Anden kørsel = no-op. Ingen data muteres.
--
-- ⚠️ Applies af auto-migrate.yml ved merge (#2642). Ikke destruktiv for data.
--
-- Rollback: gen-kør den forrige krop af hver funktion
--   demote_rider_to_academy      → database/2026-06-25-academy-promote-demote.sql §1
--   finalize_academy_acquisition → database/2026-08-31-4423-academy-signing-defer.sql
-- efter at have droppet de nye signaturer:
--   DROP FUNCTION IF EXISTS public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer);
--   DROP FUNCTION IF EXISTS public.move_academy_rider_squad(uuid, uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.count_team_squad_members(uuid, text, uuid);
-- og backend-koden der sender de nye argumenter skal rulles tilbage samtidig.

BEGIN;

-- ─── 1. Ét tælle-prædikat ────────────────────────────────────────────────────
-- Optagede pladser i en UNGDOMStrup på et hold. p_exclude_rider_id udelader den
-- rytter der er ved at blive flyttet, så han aldrig tæller mod sin egen plads.
CREATE OR REPLACE FUNCTION public.count_team_squad_members(
  p_team_id UUID,
  p_squad TEXT,
  p_exclude_rider_id UUID DEFAULT NULL
) RETURNS INTEGER
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $$
  SELECT count(*)::INTEGER
    FROM riders
    WHERE team_id = p_team_id
      AND (p_exclude_rider_id IS NULL OR id <> p_exclude_rider_id)
      AND (
        squad = p_squad
        -- Overgangsperioden: en akademirytter uden trup (før #4619-backfill'en)
        -- tæller i BEGGE ungdomstrupper. Se filens header.
        OR (is_academy = true AND squad = 'senior')
      );
$$;

-- ─── 2. demote_rider_to_academy ──────────────────────────────────────────────
-- Returnerer JSONB:
--   { ok:false, code:'invalid_squad' }      — p_squad er ikke en ungdomstrup / loft mangler
--   { ok:false, code:'not_owned' }          — rytteren ejes ikke af holdet
--   { ok:false, code:'already_academy' }    — rytteren er allerede akademirytter
--   { ok:false, code:'not_u23' }            — for gammel til U23 (mål-trup u23)
--   { ok:false, code:'too_old_for_squad' }  — for gammel til mål-truppen (junior)
--   { ok:false, code:'rider_on_market' }    — aktiv auktion (active/extended)
--   { ok:false, code:'rider_listed' }       — åben transfer-listing (open/negotiating)
--   { ok:false, code:'academy_full' }       — mål-truppen er fuld (koden er uændret:
--                                             frontend læser netop den streng)
--   { ok:true, new_salary, rows_deleted, squad, squad_count }
--
-- p_season_start_year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) fra kalderen, så
-- alderen spejler ageForSeason (backend/lib/riderSeasonAge.js). Aldersloftet selv
-- (p_squad_max_age) kommer fra squads.js SQUAD_MAX_AGE.
DROP FUNCTION IF EXISTS public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.demote_rider_to_academy(
  p_team_id UUID,
  p_rider_id UUID,
  p_new_salary BIGINT,
  p_contract_length INTEGER,
  p_contract_end INTEGER,
  p_season_start_year INTEGER,
  p_squad TEXT,
  p_squad_cap INTEGER,
  p_squad_max_age INTEGER
) RETURNS JSONB
  LANGUAGE plpgsql
  -- Forward-guard (#927, advisor 0011): search_path i SAMME statement, så et re-run
  -- aldrig efterlader funktionen uden hærdningen.
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_rider RECORD;
  v_age INTEGER;
  v_squad_count INTEGER;
  v_deleted INTEGER;
BEGIN
  -- (0) Argument-kontrakt: kun en ungdomstrup med et loft og et aldersloft. Ingen
  -- fallback-tal: mangler et af dem, er det en kaldefejl, ikke en brugertilstand.
  IF p_squad IS NULL OR p_squad NOT IN ('junior', 'u23')
     OR p_squad_cap IS NULL OR p_squad_cap < 0
     OR p_squad_max_age IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_squad');
  END IF;

  -- Serialisér mod enhver anden akademi-mutation på holdet. SAMME nøgle som
  -- finalize_academy_acquisition, move_academy_rider_squad og
  -- increment_balance_with_audit. Frigives ved COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- (a) Lås rytter-rækken.
  SELECT id, team_id, is_academy, birthdate
    INTO v_rider
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

  IF v_rider.id IS NULL OR v_rider.team_id IS DISTINCT FROM p_team_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owned');
  END IF;

  IF v_rider.is_academy THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_academy');
  END IF;

  -- (b) Aldersgate mod MÅL-truppens loft (fra kalderen). Ukendt alder afvises.
  v_age := p_season_start_year - date_part('year', v_rider.birthdate)::INTEGER;
  IF v_age IS NULL OR v_age > p_squad_max_age THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE WHEN p_squad = 'u23' THEN 'not_u23' ELSE 'too_old_for_squad' END
    );
  END IF;

  -- (c) Ingen aktiv auktion.
  IF EXISTS (
    SELECT 1 FROM auctions
    WHERE rider_id = p_rider_id AND status IN ('active', 'extended')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_on_market');
  END IF;

  -- (d) Ingen åben transfer-listing.
  IF EXISTS (
    SELECT 1 FROM transfer_listings
    WHERE rider_id = p_rider_id AND status IN ('open', 'negotiating')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_listed');
  END IF;

  -- (e) Loft pr. MÅL-trup, inde i låsen.
  v_squad_count := count_team_squad_members(p_team_id, p_squad, p_rider_id);
  IF v_squad_count >= p_squad_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'academy_full');
  END IF;

  -- (f) Flyt rytteren NED: is_academy OG squad i ÉN række-skrivning, så de to
  -- kolonner aldrig kan være uenige (før skrev JS squad bagefter, uden for låsen).
  UPDATE riders
    SET is_academy = true,
        squad = p_squad,
        salary = p_new_salary,
        contract_length = p_contract_length,
        contract_end_season = p_contract_end
    WHERE id = p_rider_id
      AND is_academy = false;

  -- (g) Ryd fremtidige race_entries (planlagte løb der ikke er begyndt). Uændret.
  DELETE FROM race_entries re
    USING races r
    WHERE re.rider_id = p_rider_id
      AND re.race_id = r.id
      AND r.status = 'scheduled'
      AND r.stages_completed = 0;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'new_salary', p_new_salary,
    'rows_deleted', v_deleted,
    'squad', p_squad,
    'squad_count', v_squad_count + 1
  );
END;
$$;

-- ─── 3. finalize_academy_acquisition ─────────────────────────────────────────
-- Ungdomsauktionens akademi-placering (auctionFinalization.js) og intake-
-- signeringen (academyIntake.js). Uændret bortset fra (a) tællingen og (c)
-- squad-skrivningen. Returnerer JSONB:
--   { ok:false, code:'invalid_squad' | 'academy_full' | 'insufficient_balance'
--                     | 'rider_owned' | 'already_assigned' }
--   { ok:true, balance, squad, squad_count, deferred }
DROP FUNCTION IF EXISTS public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb);

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
BEGIN
  IF p_squad IS NULL OR p_squad NOT IN ('junior', 'u23')
     OR p_squad_cap IS NULL OR p_squad_cap < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_squad');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

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

  -- (c) Optag rytteren. is_academy OG squad skrives i SAMME række-skrivning. Er
  -- flippet udskudt, røres ingen af dem: rytteren kører videre som seniorrytter,
  -- og de to kolonner forbliver enige. Guard (#4213) uændret.
  UPDATE riders
    SET team_id = p_team_id,
        is_academy = CASE WHEN v_defer THEN is_academy ELSE true END,
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

  -- (e) Succes. squad_count = pladser i mål-truppen efter optagelsen (uændret hvis
  -- flippet er udskudt — så er han ikke reelt i truppen endnu).
  RETURN jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'squad', p_squad,
    'squad_count', v_squad_count + (CASE WHEN v_defer THEN 0 ELSE 1 END),
    'deferred', v_defer
  );
END;
$$;

-- ─── 4. move_academy_rider_squad (ny) ────────────────────────────────────────
-- Flyt en AKADEMIrytter mellem junior og U23. Op/ned til/fra senior går uændret
-- gennem promote()/demote() (kontrakt- og løn-reglerne bor dér). Aldersgaten for
-- en nedad-flytning ligger i JS (squads.fitsSquadAge): fødselsdatoen ændrer sig
-- aldrig, så der er intet at race om, og SQL skal ikke kende aldersformlen.
-- Returnerer JSONB:
--   { ok:false, code:'invalid_squad' | 'not_owned' | 'not_academy' | 'same_squad'
--                     | 'rider_on_market' | 'rider_in_stage_race' | 'squad_full' }
--   { ok:true, squad, squad_count }
CREATE OR REPLACE FUNCTION public.move_academy_rider_squad(
  p_team_id UUID,
  p_rider_id UUID,
  p_squad TEXT,
  p_squad_cap INTEGER
) RETURNS JSONB
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_rider RECORD;
  v_squad_count INTEGER;
BEGIN
  IF p_squad IS NULL OR p_squad NOT IN ('junior', 'u23')
     OR p_squad_cap IS NULL OR p_squad_cap < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_squad');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  SELECT id, team_id, is_academy, squad
    INTO v_rider
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

  IF v_rider.id IS NULL OR v_rider.team_id IS DISTINCT FROM p_team_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owned');
  END IF;

  IF NOT v_rider.is_academy THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_academy');
  END IF;

  IF v_rider.squad = p_squad THEN
    RETURN jsonb_build_object('ok', false, 'code', 'same_squad');
  END IF;

  IF EXISTS (
    SELECT 1 FROM auctions
    WHERE rider_id = p_rider_id AND status IN ('active', 'extended')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_on_market');
  END IF;

  -- Ikke midt i et etapeløb: SAMME afgrænsning som #4423-udskydelsen ovenfor og
  -- stageRaceTransferDefer.getRidersInActiveStageRace (#1995).
  IF EXISTS (
    SELECT 1
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.rider_id = p_rider_id
      AND r.race_type = 'stage_race'
      AND r.status != 'completed'
      AND r.stages_completed > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_in_stage_race');
  END IF;

  v_squad_count := count_team_squad_members(p_team_id, p_squad, p_rider_id);
  IF v_squad_count >= p_squad_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'squad_full');
  END IF;

  UPDATE riders
    SET squad = p_squad
    WHERE id = p_rider_id
      AND team_id = p_team_id
      AND is_academy = true;

  RETURN jsonb_build_object('ok', true, 'squad', p_squad, 'squad_count', v_squad_count + 1);
END;
$$;

-- ─── 5. ACL: service_role only ───────────────────────────────────────────────
-- Supabase' default privileges granter EXECUTE til anon/authenticated på enhver
-- NY funktion (#2858/#3765-klassen), og en DROP + CREATE er en ny funktion. REVOKE
-- fra PUBLIC OG de navngivne roller (.claude/learnings/2026-07-12-revoke-from-
-- public-not-just-named-roles.md). Backend kalder med service_role.
REVOKE ALL     ON FUNCTION public.count_team_squad_members(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_team_squad_members(uuid, text, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.count_team_squad_members(uuid, text, uuid) TO service_role;

REVOKE ALL     ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) TO service_role;

REVOKE ALL     ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_academy_acquisition(uuid, uuid, bigint, bigint, integer, integer, timestamptz, jsonb, text, integer) TO service_role;

REVOKE ALL     ON FUNCTION public.move_academy_rider_squad(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_academy_rider_squad(uuid, uuid, text, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.move_academy_rider_squad(uuid, uuid, text, integer) TO service_role;

COMMIT;

-- PostgREST cacher funktions-signaturerne; uden genindlæsning svarer den
-- "function not found" på de nye argumenter indtil næste cache-refresh.
NOTIFY pgrst, 'reload schema';
