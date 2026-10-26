-- #7282 (ejer 26/10): ingen saesonpause. Datoerne mellem forrige saesons sidste dato og
-- den nye saesons foerste loebsdato er rene traeningsdatoer med negative loebsdage
-- (backend/lib/trainingDateReadiness.js, bridgeGameDays).
--
-- PROBLEMET. register_training_date_work gemmer kun rytternes starttilstand
-- (opening_conditions) naar registreringen sker foer datoens frist (naeste dag kl. 02).
-- En brodato der INDHENTES efter fristen (26/10 opdaget efter deploy) faar derfor et
-- tomt snapshot, sweepen saetter alle ryttere i karantaene, og datoen er frosset uden
-- traening.
--
-- LOESNINGEN. En SEPARAT funktion, kun for brodatoer, kaldt af sweepen. Den registrerer
-- som hidtil og udfylder bagefter det tomme snapshot i SAMME transaktion, men kun naar
-- det kan bevises at rytterens tilstand stadig er datoens starttilstand:
--   · alle datoens loebsdage er negative (en brodato, aldrig en loebsdag),
--   · raekken blev oprettet af netop dette kald (created_at = p_registered_at) og er
--     'pending' med tomt snapshot (en eksisterende dato er frosset og roeres aldrig),
--   · holdet har intet arbejde paa en senere dato, og ingen af rytterne har et tick
--     eller en tilstands-afregning paa en senere dato (intet har flyttet tilstanden
--     siden datoen).
-- Ellers er resultatet praecis register_training_date_work's. register_training_date_work
-- og commit_training_date_tick er uaendrede; commit kraever stadig at den aktuelle
-- tilstand er lig snapshottet.
--
-- Mangler funktionen (deploy-vinduet foer auto-migrate), registrerer backend IKKE en
-- brodato efter fristen (backend/lib/trainingDateClose.js), saa ingen dato fryses tom.
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.register_training_bridge_date_work(p_team_id uuid, p_season_id uuid, p_tick_date date, p_game_days integer[], p_expected_rider_ids uuid[], p_deadline_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_registered_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_work public.training_date_work%ROWTYPE;v_openings jsonb;
BEGIN
  IF p_game_days IS NULL OR EXISTS(SELECT 1 FROM unnest(p_game_days) day WHERE day IS NULL OR day>=0) THEN
    RAISE EXCEPTION 'Bridge date requires negative game days';
  END IF;
  -- Takes the cutover and team locks; they are held until this transaction ends.
  PERFORM public.register_training_date_work(p_team_id,p_season_id,p_tick_date,p_game_days,p_expected_rider_ids,p_deadline_at,p_registered_at);
  SELECT * INTO STRICT v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF v_work.status='pending' AND v_work.opening_conditions='{}'::jsonb AND v_work.created_at=p_registered_at
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

REVOKE ALL ON FUNCTION public.register_training_bridge_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_training_bridge_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) TO service_role;
