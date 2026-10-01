-- Safe administrative restoration from persisted immutable snapshots across dates.
-- This never simulates races and never writes abilities, condition or injuries.
CREATE OR REPLACE FUNCTION public.recover_training_race_load_stage(
  p_race_id uuid,p_stage_number integer,p_expected_finalize_state jsonb DEFAULT NULL,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE race_row public.races%ROWTYPE;loads jsonb;recorded jsonb;new_state jsonb;marker_updated boolean:=false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_condition_per_date' AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb))
    OR NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_tick_per_race_day' AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN
    RAISE EXCEPTION 'Normalized condition ownership required for recorded recovery';
  END IF;
  SELECT * INTO STRICT race_row FROM public.races WHERE id=p_race_id FOR UPDATE;
  IF race_row.finalize_state IS DISTINCT FROM p_expected_finalize_state THEN RAISE EXCEPTION 'Finalization changed; repeat recovery dry-run'; END IF;
  IF race_row.status<>'completed' AND COALESCE(race_row.stages_completed,0)<p_stage_number
    AND NOT(COALESCE((race_row.finalize_state->>'stage_number')::integer,0)=p_stage_number AND COALESCE(race_row.finalize_state->'done','[]')?'write') THEN
    RAISE EXCEPTION 'Original result-write or completed-stage evidence required';
  END IF;
  SELECT condition_load_snapshot INTO STRICT loads FROM public.race_simulation_runs WHERE race_id=p_race_id AND stage_number=p_stage_number;
  IF jsonb_typeof(loads) IS DISTINCT FROM 'array' OR jsonb_array_length(loads)=0 THEN RAISE EXCEPTION 'Original immutable condition load snapshot required'; END IF;
  recorded:=public.record_training_race_load(p_race_id,p_stage_number,loads);
  new_state:=race_row.finalize_state;
  IF COALESCE((new_state->>'stage_number')::integer,0)=p_stage_number
    AND COALESCE(new_state->'done','[]') @> '["write","enrichment"]'::jsonb
    AND NOT(COALESCE(new_state->'done','[]')?'fatigue') THEN
    new_state:=jsonb_set(new_state,'{done}',(new_state->'done')||'["fatigue"]'::jsonb);
  END IF;
  -- Do not let the normal scheduler rebuild historical incidents from today's
  -- riders. A reviewed, separate recovery is required for any unfinished race.
  IF race_row.status<>'completed' THEN
    new_state:=COALESCE(new_state,'{}')||jsonb_build_object('condition_recovery_hold',jsonb_build_object('reason','recorded_load_recovery','requires_review',true));
  END IF;
  IF new_state IS DISTINCT FROM race_row.finalize_state THEN
    UPDATE public.races SET finalize_state=new_state,finalize_updated_at=p_now WHERE id=p_race_id;
    marker_updated:=true;
  END IF;
  RETURN jsonb_build_object('recorded',recorded->'recorded','finalize_state',new_state,'marker_updated',marker_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.recover_training_race_load_stage(uuid,integer,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_training_race_load_stage(uuid,integer,jsonb,timestamptz) TO service_role;

-- Safe completion tail. Non-replayable effects must already have durable marks.
-- Board events are view-only and cannot substitute for a missing board marker.
CREATE OR REPLACE FUNCTION public.prepare_recorded_race_completion(
  p_race_id uuid,p_expected_finalize_state jsonb,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.races%ROWTYPE;total integer;stage record;prepared jsonb;
BEGIN
  SELECT * INTO STRICT r FROM public.races WHERE id=p_race_id FOR UPDATE;
  IF r.status='completed' AND r.finalize_state IS NULL THEN RETURN jsonb_build_object('already_complete',true); END IF;
  IF r.finalize_state IS DISTINCT FROM p_expected_finalize_state THEN RAISE EXCEPTION 'Finalization changed; repeat completion dry-run'; END IF;
  total:=COALESCE(r.stages,(SELECT count(*)::integer FROM public.race_stage_schedule WHERE race_id=p_race_id));
  IF total<1 OR COALESCE(r.stages_completed,0)<>total OR COALESCE((r.finalize_state->>'stage_number')::integer,0)<>total THEN RAISE EXCEPTION 'All original stage writes and final marker are required'; END IF;
  IF NOT(COALESCE(r.finalize_state->'done','[]') @> '["write","enrichment","standings","board","notify","fatigue"]'::jsonb) THEN
    RAISE EXCEPTION 'Missing original completion proof; board/notification effects cannot be guessed or replayed';
  END IF;
  IF (SELECT count(*) FROM public.race_stage_schedule WHERE race_id=p_race_id)<>total THEN RAISE EXCEPTION 'Original canonical schedule is incomplete'; END IF;
  FOR stage IN SELECT * FROM public.race_stage_schedule WHERE race_id=p_race_id ORDER BY stage_number LOOP
    IF NOT EXISTS(SELECT 1 FROM public.race_results WHERE race_id=p_race_id AND stage_number=stage.stage_number AND result_type IN('stage','gc')) THEN RAISE EXCEPTION 'Original stage results are missing'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.race_simulation_runs WHERE race_id=p_race_id AND stage_number=stage.stage_number AND jsonb_typeof(condition_load_snapshot)='array') THEN RAISE EXCEPTION 'Original condition snapshot is missing'; END IF;
    IF EXISTS(SELECT 1 FROM public.race_simulation_runs run CROSS JOIN LATERAL jsonb_array_elements(run.condition_load_snapshot) snapshot(value)
      LEFT JOIN public.training_race_loads ledger ON ledger.race_id=run.race_id AND ledger.stage_number=run.stage_number AND ledger.rider_id=(snapshot.value->>'rider_id')::uuid
      WHERE run.race_id=p_race_id AND run.stage_number=stage.stage_number
      AND(ledger.load IS DISTINCT FROM (snapshot.value->>'load')::numeric OR ledger.game_day IS DISTINCT FROM stage.game_day
        OR ledger.tick_date IS DISTINCT FROM (stage.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date)) THEN RAISE EXCEPTION 'Original stage load restoration is incomplete'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM public.race_results WHERE race_id=p_race_id AND stage_number=total AND result_type='gc') THEN RAISE EXCEPTION 'Original final GC is missing'; END IF;
  prepared:=r.finalize_state||jsonb_build_object('recorded_completion_prepared',true,'condition_recovery_hold',jsonb_build_object('reason','stored_result_completion','requires_review',true));
  IF r.status<>'completed' OR prepared IS DISTINCT FROM r.finalize_state THEN
    UPDATE public.races SET status='completed',stages_completed=total,finalize_state=prepared,finalize_updated_at=p_now WHERE id=p_race_id;
  END IF;
  RETURN jsonb_build_object('already_complete',false,'finalize_state',prepared);
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_recorded_race_completion(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_recorded_race_completion(uuid,jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_recorded_race_completion(
  p_race_id uuid,p_expected_finalize_state jsonb,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.races%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM public.races WHERE id=p_race_id FOR UPDATE;
  IF r.status='completed' AND r.finalize_state IS NULL THEN RETURN jsonb_build_object('already_complete',true); END IF;
  IF r.finalize_state IS DISTINCT FROM p_expected_finalize_state OR r.finalize_state->>'recorded_completion_prepared' IS DISTINCT FROM 'true'
    OR r.status<>'completed' THEN RAISE EXCEPTION 'Prepared completion state changed; repeat safe completion'; END IF;
  UPDATE public.races SET finalize_state=NULL,finalize_updated_at=p_now WHERE id=p_race_id;
  RETURN jsonb_build_object('already_complete',false,'completed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_recorded_race_completion(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_recorded_race_completion(uuid,jsonb,timestamptz) TO service_role;
