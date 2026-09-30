-- #5860: service-only historical reconciliation preserves existing results and
-- immutable effort evidence while counting one physical load per rider/game day.
-- No player recovery is executed by this migration.
BEGIN;
ALTER TABLE public.training_race_loads ADD COLUMN IF NOT EXISTS duplicate_of_race_id uuid;
ALTER TABLE public.training_race_loads ADD COLUMN IF NOT EXISTS duplicate_of_stage_number integer;
CREATE UNIQUE INDEX IF NOT EXISTS training_race_loads_one_actual_day
  ON public.training_race_loads(rider_id,season_id,game_day) WHERE duplicate_of_race_id IS NULL;
ALTER TABLE public.training_race_loads DROP CONSTRAINT IF EXISTS training_race_loads_rider_id_season_id_game_day_key;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.training_race_loads'::regclass AND conname='training_race_load_alias_pair') THEN
    ALTER TABLE public.training_race_loads ADD CONSTRAINT training_race_load_alias_pair CHECK(
      (duplicate_of_race_id IS NULL AND duplicate_of_stage_number IS NULL) OR
      (duplicate_of_race_id IS NOT NULL AND duplicate_of_stage_number IS NOT NULL AND duplicate_of_stage_number>0 AND duplicate_of_race_id<>race_id));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.training_race_loads'::regclass AND conname='training_race_load_alias_source') THEN
    ALTER TABLE public.training_race_loads ADD CONSTRAINT training_race_load_alias_source
      FOREIGN KEY(rider_id,duplicate_of_race_id,duplicate_of_stage_number)
      REFERENCES public.training_race_loads(rider_id,race_id,stage_number);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_training_race_load_alias()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE original public.training_race_loads%ROWTYPE;
BEGIN
  IF NEW.duplicate_of_race_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.training_race_loads child WHERE child.rider_id=NEW.rider_id
    AND child.duplicate_of_race_id=NEW.race_id AND child.duplicate_of_stage_number=NEW.stage_number) THEN
    RAISE EXCEPTION 'Historical alias source cannot itself become an alias';
  END IF;
  SELECT * INTO STRICT original FROM public.training_race_loads
    WHERE rider_id=NEW.rider_id AND race_id=NEW.duplicate_of_race_id AND stage_number=NEW.duplicate_of_stage_number;
  IF original.duplicate_of_race_id IS NOT NULL OR original.season_id<>NEW.season_id
    OR original.game_day<>NEW.game_day OR original.tick_date<>NEW.tick_date THEN
    RAISE EXCEPTION 'Historical race load alias must match one original activity slot';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_training_race_load_alias() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_training_race_load_alias() TO service_role;
DROP TRIGGER IF EXISTS training_race_loads_guard_alias ON public.training_race_loads;
CREATE TRIGGER training_race_loads_guard_alias BEFORE INSERT OR UPDATE
  ON public.training_race_loads FOR EACH ROW EXECUTE FUNCTION public.guard_training_race_load_alias();

CREATE OR REPLACE FUNCTION public.recover_transferred_race_loads(
  p_race_id uuid,p_stage_number integer,p_expected_loads jsonb,p_sources jsonb,p_expected_finalize_state jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target record; evidence jsonb; item record; original public.training_race_loads%ROWTYPE;
  original_schedule record; actual_load numeric; existing public.training_race_loads%ROWTYPE;
  recorded jsonb; aliases integer:=0;
BEGIN
  SELECT r.season_id,r.finalize_state,s.game_day,(s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date AS tick_date,s.scheduled_at
    INTO STRICT target FROM public.races r JOIN public.race_stage_schedule s ON s.race_id=r.id
    WHERE r.id=p_race_id AND s.stage_number=p_stage_number FOR UPDATE OF r;
  IF target.finalize_state IS DISTINCT FROM p_expected_finalize_state OR target.finalize_state IS NULL
    OR (target.finalize_state->>'stage_number')::integer IS DISTINCT FROM p_stage_number THEN
    RAISE EXCEPTION 'Historical race finalization changed; repeat read-only preparation';
  END IF;
  SELECT condition_load_snapshot INTO STRICT evidence FROM public.race_simulation_runs
    WHERE race_id=p_race_id AND stage_number=p_stage_number;
  IF evidence IS DISTINCT FROM p_expected_loads OR jsonb_typeof(p_sources) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_sources)=0 OR
    (SELECT count(DISTINCT value->>'rider_id') FROM jsonb_array_elements(p_sources))<>jsonb_array_length(p_sources) THEN
    RAISE EXCEPTION 'Historical recovery requires exact immutable loads and distinct approved sources';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||target.tick_date::text,0));
  FOR item IN SELECT * FROM jsonb_to_recordset(p_sources) AS x(rider_id uuid,race_id uuid,stage_number integer) ORDER BY rider_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('training-condition:'||item.rider_id::text||':'||target.tick_date::text,0));
    SELECT * INTO STRICT original FROM public.training_race_loads
      WHERE rider_id=item.rider_id AND race_id=item.race_id AND stage_number=item.stage_number;
    SELECT s.scheduled_at INTO STRICT original_schedule FROM public.race_stage_schedule s
      WHERE s.race_id=item.race_id AND s.stage_number=item.stage_number;
    SELECT load INTO STRICT actual_load FROM jsonb_to_recordset(evidence) AS x(rider_id uuid,load numeric) WHERE rider_id=item.rider_id;
    IF original.race_id=p_race_id OR original.duplicate_of_race_id IS NOT NULL OR original.consumed_at IS NOT NULL
      OR original.season_id<>target.season_id OR original.game_day<>target.game_day OR original.tick_date<>target.tick_date
      OR original_schedule.scheduled_at>=target.scheduled_at OR EXISTS(
        SELECT 1 FROM public.training_condition_settlements WHERE rider_id=item.rider_id
          AND season_id=target.season_id AND tick_date=target.tick_date) THEN
      RAISE EXCEPTION 'Historical recovery source is not an earlier unsettled activity on this slot';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.race_results WHERE race_id=p_race_id AND stage_number=p_stage_number
      AND rider_id=item.rider_id AND result_type='stage') THEN RAISE EXCEPTION 'Existing historical result required'; END IF;
    SELECT * INTO existing FROM public.training_race_loads WHERE rider_id=item.rider_id AND race_id=p_race_id AND stage_number=p_stage_number;
    IF FOUND THEN
      IF existing.load IS DISTINCT FROM actual_load OR existing.duplicate_of_race_id IS DISTINCT FROM item.race_id
        OR existing.duplicate_of_stage_number IS DISTINCT FROM item.stage_number THEN RAISE EXCEPTION 'Historical alias conflicts with approved source'; END IF;
    ELSE
      INSERT INTO public.training_race_loads(rider_id,race_id,stage_number,season_id,game_day,tick_date,load,duplicate_of_race_id,duplicate_of_stage_number)
        VALUES(item.rider_id,p_race_id,p_stage_number,target.season_id,target.game_day,target.tick_date,actual_load,item.race_id,item.stage_number);
      aliases:=aliases+1;
    END IF;
  END LOOP;
  -- All other starters are registered by the unchanged exact-snapshot RPC in
  -- this transaction. Any missing unapproved conflict rolls the whole repair back.
  recorded:=public.record_training_race_load(p_race_id,p_stage_number,p_expected_loads);
  RETURN recorded||jsonb_build_object('aliases',aliases);
END;
$$;
REVOKE ALL ON FUNCTION public.recover_transferred_race_loads(uuid,integer,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_transferred_race_loads(uuid,integer,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
