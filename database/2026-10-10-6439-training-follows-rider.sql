-- #6439 (owner 10/10): training follows the rider.
-- A rider who changes team while his date is open (Train now in the morning, or the
-- 20:00 settlement itself) used to be quarantined after 4 of 5 race days. He now keeps
-- his slot in the frozen date roster of the team that opened the date and settles the
-- remaining race days there, from the date opening condition.
--  1) register_training_date_work: a rider already claimed by another team's open date
--     row (same season and date, not quarantined there) is not registered again, so
--     only one team ever settles his date.
--  2) commit_training_date_tick: the frozen roster decides, not the current team.
--     A released (team-less), retired or deleted rider is still unsafe. One date per
--     rider per team stays enforced by the other-team receipt check below and the
--     (rider_id, season_id, game_day) receipt key.
-- Idempotent: CREATE OR REPLACE with unchanged signatures. Applied post-merge by
-- auto-migrate.yml. Bodies are the live definitions (verified by md5 against prod
-- 10/10) with only the marked #6439 lines changed.

CREATE OR REPLACE FUNCTION public.register_training_date_work(
  p_team_id uuid,p_season_id uuid,p_tick_date date,p_game_days integer[],p_expected_rider_ids uuid[],p_deadline_at timestamptz DEFAULT NULL,p_registered_at timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_days integer[];v_riders uuid[];v_deadline timestamptz;v_work public.training_date_work%ROWTYPE;v_openings jsonb:='{}';
BEGIN
  IF p_expected_rider_ids IS NULL OR array_position(p_expected_rider_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Verified expected rider roster required'; END IF;
  SELECT array_agg(DISTINCT day ORDER BY day) INTO v_days FROM unnest(p_game_days) day;
  SELECT COALESCE(array_agg(DISTINCT rider ORDER BY rider),'{}'::uuid[]) INTO v_riders FROM unnest(p_expected_rider_ids) rider;
  IF cardinality(v_days) IS DISTINCT FROM 5 OR array_position(v_days,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Complete date game days required'; END IF;
  v_deadline:=(p_tick_date+1+time '02:00') AT TIME ZONE 'Europe/Copenhagen';
  IF ((v_deadline-interval '1 hour') AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date+1
    AND extract(hour FROM (v_deadline-interval '1 hour') AT TIME ZONE 'Europe/Copenhagen')>=2 THEN
    v_deadline:=v_deadline-interval '1 hour';
  END IF;
  IF p_deadline_at IS NOT NULL AND p_deadline_at<>v_deadline THEN RAISE EXCEPTION 'Deadline must be first valid Copenhagen 02:00'; END IF;
  -- Same lock order as commit/quarantine, including the cutover exclusion.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  -- An existing date is frozen. Do not repair or initialize it as a side effect
  -- of a retry; quarantined/historical riders require explicit reconciliation.
  SELECT * INTO v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF FOUND THEN
    IF v_work.game_days<>v_days OR v_work.deadline_at<>v_deadline THEN RAISE EXCEPTION 'Registered date contract changed'; END IF;
    RETURN to_jsonb(v_work);
  END IF;
  -- #6439: the team that opened the date keeps a rider who moves mid-date. Do not
  -- register him a second time for the same date on his new team.
  SELECT COALESCE(array_agg(rider ORDER BY rider),'{}'::uuid[]) INTO v_riders FROM unnest(v_riders) rider
    WHERE NOT EXISTS(SELECT 1 FROM public.training_date_work o WHERE o.season_id=p_season_id AND o.tick_date=p_tick_date
      AND o.team_id<>p_team_id AND rider=ANY(o.expected_rider_ids) AND NOT rider=ANY(o.quarantined_rider_ids));
  -- Preserve the legacy engine's neutral missing-row fallback on first use.
  -- Historical state or any prior condition effects are never reconstructed.
  IF (p_registered_at AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date THEN
    PERFORM id FROM public.riders WHERE id=ANY(v_riders) ORDER BY id FOR UPDATE;
    INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
      SELECT r.id,50,0,p_registered_at FROM public.riders r
      WHERE r.id=ANY(v_riders) AND r.team_id=p_team_id AND r.is_retired IS NOT TRUE
        AND NOT EXISTS(SELECT 1 FROM public.rider_condition c WHERE c.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_day_runs t
          WHERE t.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',r.id)))
      ON CONFLICT(rider_id) DO NOTHING;
  END IF;
  IF p_registered_at<=v_deadline THEN SELECT COALESCE(jsonb_object_agg(rider_id::text,to_jsonb(c)),'{}') INTO v_openings FROM public.rider_condition c WHERE rider_id=ANY(v_riders); END IF;
  INSERT INTO public.training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,deadline_at,status,opening_conditions,created_at,updated_at)
  VALUES(p_team_id,p_season_id,p_tick_date,v_days,v_riders,v_deadline,CASE WHEN cardinality(v_riders)=0 THEN 'complete' ELSE 'pending' END,v_openings,p_registered_at,p_registered_at)
  ON CONFLICT(team_id,season_id,tick_date) DO NOTHING;
  SELECT * INTO STRICT v_work FROM public.training_date_work WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF v_work.game_days<>v_days OR v_work.deadline_at<>v_deadline THEN RAISE EXCEPTION 'Registered date contract changed'; END IF;
  RETURN to_jsonb(v_work);
END;
$$;
REVOKE ALL ON FUNCTION public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.commit_training_date_tick(
  p_team_id uuid,p_season_id uuid,p_squad text,p_game_day integer,p_tick_date date,p_date_game_days integer[],p_executed_by text,
  p_report jsonb,p_abilities jsonb,p_conditions jsonb,p_history jsonb,p_race_history jsonb,p_scores jsonb,
  p_race_loads jsonb DEFAULT '[]',p_deadline_reached boolean DEFAULT false,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  v_work public.training_date_work%ROWTYPE;v_new uuid[];v_rider uuid;v_day integer;v_item jsonb;
  v_assignments text;v_affected integer;v_old_report jsonb;v_report jsonb;v_all boolean;v_final boolean;
  v_missing jsonb;v_payload jsonb;v_status text;v_count integer;v_unsafe uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  SELECT * INTO STRICT v_work FROM public.training_date_work WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date FOR UPDATE;
  IF p_date_game_days<>v_work.game_days OR NOT p_game_day=ANY(v_work.game_days) THEN RAISE EXCEPTION 'Registered complete date required'; END IF;
  IF p_deadline_reached AND p_now<v_work.deadline_at THEN RAISE EXCEPTION 'Date deadline not reached'; END IF;
  v_final:=p_game_day=(SELECT max(day) FROM unnest(v_work.game_days) day);
  SELECT report INTO v_old_report FROM public.training_day_runs
    WHERE team_id=p_team_id AND season_id=p_season_id AND COALESCE(squad,'senior')=p_squad AND game_day=p_game_day FOR UPDATE;
  IF FOUND AND v_old_report->>'condition_per_date' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Mixed condition cadence for date'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'riders') r WHERE NOT (r->>'rider_id')::uuid=ANY(v_work.expected_rider_ids)) THEN
    RAISE EXCEPTION 'Rider outside frozen date roster';
  END IF;
  IF (SELECT count(DISTINCT r->>'rider_id') FROM jsonb_array_elements(p_report->'riders') r)<>jsonb_array_length(p_report->'riders') THEN RAISE EXCEPTION 'Duplicate rider report'; END IF;
  FOR v_rider IN SELECT (r->>'rider_id')::uuid FROM jsonb_array_elements(p_report->'riders') r ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('training-condition:'||v_rider::text||':'||p_tick_date::text,0));
  END LOOP;
  SELECT COALESCE(array_agg((r->>'rider_id')::uuid),'{}'::uuid[]) INTO v_new FROM jsonb_array_elements(p_report->'riders') r
    WHERE NOT (r->>'rider_id')::uuid=ANY(v_work.quarantined_rider_ids)
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=(r->>'rider_id')::uuid AND t.season_id=p_season_id AND t.game_day=p_game_day);
  IF cardinality(v_new)=0 THEN RETURN jsonb_build_object('already_ran',true,'report',v_old_report,'work_status',v_work.status); END IF;
  PERFORM id FROM public.riders WHERE id=ANY(v_new) ORDER BY id FOR UPDATE;
  PERFORM rider_id FROM public.rider_condition WHERE rider_id=ANY(v_new) ORDER BY rider_id FOR UPDATE;
  SELECT COALESCE(array_agg(candidate.rider_key),'{}') INTO v_unsafe FROM unnest(v_new) candidate(rider_key)
  LEFT JOIN public.riders r ON r.id=candidate.rider_key LEFT JOIN public.rider_condition c ON c.rider_id=candidate.rider_key
  LEFT JOIN LATERAL(
    SELECT max((s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date) AS injury_date
    FROM public.race_incidents i JOIN public.race_stage_schedule s ON s.race_id=i.race_id AND s.stage_number=i.stage_number
    WHERE i.rider_id=candidate.rider_key AND i.kind='crash' AND (i.outcome='abandon' OR i.injury_days>0)
  ) injury ON true
  -- #6439: the frozen roster decides; a rider who moved mid-date still settles here.
  WHERE r.id IS NULL OR r.team_id IS NULL OR r.is_retired IS TRUE
    OR NOT(v_work.opening_conditions?candidate.rider_key::text)
    OR c.form IS DISTINCT FROM (v_work.opening_conditions->candidate.rider_key::text->>'form')::integer
    OR c.fatigue IS DISTINCT FROM (v_work.opening_conditions->candidate.rider_key::text->>'fatigue')::integer
    OR injury.injury_date>p_tick_date
    OR EXISTS(SELECT 1 FROM public.training_condition_settlements newer WHERE newer.rider_id=candidate.rider_key AND (newer.tick_date>p_tick_date OR(newer.tick_date=p_tick_date AND newer.season_id<>p_season_id)))
    OR EXISTS(SELECT 1 FROM public.training_rider_ticks other WHERE other.rider_id=candidate.rider_key AND other.season_id=p_season_id AND other.tick_date=p_tick_date AND other.team_id<>p_team_id)
    OR (public.training_condition_injury_state(to_jsonb(c)) IS DISTINCT FROM public.training_condition_injury_state(v_work.opening_conditions->candidate.rider_key::text)
      AND NOT(COALESCE((c.updated_at AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date,false)
        OR(c.injury_cause='race_crash' AND COALESCE(injury.injury_date=p_tick_date,false))));
  IF cardinality(v_unsafe)>0 THEN
    PERFORM public.quarantine_training_date_riders(p_team_id,p_season_id,p_tick_date,v_unsafe,'unsafe_current_state',p_now);
    SELECT * INTO STRICT v_work FROM public.training_date_work WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
    SELECT COALESCE(array_agg(id),'{}') INTO v_new FROM unnest(v_new) id WHERE NOT id=ANY(v_unsafe);
  END IF;
  IF cardinality(v_new)=0 THEN RETURN jsonb_build_object('already_ran',true,'report',COALESCE(v_old_report,jsonb_build_object('riders','[]'::jsonb,'condition_per_date',true)),'work_status',v_work.status,'quarantined_rider_ids',to_jsonb(v_unsafe)); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'riders') r JOIN public.rider_condition c ON c.rider_id=(r->>'rider_id')::uuid
    WHERE c.rider_id=ANY(v_new) AND (jsonb_typeof(r->'condition_observed') IS DISTINCT FROM 'object'
      OR public.training_condition_injury_state(to_jsonb(c)) IS DISTINCT FROM public.training_condition_injury_state(r->'condition_observed')
      OR c.updated_at>p_now)) THEN RAISE EXCEPTION 'Condition injury source changed; retry with current injury and frozen date factors'; END IF;
  FOREACH v_rider IN ARRAY v_new LOOP
    IF EXISTS(SELECT 1 FROM public.training_date_work older WHERE older.season_id=p_season_id AND older.tick_date<p_tick_date
      AND v_rider=ANY(older.expected_rider_ids) AND NOT v_rider=ANY(older.quarantined_rider_ids) AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s
        WHERE s.rider_id=v_rider AND s.season_id=p_season_id AND s.tick_date=older.tick_date)) THEN
      RAISE EXCEPTION 'Earlier rider date condition settlement is incomplete';
    END IF;
    FOREACH v_day IN ARRAY v_work.game_days LOOP
      IF v_day<p_game_day AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=v_rider AND t.season_id=p_season_id AND t.game_day=v_day AND t.tick_date=p_tick_date) THEN
        RAISE EXCEPTION 'Earlier rider date ticks must commit first';
      END IF;
    END LOOP;
  END LOOP;
  -- Mixed retry batches retain only riders whose atomic receipt is absent.
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_abilities FROM jsonb_array_elements(p_abilities) x WHERE (x->>'riderId')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_conditions FROM jsonb_array_elements(p_conditions) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_history FROM jsonb_array_elements(p_history) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_race_history FROM jsonb_array_elements(p_race_history) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_scores FROM jsonb_array_elements(p_scores) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_race_loads FROM jsonb_array_elements(p_race_loads) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  IF NOT v_final AND jsonb_array_length(p_conditions)>0 THEN RAISE EXCEPTION 'Condition writes only at date settlement'; END IF;
  IF v_final THEN
    IF (SELECT count(DISTINCT x->>'rider_id') FROM jsonb_array_elements(p_conditions) x)<>cardinality(v_new) THEN RAISE EXCEPTION 'Every final rider receipt needs condition settlement'; END IF;
    IF EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=ANY(v_new) AND season_id=p_season_id AND tick_date=p_tick_date) THEN RAISE EXCEPTION 'Rider condition already settled on this date'; END IF;
    IF EXISTS(
      WITH actual AS(SELECT rider_id,race_id,stage_number,game_day,load FROM public.training_race_loads WHERE season_id=p_season_id AND tick_date=p_tick_date AND rider_id=ANY(v_new)),
      expected AS(SELECT rider_id,race_id,stage_number,game_day,load FROM jsonb_to_recordset(p_race_loads) AS x(rider_id uuid,race_id uuid,stage_number integer,game_day integer,load numeric))
      (SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL(SELECT * FROM expected EXCEPT SELECT * FROM actual)
    ) THEN RAISE EXCEPTION 'Race load snapshot changed; retry date settlement'; END IF;
  END IF;
  IF NOT p_deadline_reached AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'riders') r WHERE (r->>'rider_id')::uuid=ANY(v_new) AND r->>'intensity'='unknown_pending') THEN
    RAISE EXCEPTION 'Unknown activity is allowed only at date deadline';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_abilities) a JOIN jsonb_array_elements(p_report->'riders') r ON r->>'rider_id'=a->>'riderId'
    WHERE r->>'intensity'='unknown_pending' AND (a->'patch')-'ability_caps'<>'{}'::jsonb) THEN RAISE EXCEPTION 'Unknown activity cannot award ability growth'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_abilities) LOOP
    -- #6439: v_new is already inside the frozen roster; only a release stops growth.
    IF NOT EXISTS(SELECT 1 FROM public.riders WHERE id=(v_item->>'riderId')::uuid AND team_id IS NOT NULL) THEN RAISE EXCEPTION 'Rider released during date settlement'; END IF;
    SELECT string_agg(format('%I=incoming.%I',key,key),', ') INTO v_assignments FROM jsonb_object_keys(v_item->'patch') key WHERE key<>'rider_id';
    IF v_assignments IS NOT NULL THEN
      EXECUTE format('UPDATE public.rider_derived_abilities a SET %s FROM jsonb_populate_record(NULL::public.rider_derived_abilities,$1) incoming WHERE a.rider_id=$2',v_assignments)
        USING v_item->'patch',(v_item->>'riderId')::uuid;
      GET DIAGNOSTICS v_affected=ROW_COUNT;
      IF v_affected<>1 THEN RAISE EXCEPTION 'Missing rider ability row'; END IF;
    END IF;
  END LOOP;
  INSERT INTO public.rider_condition(rider_id,form,fatigue,injured_until,injury_cause,updated_at,injury_end_game_day,injury_season_id,injury_race_days_left)
  SELECT rider_id,form,fatigue,injured_until,injury_cause,updated_at,injury_end_game_day,injury_season_id,injury_race_days_left FROM jsonb_populate_recordset(NULL::public.rider_condition,p_conditions)
  ON CONFLICT(rider_id) DO UPDATE SET form=EXCLUDED.form,fatigue=EXCLUDED.fatigue,injured_until=EXCLUDED.injured_until,injury_cause=EXCLUDED.injury_cause,
    updated_at=EXCLUDED.updated_at,injury_end_game_day=EXCLUDED.injury_end_game_day,injury_season_id=EXCLUDED.injury_season_id,injury_race_days_left=EXCLUDED.injury_race_days_left;
  INSERT INTO public.rider_derived_ability_history(rider_id,snapshot_date,source,season_number,abilities)
    SELECT rider_id,snapshot_date,source,season_number,abilities FROM jsonb_populate_recordset(NULL::public.rider_derived_ability_history,p_history) ON CONFLICT DO NOTHING;
  INSERT INTO public.rider_ability_race_day_history(rider_id,season_id,game_day,source,season_number,snapshot_date,abilities)
    SELECT rider_id,season_id,game_day,source,season_number,snapshot_date,abilities FROM jsonb_populate_recordset(NULL::public.rider_ability_race_day_history,p_race_history) ON CONFLICT DO NOTHING;
  INSERT INTO public.rider_training_scores(rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions)
    SELECT rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions FROM jsonb_populate_recordset(NULL::public.rider_training_scores,p_scores) ON CONFLICT DO NOTHING;
  INSERT INTO public.training_rider_ticks(rider_id,season_id,game_day,tick_date,team_id,report,created_at)
    SELECT (r->>'rider_id')::uuid,p_season_id,p_game_day,p_tick_date,p_team_id,r,p_now FROM jsonb_array_elements(p_report->'riders') r WHERE (r->>'rider_id')::uuid=ANY(v_new);
  IF v_final THEN
    INSERT INTO public.training_condition_settlements(rider_id,season_id,tick_date,team_id,status,opening_condition,applied_condition,missing_evidence)
      SELECT (r->>'rider_id')::uuid,p_season_id,p_tick_date,p_team_id,
        CASE WHEN jsonb_array_length(COALESCE(r->'missing_evidence','[]'))>0 THEN 'needs_reconciliation' ELSE 'complete' END,
        v_work.opening_conditions->(r->>'rider_id'),(SELECT value FROM jsonb_array_elements(p_conditions) WHERE value->>'rider_id'=r->>'rider_id'),COALESCE(r->'missing_evidence','[]')
      FROM jsonb_array_elements(p_report->'riders') r WHERE (r->>'rider_id')::uuid=ANY(v_new);
    UPDATE public.training_race_loads SET consumed_at=p_now WHERE season_id=p_season_id AND tick_date=p_tick_date AND rider_id=ANY(v_new);
  END IF;
  SELECT count(*) FILTER(WHERE NOT rider_id=ANY(v_work.quarantined_rider_ids))=cardinality(v_work.expected_rider_ids)-cardinality(v_work.quarantined_rider_ids),COALESCE(jsonb_agg(report ORDER BY rider_id),'[]') INTO v_all,v_report
    FROM public.training_rider_ticks WHERE season_id=p_season_id AND game_day=p_game_day AND rider_id=ANY(v_work.expected_rider_ids);
  v_report:=(p_report-'riders')||jsonb_build_object('riders',v_report,'complete',v_all,'partial',NOT v_all,'condition_settled',v_final AND v_all);
  UPDATE public.training_day_runs SET report=v_report WHERE team_id=p_team_id AND season_id=p_season_id AND COALESCE(squad,'senior')=p_squad AND game_day=p_game_day;
  IF NOT FOUND THEN INSERT INTO public.training_day_runs(team_id,season_id,squad,game_day,tick_date,executed_by,bonus_applied,report)
    VALUES(p_team_id,p_season_id,p_squad,p_game_day,p_tick_date,p_executed_by,false,v_report); END IF;
  SELECT count(*) INTO v_count FROM public.training_rider_ticks WHERE season_id=p_season_id AND tick_date=p_tick_date AND rider_id=ANY(v_work.expected_rider_ids) AND NOT rider_id=ANY(v_work.quarantined_rider_ids);
  SELECT COALESCE(jsonb_agg(e||jsonb_build_object('rider_id',s.rider_id) ORDER BY s.rider_id),'[]') INTO v_missing
    FROM public.training_condition_settlements s CROSS JOIN LATERAL jsonb_array_elements(s.missing_evidence)e
    WHERE s.season_id=p_season_id AND s.tick_date=p_tick_date AND s.rider_id=ANY(v_work.expected_rider_ids);
  SELECT v_missing||COALESCE(jsonb_agg(e-'opening_condition'-'current_condition'),'[]') INTO v_missing FROM jsonb_array_elements(v_work.quarantine_evidence)e;
  v_status:=CASE WHEN v_count=(cardinality(v_work.expected_rider_ids)-cardinality(v_work.quarantined_rider_ids))*5 THEN CASE WHEN jsonb_array_length(v_missing)>0 THEN 'needs_reconciliation' ELSE 'complete' END ELSE 'partial' END;
  UPDATE public.training_date_work SET status=v_status,missing_evidence=v_missing,updated_at=p_now WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF (p_deadline_reached OR cardinality(v_work.quarantined_rider_ids)>0) AND jsonb_array_length(v_missing)>0 THEN
    v_payload:=jsonb_build_object('team_id',p_team_id,'season_id',p_season_id,'tick_date',p_tick_date,'missing_evidence',v_missing,
      'rider_ids',(SELECT jsonb_agg(DISTINCT e->>'rider_id') FROM jsonb_array_elements(v_missing)e));
    INSERT INTO public.training_condition_timeout_outbox(team_id,season_id,tick_date,payload,created_at,updated_at)
      VALUES(p_team_id,p_season_id,p_tick_date,v_payload,p_now,p_now)
    ON CONFLICT(team_id,season_id,tick_date) DO UPDATE SET payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at,
      delivered_at=CASE WHEN training_condition_timeout_outbox.payload=EXCLUDED.payload THEN training_condition_timeout_outbox.delivered_at ELSE NULL END;
  END IF;
  RETURN jsonb_build_object('already_ran',false,'applied_rider_ids',to_jsonb(v_new),'report',v_report,'work_status',v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) TO service_role;
