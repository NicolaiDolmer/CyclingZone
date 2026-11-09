-- #7737 "Train now" straight away, PR 1 of 4: database and engine behind a switch that is off.
-- Owner go 9/11, solution A. Additive and idempotent (safe to run twice). Applied post-merge
-- per #2642 by auto-migrate.yml. The switch is flipped by the owner only, after PR 2-4.
--
-- 1) Switch training_train_now_instant, seeded off. Only the exact value 'on' turns it on.
-- 2) training_train_now_locks.instant_at: stamped per rider by a press that trains his free
--    race days before his race. whole_day_at cannot carry this, it blocks saving a race
--    selection for the rider (#7191).
-- 3) commit_training_date_tick: the body is the live definition from 2026-10-10-6439 with
--    only the #7737 lines changed. Without a stamp (every rider while the switch is off) the
--    function behaves as before; a stamped rider may fill his race days out of order, gets
--    provisional form and fatigue, and closes his date exactly once on his last missing tick.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_train_now_instant',
  '"off"'::jsonb,
  'Switch for Train now straight away (#7737): a rider with a race later today trains his free race days at the press and gets provisional form and fatigue. Only the exact value on turns it on. off = the press as before. Owner-only flip.'
)
ON CONFLICT (key) DO NOTHING;

-- #6342: fail fast instead of queueing behind live traffic. Safe to re-trigger.
SET lock_timeout = '3s';

ALTER TABLE public.training_train_now_locks ADD COLUMN IF NOT EXISTS instant_at timestamptz;
GRANT UPDATE (instant_at) ON public.training_train_now_locks TO service_role;

