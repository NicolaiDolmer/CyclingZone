-- MANUAL-ONLY: #6490 L2. Install after foundation and parity; no production mandate.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.training_seen_backfill_batch(p_limit integer)
RETURNS TABLE(processed bigint,remaining bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE n bigint;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'training_seen invalid batch size'; END IF;
  PERFORM public.training_seen_assert_contract();
  WITH picked AS MATERIALIZED (
    SELECT id FROM public.training_day_runs WHERE NOT training_seen_indexed
    ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.training_day_runs r SET training_seen_indexed=true FROM picked p WHERE r.id=p.id;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN QUERY SELECT n,count(*) FROM public.training_day_runs WHERE NOT training_seen_indexed;
END;
$$;
REVOKE ALL ON FUNCTION public.training_seen_backfill_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_seen_backfill_batch(integer) TO service_role;
COMMIT;
