-- #5145 · Akademi-nedrykning: alders-gaten i demote_rider_to_academy strammes
-- fra `<= 22` til `<= 21` (ACADEMY.MAX_AGE, backend/lib/academyFlag.js:13).
--
-- HVORFOR
--   D5-gaten fra 2026-06-25 (database/2026-06-25-academy-promote-demote.sql:89-92)
--   brugte U23-grænsen (sæson-alder <= 22). Men akademi-opholdet SLUTTER ved 22:
--   GRADUATION.GRADUATE_AGE = 22 (backend/lib/academyGraduation.js:25, "MAX_AGE 21 + 1")
--   og ACADEMY.MAX_AGE = 21 (backend/lib/academyFlag.js:13). En manager kunne derfor
--   midt i sæsonen flytte en 22-årig NED i akademiet: rytteren stod bagefter
--   is_academy = true, OVER gradueringsalderen og uden academy_graduation-række —
--   præcis den tilstand #5133 fandt i prod (Tijl Van Hecke, født 2006, sæson-alder 22).
--   Efter det løbende graduerings-sweep (#5135) får sådan en rytter en "aged out"-
--   notifikation og et 7-dages valg samme nat. Logisk korrekt, men det læses som en
--   fejl af manageren — og hele turen ned var meningsløs.
--
--   Efter denne migration er 21 den sidste sæson-alder hvor en senior kan rykke ned,
--   så ingen ANKOMMER til akademiet i gradueringsalderen. NB: gaten lover ikke en hel
--   akademi-sæson — en 21-årig der rykkes ned midt i sæsonen gradueres stadig ved
--   næste sæson-skift. Den lukker kun hullet hvor turen ned var meningsløs fra start.
--
-- FEJLKODEN
--   `not_u23` BEHOLDES uændret. Den er et internt kontrakt-navn der læses tre steder
--   (backend/lib/academyTransfer.js's DEMOTE_ERROR_CODES, backend/routes/api.js:17519,
--   frontend/public/locales/{en,da}/errors.json's api.not_u23). Et omdøb ville røre
--   fire filer uden at ændre adfærd; navnet er nu historisk (grænsen er 21, ikke U23),
--   og det står dokumenteret her + i den player-facing tekst, som ER opdateret til
--   den rigtige grænse i denne PR.
--
-- HVAD DER ER ÆNDRET IFT. 2026-06-25-versionen
--   Kun ÉN linje i funktionskroppen: `IF v_age IS NULL OR v_age > 22` → `> 21`
--   (plus kommentarer). Alt andet — advisory-lås, ejer-tjek, allerede-akademi-tjek,
--   auktions-/listings-tjek, akademi-8-cap, UPDATE riders, race_entries-oprydningen
--   og retur-formen — er ordret den samme krop. Ingen senere migration havde
--   erstattet funktionen (grep demote_rider_to_academy i database/ 13/9: kun
--   GRANT/REVOKE i 2026-07-11-revoke-rpc-grants-2327.sql og
--   2026-07-12-security-advisor-hardening.sql).
--
-- IDEMPOTENT (#401 forward-guard):
--   • CREATE OR REPLACE FUNCTION (re-run = no-op). Signaturen er UÆNDRET, så
--     eksisterende privilegier bevares af Postgres ved replace.
--   • REVOKE/GRANT gentages eksplicit nedenfor, så hærdningen fra #2327/#2894 ikke
--     kan gå tabt hvis migrationen køres på en base uden dem.
--
-- Rollback: kør database/2026-06-25-academy-promote-demote.sql's funktions-blok igen
-- (den har `> 22`), efterfulgt af REVOKE/GRANT-blokken nederst her.

BEGIN;

CREATE OR REPLACE FUNCTION demote_rider_to_academy(
  p_team_id UUID,
  p_rider_id UUID,
  p_new_salary BIGINT,
  p_contract_length INTEGER,
  p_contract_end INTEGER,
  p_season_start_year INTEGER
) RETURNS JSONB
  -- Forward-guard (#927, advisor 0011): hold search_path sat så et re-run af
  -- migrationen ikke nulstiller hærdningen.
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_rider RECORD;
  v_age INTEGER;
  v_academy_count INTEGER;
  v_deleted INTEGER;
BEGIN
  -- Serialize concurrent calls for the same team. SAMME lock-nøgle som
  -- finalize_academy_acquisition + increment_balance_with_audit, så akademi-cap-
  -- mutationer på holdet aldrig kører samtidig. Frigives ved COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));

  -- (a) Lås rytter-rækken og hent de felter D5 afhænger af.
  SELECT id, team_id, is_academy, birthdate
    INTO v_rider
    FROM riders
    WHERE id = p_rider_id
    FOR UPDATE;

  IF v_rider.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owned');
  END IF;

  -- Owner-check.
  IF v_rider.team_id IS DISTINCT FROM p_team_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_owned');
  END IF;

  -- Allerede akademi-rytter → ingen op-ned at lave.
  IF v_rider.is_academy THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_academy');
  END IF;

  -- (b) #5145 alders-gate: sæson-alder <= 21 (ACADEMY.MAX_AGE). Var <= 22 (U23)
  -- indtil 13/9 — det tillod nedrykning DIREKTE ind i gradueringsalderen
  -- (GRADUATION.GRADUATE_AGE = 22), så rytteren stod som akademi-rytter over
  -- grænsen uden graduerings-vindue (#5133). Spejler stadig
  -- ageForSeason(birthdate, seasonNumber) = p_season_start_year − fødselsår.
  -- Koden hedder fortsat 'not_u23' af bagud-kompatible årsager (se headeren).
  v_age := p_season_start_year - date_part('year', v_rider.birthdate)::INTEGER;
  IF v_age IS NULL OR v_age > 21 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_u23');
  END IF;

  -- (c) Ingen aktiv auktion (rytteren må ikke samtidig være til salg på auktion).
  IF EXISTS (
    SELECT 1 FROM auctions
    WHERE rider_id = p_rider_id AND status IN ('active', 'extended')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_on_market');
  END IF;

  -- (d) Ingen åben transfer-listing (rytteren må ikke samtidig være listet til salg).
  -- NB: schemaet har ingen 'transfers'-tabel; pending-salg = en transfer_listings-
  -- række i status open/negotiating (CHECK: open/negotiating/sold/withdrawn).
  IF EXISTS (
    SELECT 1 FROM transfer_listings
    WHERE rider_id = p_rider_id AND status IN ('open', 'negotiating')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rider_listed');
  END IF;

  -- (e) Akademi-8-cap (hård, GAME_INVARIANTS.md) — NU inde i låsen.
  SELECT count(*) INTO v_academy_count
    FROM riders
    WHERE team_id = p_team_id AND is_academy = true;

  IF v_academy_count >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'academy_full');
  END IF;

  -- (f) Flyt rytteren NED i akademiet: is_academy=true, ny ungdomsløn + akademi-
  -- kontrakt. Guard på (is_academy=false) så en samtidig demote ikke dobbelt-kører.
  UPDATE riders
    SET is_academy = true,
        salary = p_new_salary,
        contract_length = p_contract_length,
        contract_end_season = p_contract_end
    WHERE id = p_rider_id
      AND is_academy = false;

  -- (g) Ryd fremtidige race_entries: planlagte løb der ikke er begyndt
  -- (status='scheduled' AND stages_completed=0). En akademi-rytter er ikke
  -- løbsberettiget, så stale entries i et endnu-ikke-afviklet felt skal væk.
  -- Igangværende/afsluttede løb røres ALDRIG (resultat-/snapshot-invarians).
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
    'rows_deleted', v_deleted
  );
END;
$$ LANGUAGE plpgsql;

-- Privilegier: RPC'en kaldes KUN server-side (backend/lib/academyTransfer.js via
-- service_role). #2327 (2026-07-11) fjernede authenticated/anon, #2894 (2026-07-12)
-- fjernede PUBLIC. CREATE OR REPLACE bevarer eksisterende ACL, men vi gentager
-- hærdningen her så migrationen også er korrekt på en base uden de to tidligere.
REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer) TO service_role;

COMMIT;
