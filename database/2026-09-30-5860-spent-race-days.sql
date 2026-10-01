-- #5860: completed status and ownership changes cannot release actual participation.
-- Uses immutable starters, independent of mutable entries/team ownership and training flags.
BEGIN;
-- Admission references the race row. Take its table lock first, and never wait
-- while holding a partial set of locks against an active result/selection writer.
DO $$
DECLARE attempt integer;
BEGIN
  FOR attempt IN 1..10 LOOP
    BEGIN
      LOCK TABLE public.races,public.race_results,public.race_simulation_runs,public.race_entries IN EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      -- Exception rollback releases every partial lock before the next attempt.
      -- https://www.postgresql.org/docs/17/explicit-locking.html
      IF attempt=10 THEN RAISE; END IF;
    END;
    PERFORM pg_sleep(0.5);
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS public.race_day_participation (
  rider_id uuid NOT NULL,season_id uuid NOT NULL,game_day integer NOT NULL,
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  stage_number integer NOT NULL CHECK(stage_number>0),
  PRIMARY KEY(rider_id,season_id,game_day)
);
ALTER TABLE public.race_day_participation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.race_day_participation FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.race_day_participation TO service_role;
CREATE INDEX IF NOT EXISTS race_day_participation_race ON public.race_day_participation(race_id,stage_number);
-- Bootstrap seasons which still have open races. Historical overlaps keep their
-- earliest actual participation; results and starter snapshots are never rewritten.
INSERT INTO public.race_day_participation(rider_id,season_id,game_day,race_id,stage_number)
WITH evidence AS (
  SELECT ids.rider_id,run.race_id,run.stage_number,run.created_at AS observed_at
  FROM public.race_simulation_runs run CROSS JOIN LATERAL
    (SELECT (CASE WHEN jsonb_typeof(value)='string' THEN value #>> '{}' ELSE value->>'rider_id' END)::uuid AS rider_id
      FROM jsonb_array_elements(run.entrant_snapshot)) ids
  UNION ALL
  SELECT rider_id,race_id,stage_number,imported_at FROM public.race_results
    WHERE result_type='stage' AND rider_id IS NOT NULL
)
SELECT DISTINCT ON (e.rider_id,r.season_id,s.game_day)
  e.rider_id,r.season_id,s.game_day,e.race_id,e.stage_number
FROM evidence e JOIN public.races r ON r.id=e.race_id
JOIN public.race_stage_schedule s ON s.race_id=e.race_id AND s.stage_number=e.stage_number
WHERE s.game_day IS NOT NULL AND e.rider_id IS NOT NULL
  AND r.season_id IN(SELECT season_id FROM public.races WHERE status<>'completed')
ORDER BY e.rider_id,r.season_id,s.game_day,e.observed_at,e.race_id,e.stage_number
ON CONFLICT(rider_id,season_id,game_day) DO NOTHING;

CREATE OR REPLACE FUNCTION public.find_spent_race_days(p_race_id uuid,p_rider_ids uuid[],p_game_day integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  WITH target AS (
    SELECT r.season_id,min(s.game_day) AS first_day,max(s.game_day) AS last_day
    FROM public.races r JOIN public.race_stage_schedule s ON s.race_id=r.id
    WHERE r.id=p_race_id GROUP BY r.season_id
  )
  -- Scalar JSON is not truncated by PostgREST's table-row cap for large fields.
  SELECT COALESCE(jsonb_agg(found ORDER BY found.rider_id,found.game_day,found.race_id),'[]'::jsonb) FROM (
    SELECT p.rider_id,p.race_id,p.game_day FROM target t JOIN public.race_day_participation p
      ON p.season_id=t.season_id AND p.rider_id=ANY(p_rider_ids) AND p.race_id<>p_race_id
    WHERE p.game_day BETWEEN COALESCE(p_game_day,t.first_day) AND COALESCE(p_game_day,t.last_day)
  ) found;
$$;
REVOKE ALL ON FUNCTION public.find_spent_race_days(uuid,uuid[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_spent_race_days(uuid,uuid[],integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_spent_race_entries(p_race_id uuid,p_rider_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_race public.races%ROWTYPE; removed integer;
BEGIN
  SELECT * INTO STRICT current_race FROM public.races WHERE id=p_race_id FOR UPDATE;
  IF current_race.status<>'scheduled' OR current_race.stages_completed<>0 OR current_race.finalize_state IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.race_simulation_runs WHERE race_id=p_race_id)
    OR EXISTS(SELECT 1 FROM public.race_results WHERE race_id=p_race_id AND result_type='stage') THEN
    RAISE EXCEPTION 'Recorded race selection cannot be pruned';
  END IF;
  DELETE FROM public.race_entries e WHERE e.race_id=p_race_id AND e.rider_id=ANY(p_rider_ids)
    AND jsonb_array_length(public.find_spent_race_days(p_race_id,ARRAY[e.rider_id]))>0;
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_spent_race_entries(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prune_spent_race_entries(uuid,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_spent_race_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE day_row record; v_season uuid;
BEGIN
  SELECT season_id INTO STRICT v_season FROM public.races WHERE id=NEW.race_id;
  FOR day_row IN SELECT generate_series(min(game_day),max(game_day)) AS day FROM public.race_stage_schedule WHERE race_id=NEW.race_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('race-participation:'||NEW.rider_id::text||':'||v_season::text||':'||day_row.day::text,0));
  END LOOP;
  IF jsonb_array_length(public.find_spent_race_days(NEW.race_id,ARRAY[NEW.rider_id]))>0 THEN
    RAISE EXCEPTION 'selection_rider_bound: no_rider_double_booking_day (spent participation)' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_spent_race_entry() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_spent_race_entry() TO service_role;
DROP TRIGGER IF EXISTS race_entries_guard_spent_day ON public.race_entries;
CREATE TRIGGER race_entries_guard_spent_day BEFORE INSERT OR UPDATE OF race_id,rider_id,team_id
  ON public.race_entries FOR EACH ROW EXECUTE FUNCTION public.guard_spent_race_entry();

CREATE OR REPLACE FUNCTION public.admit_race_participant(p_race_id uuid,p_stage_number integer,p_rider_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_day integer; v_season uuid; admitted public.race_day_participation%ROWTYPE;
BEGIN
  SELECT r.season_id,s.game_day INTO STRICT v_season,v_day FROM public.races r
    JOIN public.race_stage_schedule s ON s.race_id=r.id WHERE r.id=p_race_id AND s.stage_number=p_stage_number;
  IF v_day IS NULL THEN RAISE EXCEPTION 'Canonical game day required for stage participation'; END IF;
  INSERT INTO public.race_day_participation(rider_id,season_id,game_day,race_id,stage_number)
    VALUES(p_rider_id,v_season,v_day,p_race_id,p_stage_number)
    ON CONFLICT(rider_id,season_id,game_day) DO NOTHING;
  SELECT * INTO STRICT admitted FROM public.race_day_participation
    WHERE rider_id=p_rider_id AND season_id=v_season AND game_day=v_day;
  IF admitted.race_id=p_race_id AND admitted.stage_number=p_stage_number THEN RETURN; END IF;
  -- Previously recorded overlaps are grandfathered for unchanged historical retries.
  -- A new second result/snapshot cannot acquire this exception: its first write has
  -- no preceding result or starter evidence and is rejected atomically.
  IF EXISTS(SELECT 1 FROM public.race_simulation_runs run WHERE run.race_id=p_race_id AND run.stage_number=p_stage_number AND
    (run.entrant_snapshot @> jsonb_build_array(jsonb_build_object('rider_id',p_rider_id::text))
      OR run.entrant_snapshot @> jsonb_build_array(p_rider_id::text)))
    OR EXISTS(SELECT 1 FROM public.race_results result WHERE result.race_id=p_race_id
      AND result.stage_number=p_stage_number AND result.rider_id=p_rider_id AND result.result_type='stage') THEN RETURN; END IF;
  RAISE EXCEPTION 'no_rider_double_booking_day: immutable starter already used this game day' USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION public.admit_race_participant(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admit_race_participant(uuid,integer,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_spent_race_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_riders uuid[]; v_rider uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.race_id=OLD.race_id AND NEW.stage_number=OLD.stage_number
    AND NEW.entrant_snapshot IS NOT DISTINCT FROM OLD.entrant_snapshot THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.entrant_snapshot) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Immutable stage starters required';
  END IF;
  SELECT array_agg(DISTINCT (CASE WHEN jsonb_typeof(value)='string' THEN value #>> '{}' ELSE value->>'rider_id' END)::uuid)
    INTO v_riders FROM jsonb_array_elements(NEW.entrant_snapshot);
  IF array_position(v_riders,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Immutable stage starter id required'; END IF;
  FOR v_rider IN SELECT unnest(v_riders) ORDER BY 1 LOOP
    PERFORM public.admit_race_participant(NEW.race_id,NEW.stage_number,v_rider);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_spent_race_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_spent_race_snapshot() TO service_role;
DROP TRIGGER IF EXISTS race_runs_guard_spent_day ON public.race_simulation_runs;
CREATE TRIGGER race_runs_guard_spent_day BEFORE INSERT OR UPDATE OF race_id,stage_number,entrant_snapshot
  ON public.race_simulation_runs FOR EACH ROW EXECUTE FUNCTION public.guard_spent_race_snapshot();

-- The result RPCs commit their full batch/counter atomically. Admission here runs
-- BEFORE official stage rows, even on the legacy results-before-snapshot path.
CREATE OR REPLACE FUNCTION public.guard_spent_stage_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.admit_race_participant(NEW.race_id,NEW.stage_number,NEW.rider_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_spent_stage_result() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_spent_stage_result() TO service_role;
DROP TRIGGER IF EXISTS race_results_guard_spent_day ON public.race_results;
CREATE TRIGGER race_results_guard_spent_day BEFORE INSERT OR UPDATE OF race_id,stage_number,rider_id,result_type
  ON public.race_results FOR EACH ROW WHEN(NEW.result_type='stage' AND NEW.rider_id IS NOT NULL)
  EXECUTE FUNCTION public.guard_spent_stage_result();
NOTIFY pgrst,'reload schema';
COMMIT;
