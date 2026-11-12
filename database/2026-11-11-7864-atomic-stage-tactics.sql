-- Refs #7864. Atomic stage saves; no flag seed or activation.
-- data-api-access: {"table":"public.race_tactics_stage_state","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Backend-only saved-stage markers preserve manual exceptions including empty resets"}
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.race_tactics_stage_state (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL CHECK (stage_number >= 1),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (team_id, race_id, stage_number)
);
CREATE INDEX IF NOT EXISTS race_tactics_stage_state_race_idx ON public.race_tactics_stage_state(race_id);
ALTER TABLE public.race_tactics_stage_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.race_tactics_stage_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.race_tactics_stage_state TO service_role;
COMMENT ON TABLE public.race_tactics_stage_state IS
  'Backend-only save evidence, including zero-override resets. No engine order overlay. Legacy role/order rows also protect saved destinations.';

CREATE OR REPLACE FUNCTION public.save_race_tactics_7864(
  p_team_id uuid, p_race_id uuid, p_mode text, p_plans jsonb, p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_plan jsonb;
  v_stage integer;
  v_race public.races%ROWTYPE;
  v_schedule timestamptz;
  v_locked boolean;
  v_write_now timestamptz;
  v_current jsonb;
  v_expected jsonb;
  v_profile jsonb;
  v_applied integer[] := '{}';
  v_preserved integer[] := '{}';
  v_locked_stages integer[] := '{}';
BEGIN
  IF p_team_id IS NULL OR p_race_id IS NULL OR (p_now IS NOT NULL AND NOT isfinite(p_now))
    OR p_mode NOT IN ('roles','orders','fill') OR p_mode IS NULL
    OR jsonb_typeof(p_plans) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plans) = 0 THEN
    RAISE EXCEPTION 'team_orders_invalid_body';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_plans) x
    WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
      OR coalesce(x->>'stage_number','') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(x->'expected_entries') IS DISTINCT FROM 'array'
      OR jsonb_typeof(x->'expected_roles') IS DISTINCT FROM 'array')
    OR (SELECT count(*) <> count(DISTINCT x->>'stage_number') FROM jsonb_array_elements(p_plans) x) THEN
    RAISE EXCEPTION 'team_orders_invalid_body';
  END IF;

  -- Every participating writer takes precisely these locks in this order.
  -- Unlike locking an order row, the key exists even for an unplanned stage.
  FOR v_stage IN SELECT (x->>'stage_number')::integer FROM jsonb_array_elements(p_plans) x ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('race-tactics:' || p_team_id::text || ':' || p_race_id::text || ':' || v_stage::text, 0));
  END LOOP;
  SELECT * INTO v_race FROM public.races WHERE id=p_race_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'race_not_found'; END IF;
  IF jsonb_array_length(p_plans) > v_race.stages
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plans) x WHERE (x->>'stage_number')::integer > v_race.stages) THEN
    RAISE EXCEPTION 'team_orders_invalid_body';
  END IF;
  -- Stabilize existing membership while validating and writing its snapshots.
  PERFORM 1 FROM public.race_entries WHERE race_id=p_race_id AND team_id=p_team_id FOR SHARE;
  PERFORM 1 FROM public.race_stage_schedule WHERE race_id=p_race_id
    AND stage_number IN (SELECT (x->>'stage_number')::integer FROM jsonb_array_elements(p_plans) x) ORDER BY stage_number FOR SHARE;
  IF p_mode='fill' THEN
    PERFORM 1 FROM public.race_stage_profiles WHERE race_id=p_race_id
      AND stage_number IN (SELECT (x->>'stage_number')::integer FROM jsonb_array_elements(p_plans) x) ORDER BY stage_number FOR SHARE;
  END IF;
  PERFORM 1 FROM public.race_team_orders WHERE team_id=p_team_id AND race_id=p_race_id
    AND stage_number IN (SELECT (x->>'stage_number')::integer FROM jsonb_array_elements(p_plans) x) ORDER BY stage_number FOR UPDATE;
  -- Production explicitly requests the DB clock after lock waits; tests inject
  -- an exact timestamp and never depend on the wall clock.
  v_write_now := coalesce(p_now,clock_timestamp());

  FOR v_plan IN SELECT x FROM jsonb_array_elements(p_plans) x ORDER BY (x->>'stage_number')::integer LOOP
    v_stage := (v_plan->>'stage_number')::integer;
    v_schedule := NULL;
    SELECT scheduled_at INTO v_schedule FROM public.race_stage_schedule
      WHERE race_id=p_race_id AND stage_number=v_stage FOR SHARE;
    v_locked := v_race.status='completed' OR v_stage<=coalesce(v_race.stages_completed,0)
      OR (v_schedule IS NOT NULL AND v_schedule<=v_write_now)
      OR EXISTS(SELECT 1 FROM public.race_team_orders WHERE team_id=p_team_id AND race_id=p_race_id AND stage_number=v_stage AND locked_at IS NOT NULL);
    IF v_locked THEN
      IF p_mode='fill' THEN v_locked_stages := array_append(v_locked_stages,v_stage); CONTINUE; END IF;
      IF p_mode='roles' THEN RAISE EXCEPTION 'stage_roles_stage_locked'; END IF;
      RAISE EXCEPTION 'team_orders_stage_locked';
    END IF;

    IF p_mode='fill' AND (
      EXISTS(SELECT 1 FROM public.race_tactics_stage_state WHERE team_id=p_team_id AND race_id=p_race_id AND stage_number=v_stage)
      OR EXISTS(SELECT 1 FROM public.race_team_orders WHERE team_id=p_team_id AND race_id=p_race_id AND stage_number=v_stage)
      OR EXISTS(SELECT 1 FROM public.race_stage_roles r JOIN public.race_entries e ON e.race_id=r.race_id AND e.rider_id=r.rider_id
        WHERE r.race_id=p_race_id AND r.stage_number=v_stage AND e.team_id=p_team_id)
    ) THEN v_preserved := array_append(v_preserved,v_stage); CONTINUE; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('rider_id',rider_id,'race_role',race_role) ORDER BY rider_id),'[]') INTO v_current
      FROM public.race_entries WHERE race_id=p_race_id AND team_id=p_team_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('rider_id',x->>'rider_id','race_role',x->>'race_role') ORDER BY x->>'rider_id'),'[]') INTO v_expected
      FROM jsonb_array_elements(v_plan->'expected_entries') x;
    IF v_current<>v_expected OR v_current='[]'::jsonb THEN RAISE EXCEPTION 'tactics_context_changed'; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('rider_id',r.rider_id,'race_role',r.race_role,'effort',r.effort) ORDER BY r.rider_id),'[]') INTO v_current
      FROM public.race_stage_roles r JOIN public.race_entries e ON e.race_id=r.race_id AND e.rider_id=r.rider_id
      WHERE r.race_id=p_race_id AND r.stage_number=v_stage AND e.team_id=p_team_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('rider_id',x->>'rider_id','race_role',x->>'race_role','effort',x->>'effort') ORDER BY x->>'rider_id'),'[]') INTO v_expected
      FROM jsonb_array_elements(v_plan->'expected_roles') x;
    IF v_current<>v_expected THEN RAISE EXCEPTION 'stage_roles_conflict'; END IF;

    IF p_mode='fill' THEN
      SELECT jsonb_build_object('distance_km',distance_km,'profile_type',profile_type,'climbs',climbs,'sprints',sprints) INTO v_profile
        FROM public.race_stage_profiles WHERE race_id=p_race_id AND stage_number=v_stage FOR SHARE;
      IF v_profile IS NULL OR v_profile IS DISTINCT FROM v_plan->'expected_profile'
        OR v_profile->>'profile_type' IN ('itt','itt_hilly','ttt') THEN RAISE EXCEPTION 'tactics_context_changed'; END IF;
    END IF;

    IF (p_mode IN ('roles','fill') AND jsonb_typeof(v_plan->'roles') IS DISTINCT FROM 'array')
      OR (p_mode IN ('orders','fill') AND (jsonb_typeof(v_plan->'order') IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_plan->'order'->'riders') IS DISTINCT FROM 'array')) THEN
      RAISE EXCEPTION 'team_orders_invalid_body';
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT x->>'rider_id' AS rider_id FROM jsonb_array_elements(CASE WHEN p_mode IN ('roles','fill') THEN v_plan->'roles' ELSE '[]'::jsonb END) x
        UNION ALL SELECT x->>'rider_id' FROM jsonb_array_elements(CASE WHEN p_mode IN ('orders','fill') THEN v_plan->'order'->'riders' ELSE '[]'::jsonb END) x
      ) proposed WHERE proposed.rider_id IS NULL
        OR NOT EXISTS(SELECT 1 FROM public.race_entries e WHERE e.race_id=p_race_id AND e.team_id=p_team_id AND e.rider_id::text=proposed.rider_id)
        OR (p_mode<>'orders' AND EXISTS(SELECT 1 FROM public.race_incidents i WHERE i.race_id=p_race_id AND i.rider_id::text=proposed.rider_id AND i.outcome='abandon'))
    ) THEN RAISE EXCEPTION 'tactics_context_changed'; END IF;

    IF p_mode IN ('roles','fill') THEN
      DELETE FROM public.race_stage_roles r USING public.race_entries e
        WHERE e.race_id=r.race_id AND e.rider_id=r.rider_id AND e.team_id=p_team_id AND r.race_id=p_race_id AND r.stage_number=v_stage;
      INSERT INTO public.race_stage_roles(race_id,stage_number,rider_id,race_role,effort,updated_at)
        SELECT p_race_id,v_stage,(x->>'rider_id')::uuid,x->>'race_role',x->>'effort',v_write_now FROM jsonb_array_elements(v_plan->'roles') x;
    END IF;
    IF p_mode IN ('orders','fill') THEN
      INSERT INTO public.race_team_orders(team_id,race_id,stage_number,breakaway_stance,riders,created_at,updated_at)
        VALUES(p_team_id,p_race_id,v_stage,v_plan->'order'->>'breakaway_stance',v_plan->'order'->'riders',v_write_now,v_write_now)
        ON CONFLICT(team_id,race_id,stage_number) DO UPDATE
          SET breakaway_stance=excluded.breakaway_stance,riders=excluded.riders,updated_at=excluded.updated_at;
    END IF;
    INSERT INTO public.race_tactics_stage_state(team_id,race_id,stage_number,updated_at) VALUES(p_team_id,p_race_id,v_stage,v_write_now)
      ON CONFLICT(team_id,race_id,stage_number) DO UPDATE SET updated_at=excluded.updated_at;
    v_applied := array_append(v_applied,v_stage);
  END LOOP;
  RETURN jsonb_build_object('applied',v_applied,'preserved',v_preserved,'locked',v_locked_stages);
END;
$function$;
REVOKE ALL ON FUNCTION public.save_race_tactics_7864(uuid,uuid,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_race_tactics_7864(uuid,uuid,text,jsonb,timestamptz) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
