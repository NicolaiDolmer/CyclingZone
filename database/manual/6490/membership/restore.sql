-- MANUAL-ONLY: appended after anonymization inside the atomic staging restore.
-- Rebuild from every source report, never trust imported marker/reference pairs.
DO $restore$
BEGIN
  IF to_regclass('public.rider_training_report_refs') IS NULL THEN
    IF to_regclass('public.rider_training_seen') IS NOT NULL OR EXISTS(
      SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.training_day_runs')
        AND attname='training_seen_indexed' AND NOT attisdropped)
      OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.training_day_runs')
        AND (tgname LIKE 'training_seen_%' OR tgname LIKE 'training_membership_%'))
      OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.proname IN('register_training_date_work','initialize_first_use_rider_condition','apply_training_compensation_6061')
        AND (p.prosrc LIKE '%rider_training_report_refs%' OR p.prosrc LIKE '%rider_training_seen%')) THEN
      RAISE EXCEPTION 'training_membership partial or rejected schema';
    END IF;
    RETURN;
  END IF;
  IF current_setting('session_replication_role')<>'replica'
    OR NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='cz_environment' AND value='"loadtest-staging"'::jsonb) THEN
    RAISE EXCEPTION 'training_membership restore requires isolated staging in replica mode';
  END IF;
  LOCK TABLE public.training_day_runs,public.rider_training_report_refs IN ACCESS EXCLUSIVE MODE;
  -- Restore the reviewed ACL after pg_restore --no-acl; never repair unknown code.
  REVOKE ALL ON TABLE public.rider_training_report_refs FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT,INSERT,DELETE ON TABLE public.rider_training_report_refs TO service_role;
  REVOKE ALL ON FUNCTION public.training_membership_keys(jsonb),public.training_membership_mark_row(),
    public.training_membership_after_insert(),public.training_membership_after_update(),
    public.training_membership_after_delete(),public.training_membership_after_truncate(),
    public.training_membership_assert_contract(),public.training_membership_parity(),
    public.training_membership_assert_ready(),public.training_membership_backfill_batch(integer) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.training_membership_keys(jsonb),public.training_membership_mark_row(),
    public.training_membership_after_insert(),public.training_membership_after_update(),
    public.training_membership_after_delete(),public.training_membership_after_truncate(),
    public.training_membership_assert_contract(),public.training_membership_parity(),
    public.training_membership_assert_ready(),public.training_membership_backfill_batch(integer) TO service_role;
  IF to_regprocedure('public.training_membership_snapshot_ready()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.training_membership_snapshot_ready() FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.training_membership_snapshot_ready() TO service_role;
  END IF;
  PERFORM public.training_membership_assert_contract();
  -- Exclusive, unpublished restore transaction: derive all pairs directly.
  -- No false->true reset of every imported marker and no repeated backfill scans.
  DELETE FROM public.rider_training_report_refs;
  INSERT INTO public.rider_training_report_refs(report_id,rider_key)
    SELECT r.id,k.rider_key FROM public.training_day_runs r
    CROSS JOIN LATERAL public.training_membership_keys(r.report) k(rider_key);
  UPDATE public.training_day_runs SET training_seen_indexed=true WHERE NOT training_seen_indexed;
  PERFORM set_config('session_replication_role','origin',true);
  PERFORM public.training_membership_assert_ready();
  PERFORM set_config('session_replication_role','replica',true);
END; $restore$;
