-- #5917 · En rytter på transferlisten må rykkes ned i U23/junior uden at miste listingen
--
-- Ejer 4/10: en rytter der er til salg skal kunne flyttes mellem senior, U23 og
-- junior uden at miste sin plads på transferlisten. Af de tre flytte-stier
-- (backend/lib/academyTransfer.js moveRider) var det KUN nedrykningen senior →
-- ungdom, der afviste en åben listing: demote_rider_to_academy trin (d) i
-- database/2026-09-24-5432-squad-caps-rpc.sql. Op til senior (promote) og junior ↔
-- U23 (move_academy_rider_squad) kigger ikke på transfer_listings.
--
-- HVAD DEN GØR
--   CREATE OR REPLACE af demote_rider_to_academy ORDRET fra #5432-versionen, uden
--   trin (d). Signatur, advisory-lås, argument-kontrakt, aldersgate, auktions-gate
--   (c), loft pr. mål-trup og skrivningen er uændrede. Listingen røres ikke: den
--   peger på rytteren (rider_id), ikke på truppen, så den står ved efter flytningen.
--
-- HVAD DEN IKKE GØR
--   Auktionslåsen (c) 'rider_on_market' er en særskilt ejerbeslutning og bliver.
--   Fejlkoden 'rider_listed' bliver i backend og oversættelser: backend deployer før
--   auto-migrate.yml applier (docs/AUTO_MIGRATION_SETUP.md), så den gamle krop kan
--   stadig svare med den i det vindue.
--
-- IDEMPOTENT: CREATE OR REPLACE på samme signatur + gen-assertér ACL. Anden kørsel
-- = no-op. Ingen data muteres.
--
-- ⚠️ Applies af auto-migrate.yml ved merge (#2642). Ikke destruktiv for data.
--
-- Rollback: gen-kør §2 (demote_rider_to_academy) og §6's tre demote-linjer i
-- database/2026-09-24-5432-squad-caps-rpc.sql. Samme signatur, så intet skal droppes.

BEGIN;

-- Returnerer JSONB:
--   { ok:false, code:'invalid_squad' }      — p_squad er ikke en ungdomstrup / loft mangler
--   { ok:false, code:'not_owned' }          — rytteren ejes ikke af holdet
--   { ok:false, code:'already_academy' }    — rytteren er allerede akademirytter
--   { ok:false, code:'not_u23' }            — for gammel til U23 (mål-trup u23)
--   { ok:false, code:'too_old_for_squad' }  — for gammel til mål-truppen (junior)
--   { ok:false, code:'rider_on_market' }    — aktiv auktion (active/extended)
--   { ok:false, code:'academy_full' }       — mål-truppen er fuld (koden er uændret:
--                                             frontend læser netop den streng)
--   { ok:true, new_salary, rows_deleted, squad, squad_count }
--
-- p_season_start_year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) fra kalderen, så
-- alderen spejler ageForSeason (backend/lib/riderSeasonAge.js). Aldersloftet selv
-- (p_squad_max_age) kommer fra squads.js SQUAD_MAX_AGE.
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

  -- (d) Fjernet i #5917: en åben transfer-listing blokerer ikke længere. Listingen
  -- følger rytteren (rider_id) og står uændret efter flytningen.

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

-- ACL: service_role only (uændret fra #5432 §6). CREATE OR REPLACE på samme
-- signatur bevarer ACL'en, men den gen-assertéres, så et re-run eller en
-- recovery-replay aldrig efterlader funktionen åben for anon/authenticated.
REVOKE ALL     ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.demote_rider_to_academy(uuid, uuid, bigint, integer, integer, integer, text, integer, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
