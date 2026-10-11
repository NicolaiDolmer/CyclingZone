-- Read-only gate used by restore and VerifyOnly; psql must use ON_ERROR_STOP.
DO $verify$
BEGIN
  IF to_regclass('public.rider_training_seen') IS NOT NULL THEN
    PERFORM public.training_seen_assert_ready();
  ELSIF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.training_day_runs')
    AND attname='training_seen_indexed' AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.training_day_runs') AND tgname LIKE 'training_seen_%')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('register_training_date_work','initialize_first_use_rider_condition','apply_training_compensation_6061')
      AND p.prosrc LIKE '%rider_training_seen%') THEN
    RAISE EXCEPTION 'training_seen partial schema';
  END IF;
END; $verify$;
SELECT CASE WHEN to_regclass('public.rider_training_seen') IS NULL
  THEN 'TRAINING_SEEN_ABSENT' ELSE 'TRAINING_SEEN_READY' END;
