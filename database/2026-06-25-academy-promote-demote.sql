-- #932 (S7 race-hub) · Akademi op/ned: manuel promote (på AcademyPage) + demote
-- (på holdsiden, kun U23-seniorer). Spec: docs/superpowers/specs/2026-06-25-race-hub-program-design.md §5 S7 + D5.
--
-- Denne migration leverer:
--   1. demote_rider_to_academy(...) — PL/pgSQL der under advisory-lås atomisk
--      flytter en U23-senior-rytter NED i akademiet (D5-berettigelse), gen-beregner
--      løn til ungdomsrate, sætter akademi-kontrakt, og rydder fremtidige race_entries.
--   2. notifications_type_check udvidet med 'academy_promoted' + 'academy_demoted'
--      (promote-stien noterer via notifyTeamOwner; demote ligeledes).
--
-- Promote selv (akademi → senior) håndteres rent i backend (academyTransfer.js)
-- via getTeamMarketState-cap-guard + en simpel UPDATE riders — ingen RPC nødvendig,
-- da promote ikke rører race_entries og kun udvider rækkevidde (cap-tjekket sker
-- mod future_count). Demote KRÆVER RPC fordi den (a) skal serialisere mod akademi-
-- 8-cap'en (samme advisory-lås-nøgle som finalize_academy_acquisition) og (b) skal
-- slette fremtidige race_entries atomisk så et delvist resultat ikke efterlader en
-- akademi-rytter i et planlagt løb-felt.
--
-- ⚠️ Migration auto-applies i prod ved merge — EJEREN merger PR'en (database/*.sql).
--    Verificér FØRST mod en disposabel Supabase-branch.
--
-- IDEMPOTENT (#401 forward-guard):
--   • CREATE OR REPLACE FUNCTION  (re-run = no-op)
--   • DROP CONSTRAINT IF EXISTS før ADD CONSTRAINT på notifications_type_check
--
-- Rollback:
--   DROP FUNCTION IF EXISTS demote_rider_to_academy(UUID, UUID, BIGINT, INTEGER, INTEGER, INTEGER);
--   -- og gen-deklarér notifications_type_check uden academy_promoted/academy_demoted.

BEGIN;

-- ─── 1. demote_rider_to_academy ────────────────────────────────────────────────
-- Returnerer JSONB:
--   { ok:false, code:'not_owned' }          — rytteren ejes ikke af holdet
--   { ok:false, code:'already_academy' }    — rytteren er allerede akademi-rytter
--   { ok:false, code:'not_u23' }            — alder > 22 i den aktive sæson (D5)
--   { ok:false, code:'rider_on_market' }    — aktiv auktion (active/extended)
--   { ok:false, code:'rider_listed' }       — åben transfer-listing (open/negotiating)
--   { ok:false, code:'academy_full' }       — akademi-8-cap nået
--   { ok:true,  new_salary:<int>, rows_deleted:<int> }
--
-- p_season_start_year = kalenderåret for den aktive sæson (kalderen sender
-- 2026 + (seasonNumber - 1), så aldersberegningen spejler ageForSeason i
-- riderProgressionEngine: age = år − fødselsår). D5 berettigelse: age <= 22.
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

  -- (b) D5 alders-gate: kun U23 (age <= 22 i den aktive sæson). Spejler
  -- ageForSeason(birthdate, seasonNumber) = p_season_start_year − fødselsår.
  v_age := p_season_start_year - date_part('year', v_rider.birthdate)::INTEGER;
  IF v_age IS NULL OR v_age > 22 THEN
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

-- PostgREST-kald: authenticated (manageren selv via /api/academy/demote) + service_role.
GRANT EXECUTE ON FUNCTION demote_rider_to_academy(
  UUID, UUID, BIGINT, INTEGER, INTEGER, INTEGER
) TO authenticated;
GRANT EXECUTE ON FUNCTION demote_rider_to_academy(
  UUID, UUID, BIGINT, INTEGER, INTEGER, INTEGER
) TO service_role;

-- ─── 2. Notification-typer ──────────────────────────────────────────────────────
-- Tilføj 'academy_promoted' + 'academy_demoted'. Listen herunder = den NUVÆRENDE
-- prod-constraint (hentet 2026-06-25 via pg_get_constraintdef) + de 2 nye, så ingen
-- eksisterende type-værdi tabes. Constraint ALTER'es flere gange historisk — seneste
-- vinder, derfor er hele listen gengivet her.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'bid_received','bid_placed','auction_won','auction_lost','auction_outbid','auction_proxy_outbid',
  'transfer_offer_received','transfer_offer_accepted','transfer_offer_rejected','transfer_counter',
  'transfer_offer_withdrawn','transfer_interest',
  'new_race','race_results_imported','season_started','season_ended',
  'board_update','board_critical','salary_paid','sponsor_paid',
  'watchlist_rider_listed','watchlist_rider_auction','loan_created','emergency_loan','loan_paid_off',
  'deadline_day_warning','auction_cancelled','squad_enforced','rider_retired',
  'academy_intake_ready','academy_signed','academy_rejected',
  'academy_graduation_ready','academy_graduated','contract_expiring',
  'academy_promoted','academy_demoted'
));

COMMIT;
