-- MANUAL-ONLY #6490 M2. Install after foundation/parity; no production mandate.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT public.training_membership_assert_contract();
-- Index remaining rows so restart can avoid an increasing processed prefix. New reports
-- are marked by BEFORE INSERT and never enter this partial index.
CREATE INDEX IF NOT EXISTS idx_training_membership_unindexed ON public.training_day_runs(id) WHERE NOT training_seen_indexed;
CREATE OR REPLACE FUNCTION public.training_membership_backfill_batch(p_limit integer)
RETURNS TABLE(processed bigint,remaining bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE n bigint;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'training_membership invalid batch size'; END IF;
  IF current_setting('session_replication_role')<>'origin' THEN RAISE EXCEPTION 'training_membership backfill requires origin'; END IF;
  LOCK TABLE public.training_day_runs,public.rider_training_report_refs IN ROW EXCLUSIVE MODE;
  PERFORM public.training_membership_assert_contract();
  WITH picked AS MATERIALIZED(
    SELECT id FROM public.training_day_runs WHERE NOT training_seen_indexed
    ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.training_day_runs r SET training_seen_indexed=true FROM picked p WHERE r.id=p.id;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN QUERY SELECT n,count(*) FROM public.training_day_runs WHERE NOT training_seen_indexed;
END;
$$;
REVOKE ALL ON FUNCTION public.training_membership_backfill_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_membership_backfill_batch(integer) TO service_role;
COMMIT;
