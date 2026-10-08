-- Generated with supabase migration new 6061_first_use_rider_condition.
-- Forward-only prevention, Refs #6061. No existing rider/date is backfilled.
CREATE OR REPLACE FUNCTION public.initialize_first_use_rider_condition()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.team_id IS NULL OR NEW.is_retired IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.rider_condition WHERE rider_id=NEW.id) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_condition_per_date'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_tick_per_race_day'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN
    RAISE EXCEPTION 'training_condition_per_date requires training_tick_per_race_day';
  END IF;
  -- Same first-use guards as register_training_date_work. Ownership mutation
  -- already holds this rider row lock; ON CONFLICT preserves any existing state.
  INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
    SELECT NEW.id,50,0,COALESCE(NEW.acquired_at,NEW.created_at)
    WHERE NOT EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_race_loads WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_day_runs
        WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',NEW.id)))
    ON CONFLICT(rider_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_first_use_rider_condition() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_first_use_rider_condition() TO service_role;
DROP TRIGGER IF EXISTS trg_initialize_first_use_rider_condition ON public.riders;
CREATE TRIGGER trg_initialize_first_use_rider_condition
  AFTER INSERT OR UPDATE OF team_id ON public.riders
  FOR EACH ROW EXECUTE FUNCTION public.initialize_first_use_rider_condition();
