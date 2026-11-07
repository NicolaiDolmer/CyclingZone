-- #7832 (ejer 7/11): et hold maa ALDRIG miste en traeningsdato, heller ikke et helt nyt
-- hold paa sin foerste dag. "Start paa naeste dato" er afvist.
--
-- PROBLEMET. register_training_date_work gemmer kun rytternes starttilstand
-- (opening_conditions) naar registreringen sker foer datoens frist (naeste dag kl. 02).
-- Et hold der oprettes efter aftenkoerslen, og som sweepen foerst naar efter fristen,
-- faar derfor et tomt snapshot. Sweepen saetter alle rytterne i karantaene, datoen er
-- frosset uden traening, og alarmen gaar.
--
-- LOESNINGEN. Samme princip som broen mellem saesoner (#7282,
-- register_training_bridge_date_work), nu for almindelige datoer: en SEPARAT funktion,
-- kun kaldt af sweepen naar den registrerer en dato efter fristen. Den registrerer som
-- hidtil og udfylder bagefter det tomme snapshot i SAMME transaktion, men kun naar det
-- kan bevises at rytternes tilstand stadig er datoens starttilstand:
--   · registreringen sker efter fristen (en rettidig registrering er uaendret),
--   · raekken blev oprettet af netop dette kald (created_at = p_registered_at) og er
--     'pending' med tomt snapshot (en eksisterende dato er frosset og roeres aldrig),
--   · holdet har intet arbejde paa en senere dato, og ingen af rytterne har et tick
--     eller en tilstands-afregning paa en senere dato (intet har flyttet tilstanden
--     siden datoen).
-- Ellers er resultatet praecis register_training_date_work's (tomt snapshot,
-- karantaene og alarm som i dag). register_training_date_work,
-- register_training_bridge_date_work og commit_training_date_tick er uaendrede; commit
-- kraever stadig at den aktuelle tilstand er lig snapshottet.
--
-- Mangler funktionen (deploy-vinduet foer auto-migrate), registrerer backend IKKE en
-- almindelig dato efter fristen (backend/lib/trainingDateClose.js), saa ingen dato
-- fryses tom; den proeves igen naeste tick.
-- Additiv og idempotent: CREATE OR REPLACE. Funktion og rettigheder i een transaktion
-- (#6342). Ingen data aendres af selve migrationen.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_late_training_date_work(p_team_id uuid, p_season_id uuid, p_tick_date date, p_game_days integer[], p_expected_rider_ids uuid[], p_deadline_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_registered_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_work public.training_date_work%ROWTYPE;v_openings jsonb;
BEGIN
  -- Takes the cutover and team locks and validates the date contract; the locks are
  -- held until this transaction ends.
  PERFORM public.register_training_date_work(p_team_id,p_season_id,p_tick_date,p_game_days,p_expected_rider_ids,p_deadline_at,p_registered_at);
  SELECT * INTO STRICT v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF v_work.status='pending' AND v_work.opening_conditions='{}'::jsonb AND v_work.created_at=p_registered_at
    AND p_registered_at>v_work.deadline_at
    AND cardinality(v_work.expected_rider_ids)>0
    AND NOT EXISTS(SELECT 1 FROM public.training_date_work w WHERE w.team_id=p_team_id AND w.tick_date>p_tick_date)
    AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=ANY(v_work.expected_rider_ids) AND t.tick_date>p_tick_date)
    AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=ANY(v_work.expected_rider_ids) AND s.tick_date>p_tick_date)
  THEN
    SELECT COALESCE(jsonb_object_agg(rider_id::text,to_jsonb(c)),'{}') INTO v_openings
      FROM public.rider_condition c WHERE rider_id=ANY(v_work.expected_rider_ids);
    UPDATE public.training_date_work SET opening_conditions=v_openings
      WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date
      RETURNING * INTO STRICT v_work;
  END IF;
  RETURN to_jsonb(v_work);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_late_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_late_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) TO service_role;

COMMIT;
