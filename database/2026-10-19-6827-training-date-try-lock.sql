-- #6827/#6839: manager calls must observe a held date instead of waiting.
-- Additive wrappers; the sweep keeps its existing blocking RPCs unchanged.
-- The successful try-locks remain held through the delegated call in this
-- transaction. PostgreSQL advisory locks are reentrant. No check/release race.
BEGIN;

CREATE OR REPLACE FUNCTION public.try_register_training_date_work(p_team_id uuid,p_season_id uuid,p_tick_date date,p_game_days integer[],p_expected_rider_ids uuid[],p_deadline_at timestamptz DEFAULT NULL,p_registered_at timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  -- Preserve the existing lock order, including the date cutover exclusion.
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0)) THEN
    RETURN jsonb_build_object('held',true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0)) THEN
    RETURN jsonb_build_object('held',true);
  END IF;
  RETURN public.register_training_date_work(p_team_id,p_season_id,p_tick_date,p_game_days,p_expected_rider_ids,p_deadline_at,p_registered_at);
END;
$$;
REVOKE ALL ON FUNCTION public.try_register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.try_register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.try_commit_training_date_tick(p_team_id uuid,p_season_id uuid,p_squad text,p_game_day integer,p_tick_date date,p_date_game_days integer[],p_executed_by text,
  p_report jsonb,p_abilities jsonb,p_conditions jsonb,p_history jsonb,p_race_history jsonb,p_scores jsonb,
  p_race_loads jsonb DEFAULT '[]',p_deadline_reached boolean DEFAULT false,p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  -- Preserve the existing lock order, including the date cutover exclusion.
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0)) THEN
    RETURN jsonb_build_object('held',true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0)) THEN
    RETURN jsonb_build_object('held',true);
  END IF;
  RETURN public.commit_training_date_tick(p_team_id,p_season_id,p_squad,p_game_day,p_tick_date,p_date_game_days,p_executed_by,p_report,p_abilities,p_conditions,p_history,p_race_history,p_scores,p_race_loads,p_deadline_reached,p_now);
END;
$$;
REVOKE ALL ON FUNCTION public.try_commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.try_commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
