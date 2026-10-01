-- #5928: BUILD ONLY until owner rollout approval. Generated using migration new;
-- canonical migration kept in database/ to match this repository's runner.
-- No new balance constants. Service-role-only atomic ability/report/condition commit.
INSERT INTO public.app_config(key, value) VALUES ('training_condition_per_date', '"off"'::jsonb)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.race_simulation_runs ADD COLUMN IF NOT EXISTS condition_load_snapshot jsonb;

-- Run and optional score rows are inserted together. An existing immutable run
-- is never deleted/replaced, preserving the original ID and score foreign keys.
CREATE OR REPLACE FUNCTION public.persist_training_condition_run(p_run jsonb,p_scores jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  candidate public.race_simulation_runs%ROWTYPE;
  saved public.race_simulation_runs%ROWTYPE;
  saved_id uuid;
  date_key date;
BEGIN
  candidate:=jsonb_populate_record(NULL::public.race_simulation_runs,p_run);
  IF jsonb_typeof(candidate.entrant_snapshot) IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.condition_load_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Immutable run requires starter and load snapshots';
  END IF;
  SELECT (scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date INTO STRICT date_key
    FROM public.race_stage_schedule WHERE race_id=candidate.race_id AND stage_number=candidate.stage_number;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||date_key::text,0));
  INSERT INTO public.race_simulation_runs(id,race_id,stage_number,seed,engine_version,entrant_snapshot,input_checksum,source,salt_version,condition_load_snapshot)
  VALUES(COALESCE(candidate.id,gen_random_uuid()),candidate.race_id,candidate.stage_number,candidate.seed,candidate.engine_version,
    candidate.entrant_snapshot,candidate.input_checksum,candidate.source,candidate.salt_version,candidate.condition_load_snapshot)
  ON CONFLICT(race_id,stage_number) DO NOTHING RETURNING id INTO saved_id;
  IF saved_id IS NULL THEN
    SELECT * INTO STRICT saved FROM public.race_simulation_runs
      WHERE race_id=candidate.race_id AND stage_number=candidate.stage_number FOR SHARE;
    IF saved.entrant_snapshot IS DISTINCT FROM candidate.entrant_snapshot
      OR saved.condition_load_snapshot IS DISTINCT FROM candidate.condition_load_snapshot THEN
      RAISE EXCEPTION 'Conflicting immutable race condition run';
    END IF;
    RETURN jsonb_build_object('id',saved.id,'already_saved',true);
  END IF;
  INSERT INTO public.race_simulation_rider_scores(run_id,rider_id,rank,components)
  SELECT saved_id,rider_id,rank,components FROM jsonb_to_recordset(p_scores) AS x(rider_id uuid,rank integer,components jsonb);
  RETURN jsonb_build_object('id',saved_id,'already_saved',false);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_training_condition_run(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_training_condition_run(jsonb,jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.training_race_loads (
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL CHECK(stage_number > 0),
  season_id uuid NOT NULL,
  game_day integer NOT NULL,
  tick_date date NOT NULL,
  load numeric NOT NULL CHECK(load >= 0),
  consumed_at timestamptz,
  reconciliation_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY(rider_id,race_id,stage_number),
  UNIQUE(rider_id,season_id,game_day)
);
CREATE INDEX IF NOT EXISTS training_race_loads_date ON public.training_race_loads(season_id,tick_date,rider_id);
ALTER TABLE public.training_race_loads ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.training_condition_settlements (
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  season_id uuid NOT NULL,
  tick_date date NOT NULL,
  team_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'complete',
  PRIMARY KEY(rider_id,season_id,tick_date)
);
ALTER TABLE public.training_condition_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_race_loads,public.training_condition_settlements FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.training_race_loads,public.training_condition_settlements TO service_role;

CREATE OR REPLACE FUNCTION public.record_training_race_load(p_race_id uuid,p_stage_number integer,p_loads jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  schedule record;
  item record;
  existing public.training_race_loads%ROWTYPE;
  recorded integer := 0;
  starters jsonb;
  saved_loads jsonb;
  settlement_status text;
  late_load boolean;
BEGIN
  SELECT r.season_id,s.game_day,(s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date AS tick_date INTO STRICT schedule
  FROM public.race_stage_schedule s JOIN public.races r ON r.id=s.race_id
  WHERE s.race_id=p_race_id AND s.stage_number=p_stage_number;
  IF schedule.game_day IS NULL OR schedule.tick_date IS NULL THEN RAISE EXCEPTION 'Canonical race schedule required'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||schedule.tick_date::text,0));
  SELECT entrant_snapshot,condition_load_snapshot INTO STRICT starters,saved_loads
  FROM public.race_simulation_runs WHERE race_id=p_race_id AND stage_number=p_stage_number;
  IF jsonb_typeof(starters) IS DISTINCT FROM 'array' OR jsonb_typeof(saved_loads) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_loads) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Immutable stage load snapshot required'; END IF;
  IF (SELECT count(DISTINCT value->>'rider_id') FROM jsonb_array_elements(p_loads))<>jsonb_array_length(p_loads)
    OR EXISTS (
      WITH expected AS (SELECT CASE WHEN jsonb_typeof(value)='string' THEN value #>> '{}' ELSE value->>'rider_id' END AS rider_id FROM jsonb_array_elements(starters)),
      supplied AS (SELECT value->>'rider_id' AS rider_id FROM jsonb_array_elements(p_loads))
      (SELECT * FROM expected EXCEPT SELECT * FROM supplied) UNION ALL (SELECT * FROM supplied EXCEPT SELECT * FROM expected)
    ) THEN RAISE EXCEPTION 'Race loads must exactly cover immutable stage starters'; END IF;
  IF EXISTS (
    WITH expected AS (SELECT rider_id,load FROM jsonb_to_recordset(saved_loads) AS x(rider_id uuid,load numeric)),
    supplied AS (SELECT rider_id,load FROM jsonb_to_recordset(p_loads) AS x(rider_id uuid,load numeric))
    (SELECT * FROM expected EXCEPT SELECT * FROM supplied) UNION ALL (SELECT * FROM supplied EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'Race load conflicts with immutable effort snapshot'; END IF;
  FOR item IN SELECT * FROM jsonb_to_recordset(p_loads) AS x(rider_id uuid,load numeric) ORDER BY rider_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('training-condition:'||item.rider_id::text||':'||schedule.tick_date::text,0));
    SELECT * INTO existing FROM public.training_race_loads
      WHERE rider_id=item.rider_id AND race_id=p_race_id AND stage_number=p_stage_number;
    IF FOUND THEN
      IF existing.load IS DISTINCT FROM item.load OR existing.tick_date<>schedule.tick_date OR existing.game_day<>schedule.game_day THEN
        RAISE EXCEPTION 'Conflicting immutable race load';
      END IF;
      CONTINUE;
    END IF;
    SELECT status INTO settlement_status FROM public.training_condition_settlements
      WHERE rider_id=item.rider_id AND season_id=schedule.season_id AND tick_date=schedule.tick_date;
    late_load:=FOUND AND settlement_status='needs_reconciliation';
    IF FOUND AND NOT late_load THEN
      RAISE EXCEPTION 'Race load arrived after date settlement';
    END IF;
    IF NOT late_load AND to_regclass('public.training_date_work') IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.training_date_work w WHERE w.season_id=schedule.season_id AND w.tick_date=schedule.tick_date AND item.rider_id=ANY(w.quarantined_rider_ids)) INTO late_load;
    END IF;
    IF EXISTS(SELECT 1 FROM public.training_day_runs run JOIN public.riders r ON r.team_id=run.team_id
      WHERE r.id=item.rider_id AND run.tick_date=schedule.tick_date AND run.season_id=schedule.season_id
        AND run.report->>'condition_per_date' IS DISTINCT FROM 'true') THEN
      RAISE EXCEPTION 'Cannot activate normalized load during a legacy training date';
    END IF;
    INSERT INTO public.training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load,reconciliation_required)
    VALUES(item.rider_id,p_race_id,p_stage_number,schedule.season_id,schedule.game_day,schedule.tick_date,item.load,late_load);
    recorded := recorded+1;
  END LOOP;
  RETURN jsonb_build_object('recorded',recorded);
END;
$$;
REVOKE ALL ON FUNCTION public.record_training_race_load(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_training_race_load(uuid,integer,jsonb) TO service_role;

-- Remove the pre-normalization signature so PostgREST never sees an ambiguous overload.
DROP FUNCTION IF EXISTS public.commit_training_date_tick(uuid,uuid,text,integer,date,integer[],text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);

CREATE OR REPLACE FUNCTION public.commit_training_date_tick(
  p_team_id uuid, p_season_id uuid, p_squad text, p_game_day integer,
  p_tick_date date, p_date_game_days integer[], p_executed_by text,
  p_report jsonb, p_abilities jsonb, p_conditions jsonb,
  p_history jsonb, p_race_history jsonb, p_scores jsonb,
  p_race_loads jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  existing_report jsonb;
  day integer;
  item jsonb;
  assignments text;
  affected integer;
  rider uuid;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:' || p_team_id::text, 0));
  IF cardinality(p_date_game_days) <> 5 OR NOT p_game_day = ANY(p_date_game_days)
    OR (SELECT count(DISTINCT d) FROM unnest(p_date_game_days) d) <> 5 THEN
    RAISE EXCEPTION 'Complete date game days required';
  END IF;
  SELECT report INTO existing_report FROM public.training_day_runs
  WHERE team_id = p_team_id AND season_id = p_season_id
    AND COALESCE(squad, 'senior') = p_squad AND game_day = p_game_day FOR UPDATE;
  IF FOUND THEN
    IF existing_report->>'condition_per_date' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Mixed condition cadence for date';
    END IF;
    RETURN jsonb_build_object('already_ran', true);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.training_day_runs earlier
    WHERE earlier.team_id = p_team_id AND earlier.season_id = p_season_id
      AND COALESCE(earlier.squad, 'senior') = p_squad AND earlier.tick_date < p_tick_date
      AND earlier.report->>'condition_per_date' = 'true'
      AND NOT EXISTS (SELECT 1 FROM public.training_day_runs settled
        WHERE settled.team_id = earlier.team_id AND settled.season_id = earlier.season_id
          AND COALESCE(settled.squad, 'senior') = p_squad AND settled.tick_date = earlier.tick_date
          AND settled.report->>'condition_settled' = 'true')
  ) THEN RAISE EXCEPTION 'Earlier date condition settlement is incomplete'; END IF;
  FOREACH day IN ARRAY p_date_game_days LOOP
    IF day < p_game_day AND NOT EXISTS (
      SELECT 1 FROM public.training_day_runs
      WHERE team_id = p_team_id AND season_id = p_season_id
        AND COALESCE(squad, 'senior') = p_squad AND game_day = day
        AND tick_date = p_tick_date AND report->>'condition_per_date' = 'true'
        AND report->>'pending' IS DISTINCT FROM 'true'
    ) THEN RAISE EXCEPTION 'Earlier date ticks must commit first'; END IF;
  END LOOP;
  IF jsonb_array_length(p_conditions) > 0
    AND p_game_day <> (SELECT max(d) FROM unnest(p_date_game_days) d) THEN
    RAISE EXCEPTION 'Condition writes only at date settlement';
  END IF;

  IF p_report->>'condition_settled' = 'true' THEN
    FOR rider IN SELECT (value->>'rider_id')::uuid FROM jsonb_array_elements(p_conditions) ORDER BY 1 LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('training-condition:'||rider::text||':'||p_tick_date::text,0));
      IF EXISTS(SELECT 1 FROM public.training_condition_settlements
        WHERE rider_id=rider AND season_id=p_season_id AND tick_date=p_tick_date) THEN
        RAISE EXCEPTION 'Rider condition already settled on this date';
      END IF;
    END LOOP;
    IF EXISTS (
      WITH actual AS (SELECT rider_id,race_id,stage_number,game_day,load FROM public.training_race_loads
        WHERE season_id=p_season_id AND tick_date=p_tick_date
          AND rider_id IN(SELECT (value->>'rider_id')::uuid FROM jsonb_array_elements(p_conditions))),
      expected AS (SELECT rider_id,race_id,stage_number,game_day,load FROM jsonb_to_recordset(p_race_loads)
        AS x(rider_id uuid,race_id uuid,stage_number integer,game_day integer,load numeric))
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    ) THEN RAISE EXCEPTION 'Race load snapshot changed; retry date settlement'; END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_abilities) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.riders WHERE id = (item->>'riderId')::uuid AND team_id = p_team_id) THEN
      RAISE EXCEPTION 'Rider left team during date settlement';
    END IF;
    -- jsonb_populate_record preserves native column types; quote_ident prevents
    -- payload keys becoming SQL. The function is executable only by service_role.
    SELECT string_agg(format('%I = incoming.%I', key, key), ', ') INTO assignments
    FROM jsonb_object_keys(item->'patch') key WHERE key <> 'rider_id';
    IF assignments IS NOT NULL THEN
      EXECUTE format('UPDATE public.rider_derived_abilities a SET %s FROM jsonb_populate_record(NULL::public.rider_derived_abilities, $1) incoming WHERE a.rider_id = $2', assignments)
      USING item->'patch', (item->>'riderId')::uuid;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Missing rider ability row'; END IF;
    END IF;
  END LOOP;
  INSERT INTO public.rider_condition(rider_id, form, fatigue, injured_until, injury_cause, updated_at,
    injury_end_game_day, injury_season_id, injury_race_days_left)
  SELECT rider_id, form, fatigue, injured_until, injury_cause, updated_at,
    injury_end_game_day, injury_season_id, injury_race_days_left
  FROM jsonb_populate_recordset(NULL::public.rider_condition, p_conditions)
  ON CONFLICT(rider_id) DO UPDATE SET form = EXCLUDED.form, fatigue = EXCLUDED.fatigue,
    injured_until = EXCLUDED.injured_until, injury_cause = EXCLUDED.injury_cause,
    updated_at = EXCLUDED.updated_at, injury_end_game_day = EXCLUDED.injury_end_game_day,
    injury_season_id = EXCLUDED.injury_season_id, injury_race_days_left = EXCLUDED.injury_race_days_left;

  INSERT INTO public.rider_derived_ability_history(rider_id, snapshot_date, source, season_number, abilities)
  SELECT rider_id, snapshot_date, source, season_number, abilities
  FROM jsonb_populate_recordset(NULL::public.rider_derived_ability_history, p_history)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.rider_ability_race_day_history(rider_id, season_id, game_day, source, season_number, snapshot_date, abilities)
  SELECT rider_id, season_id, game_day, source, season_number, snapshot_date, abilities
  FROM jsonb_populate_recordset(NULL::public.rider_ability_race_day_history, p_race_history)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.rider_training_scores(rider_id, team_id, season_id, tick_date, game_day, score, session, day_type, was_race_day, intention, contributions)
  SELECT rider_id, team_id, season_id, tick_date, game_day, score, session, day_type, was_race_day, intention, contributions
  FROM jsonb_populate_recordset(NULL::public.rider_training_scores, p_scores)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.training_day_runs(team_id, season_id, squad, game_day, tick_date, executed_by, bonus_applied, report)
  VALUES (p_team_id, p_season_id, p_squad, p_game_day, p_tick_date, p_executed_by, false, p_report);
  IF p_report->>'condition_settled' = 'true' THEN
    INSERT INTO public.training_condition_settlements(rider_id,season_id,tick_date,team_id)
    SELECT (value->>'rider_id')::uuid,p_season_id,p_tick_date,p_team_id FROM jsonb_array_elements(p_conditions);
    UPDATE public.training_race_loads SET consumed_at=now()
    WHERE season_id=p_season_id AND tick_date=p_tick_date
      AND rider_id IN(SELECT (value->>'rider_id')::uuid FROM jsonb_array_elements(p_conditions));
  END IF;
  RETURN jsonb_build_object('already_ran', false);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_training_date_tick(uuid, uuid, text, integer, date, integer[], text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_training_date_tick(uuid, uuid, text, integer, date, integer[], text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;

-- Explicit owner-approved cutover ONLY. Caller must pause and drain legacy race
-- finalizers first: pre-deployment JS writes cannot participate in SQL locks.
-- p_openings: rider_id, opening_form, opening_fatigue, expected_form,
-- expected_fatigue, source (authoritative report reference).
-- p_loads: rider_id, race_id, stage_number, load (audited actual stage effort).
CREATE OR REPLACE FUNCTION public.bootstrap_training_condition_date(
  p_season_id uuid,p_tick_date date,p_openings jsonb,p_loads jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  opening record;
  stage record;
  actual record;
  flag_value jsonb;
  expected_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  SELECT value INTO flag_value FROM public.app_config WHERE key='training_condition_per_date' FOR UPDATE;
  IF NOT FOUND OR flag_value NOT IN ('"off"'::jsonb,'false'::jsonb) THEN
    RAISE EXCEPTION 'Cutover requires existing off flag';
  END IF;
  SELECT value INTO flag_value FROM public.app_config WHERE key='training_tick_per_race_day' FOR SHARE;
  IF NOT FOUND OR flag_value NOT IN ('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb) THEN
    RAISE EXCEPTION 'training_condition_per_date requires training_tick_per_race_day';
  END IF;
  IF EXISTS(SELECT 1 FROM public.training_day_runs WHERE tick_date=p_tick_date)
    OR EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE tick_date=p_tick_date) THEN
    RAISE EXCEPTION 'Cutover requires an untrained date';
  END IF;
  IF EXISTS(SELECT 1 FROM public.training_race_loads WHERE tick_date=p_tick_date) THEN
    RAISE EXCEPTION 'Cutover date already has load records';
  END IF;
  IF jsonb_typeof(p_openings)<>'array' OR jsonb_typeof(p_loads)<>'array'
    OR jsonb_array_length(p_openings)=0 THEN RAISE EXCEPTION 'Explicit opening and load arrays required'; END IF;
  IF (SELECT count(DISTINCT value->>'rider_id') FROM jsonb_array_elements(p_openings))<>jsonb_array_length(p_openings)
    OR (SELECT count(DISTINCT (value->>'rider_id',value->>'race_id',value->>'stage_number')) FROM jsonb_array_elements(p_loads))<>jsonb_array_length(p_loads) THEN
    RAISE EXCEPTION 'Duplicate cutover rider or load key';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_loads) l
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_openings) o WHERE o->>'rider_id'=l->>'rider_id')) THEN
    RAISE EXCEPTION 'Every loaded rider needs an authoritative opening';
  END IF;
  -- A ledger row must correspond to an actual immutable stage starter, not a
  -- selected rider or an inferred finisher. Require complete, exact coverage.
  IF EXISTS (
    WITH actual AS (
      SELECT DISTINCT CASE WHEN jsonb_typeof(e.value)='string' THEN e.value #>> '{}'
        ELSE e.value->>'rider_id' END AS rider_id,run.race_id::text AS race_id,run.stage_number::text AS stage_number
      FROM public.race_simulation_runs run
      JOIN public.races r ON r.id=run.race_id
      JOIN public.race_stage_schedule s ON s.race_id=run.race_id AND s.stage_number=run.stage_number
      CROSS JOIN LATERAL jsonb_array_elements(run.entrant_snapshot) e
      WHERE r.season_id=p_season_id AND (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date
    ), expected AS (SELECT value->>'rider_id' AS rider_id,value->>'race_id' AS race_id,value->>'stage_number' AS stage_number FROM jsonb_array_elements(p_loads))
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'Cutover loads must exactly cover immutable date starters'; END IF;
  FOR opening IN SELECT * FROM jsonb_to_recordset(p_openings) AS o(rider_id uuid,opening_form integer,opening_fatigue integer,expected_form integer,expected_fatigue integer,source text) ORDER BY rider_id LOOP
    IF opening.source IS NULL OR length(opening.source)=0 OR opening.opening_form IS NULL OR opening.opening_fatigue IS NULL
      OR opening.opening_form NOT BETWEEN 0 AND 100 OR opening.opening_fatigue NOT BETWEEN 0 AND 100 THEN
      RAISE EXCEPTION 'Invalid authoritative opening condition';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('training-condition:'||opening.rider_id::text||':'||p_tick_date::text,0));
    SELECT form,fatigue INTO actual FROM public.rider_condition WHERE rider_id=opening.rider_id FOR UPDATE;
    IF NOT FOUND OR actual.form IS DISTINCT FROM opening.expected_form OR actual.fatigue IS DISTINCT FROM opening.expected_fatigue THEN
      RAISE EXCEPTION 'Cutover current condition changed; regenerate proposal';
    END IF;
    UPDATE public.rider_condition SET form=opening.opening_form,fatigue=opening.opening_fatigue WHERE rider_id=opening.rider_id;
  END LOOP;
  FOR stage IN SELECT (value->>'race_id')::uuid AS race_id,(value->>'stage_number')::integer AS stage_number,
      jsonb_agg(jsonb_build_object('rider_id',value->>'rider_id','load',value->'load') ORDER BY value->>'rider_id') AS loads
    FROM jsonb_array_elements(p_loads) GROUP BY 1,2 ORDER BY 1,2 LOOP
    IF EXISTS(SELECT 1 FROM public.race_simulation_runs WHERE race_id=stage.race_id AND stage_number=stage.stage_number
      AND condition_load_snapshot IS NOT NULL AND condition_load_snapshot IS DISTINCT FROM stage.loads) THEN
      RAISE EXCEPTION 'Cutover conflicts with saved effort snapshot';
    END IF;
    UPDATE public.race_simulation_runs SET condition_load_snapshot=stage.loads
      WHERE race_id=stage.race_id AND stage_number=stage.stage_number;
    PERFORM public.record_training_race_load(stage.race_id,stage.stage_number,stage.loads);
  END LOOP;
  SELECT count(*) INTO expected_count FROM public.training_race_loads WHERE tick_date=p_tick_date AND season_id=p_season_id;
  IF expected_count<>jsonb_array_length(p_loads) THEN RAISE EXCEPTION 'Cutover canonical date mismatch'; END IF;
  UPDATE public.app_config SET value='"on"'::jsonb,updated_at=clock_timestamp() WHERE key='training_condition_per_date';
  INSERT INTO public.app_config(key,value) VALUES('training_condition_activation_date',to_jsonb(p_tick_date::text))
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
  RETURN jsonb_build_object('riders',jsonb_array_length(p_openings),'loads',expected_count,'tick_date',p_tick_date);
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_training_condition_date(uuid,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_training_condition_date(uuid,date,jsonb,jsonb) TO service_role;
