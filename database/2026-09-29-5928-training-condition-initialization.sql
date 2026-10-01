-- Refs #5928. Forward-only registration fix; no existing dates or flags change.
-- Reports are canonical even when a rider changed teams. Keep this rare
-- first-use history lookup indexed rather than scanning every team's JSON.
CREATE INDEX IF NOT EXISTS idx_training_day_runs_report_riders
  ON public.training_day_runs USING gin ((report->'riders') jsonb_path_ops);
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