CREATE OR REPLACE FUNCTION public.commit_training_date_tick(
  p_team_id uuid,p_season_id uuid,p_squad text,p_game_day integer,p_tick_date date,p_date_game_days integer[],p_executed_by text,
  p_report jsonb,p_abilities jsonb,p_conditions jsonb,p_history jsonb,p_race_history jsonb,p_scores jsonb,
  p_race_loads jsonb DEFAULT '[]',p_deadline_reached boolean DEFAULT false,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  v_work public.training_date_work%ROWTYPE;v_new uuid[];v_rider uuid;v_day integer;v_item jsonb;
  v_assignments text;v_affected integer;v_old_report jsonb;v_report jsonb;v_all boolean;v_final boolean;
  v_missing jsonb;v_payload jsonb;v_status text;v_count integer;v_unsafe uuid[];
  v_instant uuid[]:='{}';v_settling uuid[]:='{}';v_settled_conditions jsonb;
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
  -- #7737: the stamp on the rider's lock row decides, never the switch, so turning the
  -- switch off mid-date is safe: a stamped rider finishes his date the way it began.
  SELECT COALESCE(array_agg(l.rider_id),'{}'::uuid[]) INTO v_instant FROM public.training_train_now_locks l
    WHERE l.tick_date=p_tick_date AND l.instant_at IS NOT NULL AND l.rider_id=ANY(v_new);
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
    -- #7737: a stamped rider's form and fatigue are provisional until his date closes.
    -- The closing settlement is computed from the opening state and the ledger, not from them.
    OR (NOT candidate.rider_key=ANY(v_instant) AND c.form IS DISTINCT FROM (v_work.opening_conditions->candidate.rider_key::text->>'form')::integer)
    OR (NOT candidate.rider_key=ANY(v_instant) AND c.fatigue IS DISTINCT FROM (v_work.opening_conditions->candidate.rider_key::text->>'fatigue')::integer)
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
  -- #7737: who closes his date on this tick? Unstamped riders: the date's last race day,
  -- as always. A stamped rider: the tick that fills his last missing race day.
  SELECT COALESCE(array_agg(candidate.rider_key),'{}'::uuid[]) INTO v_settling FROM unnest(v_new) candidate(rider_key)
    WHERE CASE WHEN candidate.rider_key=ANY(v_instant)
      THEN (SELECT count(*) FROM public.training_rider_ticks t WHERE t.rider_id=candidate.rider_key AND t.season_id=p_season_id AND t.tick_date=p_tick_date
        AND t.game_day=ANY(v_work.game_days) AND t.game_day<>p_game_day)=cardinality(v_work.game_days)-1
      ELSE v_final END;
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
      IF v_day<p_game_day AND NOT v_rider=ANY(v_instant) AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=v_rider AND t.season_id=p_season_id AND t.game_day=v_day AND t.tick_date=p_tick_date) THEN
        RAISE EXCEPTION 'Earlier rider date ticks must commit first';
      END IF;
    END LOOP;
  END LOOP;
  -- Out-of-order slots must be calculated from the receipt state still held
  -- under this transaction's locks. A stale calculation must be retried, never
  -- acknowledged after overwriting another slot's development.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'riders') r
    WHERE (r->>'rider_id')::uuid=ANY(v_instant)
      AND (jsonb_typeof(r->'expected_date_receipt_days') IS DISTINCT FROM 'array'
        OR r->'expected_date_receipt_days' IS DISTINCT FROM (
          SELECT COALESCE(jsonb_agg(t.game_day ORDER BY t.game_day),'[]'::jsonb)
          FROM public.training_rider_ticks t
          WHERE t.rider_id=(r->>'rider_id')::uuid AND t.season_id=p_season_id
            AND t.tick_date=p_tick_date AND t.game_day=ANY(v_work.game_days)))) THEN
    RAISE EXCEPTION 'Training receipt snapshot changed; retry with current rider development';
  END IF;
  -- Mixed retry batches retain only riders whose atomic receipt is absent.
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_abilities FROM jsonb_array_elements(p_abilities) x WHERE (x->>'riderId')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_conditions FROM jsonb_array_elements(p_conditions) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_history FROM jsonb_array_elements(p_history) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_race_history FROM jsonb_array_elements(p_race_history) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_scores FROM jsonb_array_elements(p_scores) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  SELECT COALESCE(jsonb_agg(x),'[]') INTO p_race_loads FROM jsonb_array_elements(p_race_loads) x WHERE (x->>'rider_id')::uuid=ANY(v_new);
  -- #7737: a condition row before the closing tick is only allowed as a stamped rider's
  -- provisional form and fatigue, and a provisional row can never close a date.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_conditions) x WHERE NOT (x->>'rider_id')::uuid=ANY(v_settling)
    AND NOT((x->>'rider_id')::uuid=ANY(v_instant) AND x->>'provisional'='true')) THEN RAISE EXCEPTION 'Condition writes only at date settlement'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_conditions) x WHERE (x->>'rider_id')::uuid=ANY(v_settling) AND x->>'provisional'='true') THEN
    RAISE EXCEPTION 'Provisional condition cannot settle a date; retry';
  END IF;
  IF cardinality(v_settling)>0 THEN
    IF (SELECT count(DISTINCT x->>'rider_id') FROM jsonb_array_elements(p_conditions) x WHERE (x->>'rider_id')::uuid=ANY(v_settling))<>cardinality(v_settling) THEN RAISE EXCEPTION 'Every final rider receipt needs condition settlement'; END IF;
    IF EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=ANY(v_settling) AND season_id=p_season_id AND tick_date=p_tick_date) THEN RAISE EXCEPTION 'Rider condition already settled on this date'; END IF;
    IF EXISTS(
      WITH actual AS(SELECT rider_id,race_id,stage_number,game_day,load FROM public.training_race_loads WHERE season_id=p_season_id AND tick_date=p_tick_date AND rider_id=ANY(v_settling)),
      expected AS(SELECT rider_id,race_id,stage_number,game_day,load FROM jsonb_to_recordset(p_race_loads) AS x(rider_id uuid,race_id uuid,stage_number integer,game_day integer,load numeric) WHERE rider_id=ANY(v_settling))
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
  -- #7737: provisional rows touch form and fatigue only. Injury columns and updated_at stay,
  -- so a press can never take a rider out of today's race.
  SELECT COALESCE(jsonb_agg(x),'[]') INTO v_settled_conditions FROM jsonb_array_elements(p_conditions) x WHERE x->>'provisional' IS DISTINCT FROM 'true';
  UPDATE public.rider_condition c SET form=p.form,fatigue=p.fatigue
    FROM jsonb_populate_recordset(NULL::public.rider_condition,(SELECT COALESCE(jsonb_agg(x),'[]') FROM jsonb_array_elements(p_conditions) x WHERE x->>'provisional'='true')) p
    WHERE c.rider_id=p.rider_id;
  INSERT INTO public.rider_condition(rider_id,form,fatigue,injured_until,injury_cause,updated_at,injury_end_game_day,injury_season_id,injury_race_days_left)
  SELECT rider_id,form,fatigue,injured_until,injury_cause,updated_at,injury_end_game_day,injury_season_id,injury_race_days_left FROM jsonb_populate_recordset(NULL::public.rider_condition,v_settled_conditions)
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
  IF cardinality(v_settling)>0 THEN
    INSERT INTO public.training_condition_settlements(rider_id,season_id,tick_date,team_id,status,opening_condition,applied_condition,missing_evidence)
      SELECT (r->>'rider_id')::uuid,p_season_id,p_tick_date,p_team_id,
        CASE WHEN jsonb_array_length(COALESCE(r->'missing_evidence','[]'))>0 THEN 'needs_reconciliation' ELSE 'complete' END,
        v_work.opening_conditions->(r->>'rider_id'),(SELECT value FROM jsonb_array_elements(p_conditions) WHERE value->>'rider_id'=r->>'rider_id'),COALESCE(r->'missing_evidence','[]')
      FROM jsonb_array_elements(p_report->'riders') r WHERE (r->>'rider_id')::uuid=ANY(v_settling);
    UPDATE public.training_race_loads SET consumed_at=p_now WHERE season_id=p_season_id AND tick_date=p_tick_date AND rider_id=ANY(v_settling);
  END IF;
  SELECT count(*) FILTER(WHERE NOT rider_id=ANY(v_work.quarantined_rider_ids))=cardinality(v_work.expected_rider_ids)-cardinality(v_work.quarantined_rider_ids),COALESCE(jsonb_agg(report ORDER BY rider_id),'[]') INTO v_all,v_report
    FROM public.training_rider_ticks WHERE season_id=p_season_id AND game_day=p_game_day AND rider_id=ANY(v_work.expected_rider_ids);
  v_report:=(p_report-'riders')||jsonb_build_object('riders',v_report,'complete',v_all,'partial',NOT v_all,'condition_settled',cardinality(v_settling)>0 AND v_all);
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

BEGIN;
REVOKE ALL ON FUNCTION public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) TO service_role;
COMMIT;
