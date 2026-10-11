-- MANUAL-ONLY: appended AFTER anonymization inside the existing atomic staging restore.
-- Not an independent production repair. No index is removed or created.
DO $restore$
DECLARE batch record; previous_remaining bigint;
BEGIN
  IF to_regclass('public.rider_training_seen') IS NULL THEN
    IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.training_day_runs')
      AND attname='training_seen_indexed' AND NOT attisdropped)
      OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.training_day_runs') AND tgname LIKE 'training_seen_%')
      OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.proname IN('register_training_date_work','initialize_first_use_rider_condition','apply_training_compensation_6061')
        AND p.prosrc LIKE '%rider_training_seen%') THEN
      RAISE EXCEPTION 'training_seen partial schema';
    END IF;
    RETURN;
  END IF;
  IF current_setting('session_replication_role')<>'replica'
    OR NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='cz_environment' AND value='"loadtest-staging"'::jsonb) THEN
    RAISE EXCEPTION 'training_seen restore requires isolated staging in replica mode';
  END IF;
  LOCK TABLE public.training_day_runs,public.rider_training_seen IN ACCESS EXCLUSIVE MODE;
  -- pg_restore --no-acl omits the original REVOKEs. Restore only this reviewed
  -- projection's grants; function bodies/trigger bindings must still pass below.
  REVOKE ALL ON TABLE public.rider_training_seen FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT,INSERT,UPDATE ON TABLE public.rider_training_seen TO service_role;
  REVOKE ALL ON FUNCTION public.training_seen_keys(jsonb),public.training_seen_change(text,bigint),
    public.training_seen_mark_row(),public.training_seen_after_insert(),public.training_seen_after_update(),
    public.training_seen_after_delete(),public.training_seen_after_truncate(),public.training_seen_assert_contract(),
    public.training_seen_parity(),public.training_seen_assert_ready(),public.training_seen_backfill_batch(integer)
    FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.training_seen_keys(jsonb),public.training_seen_change(text,bigint),
    public.training_seen_mark_row(),public.training_seen_after_insert(),public.training_seen_after_update(),
    public.training_seen_after_delete(),public.training_seen_after_truncate(),public.training_seen_assert_contract(),
    public.training_seen_parity(),public.training_seen_assert_ready(),public.training_seen_backfill_batch(integer)
    TO service_role;
  PERFORM public.training_seen_assert_contract();
  -- Imported true markers cannot certify imported counters when triggers were bypassed.
  UPDATE public.training_day_runs SET training_seen_indexed=false;
  UPDATE public.rider_training_seen SET report_count=0 WHERE report_count<>0;
  SELECT count(*) INTO previous_remaining FROM public.training_day_runs;
  PERFORM set_config('session_replication_role','origin',true);
  WHILE previous_remaining>0 LOOP
    SELECT * INTO batch FROM public.training_seen_backfill_batch(500);
    IF batch.processed<=0 OR batch.remaining>=previous_remaining THEN
      RAISE EXCEPTION 'training_seen restore backfill made no progress';
    END IF;
    previous_remaining:=batch.remaining;
  END LOOP;
  PERFORM public.training_seen_assert_ready();
  PERFORM set_config('session_replication_role','replica',true);
END; $restore$;
