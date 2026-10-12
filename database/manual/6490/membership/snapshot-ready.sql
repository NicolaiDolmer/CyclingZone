-- MANUAL-ONLY #6490 M3. Read-only snapshot gate; no production apply mandate.
BEGIN;
CREATE OR REPLACE FUNCTION public.training_membership_snapshot_ready()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE p record;
BEGIN
  PERFORM public.training_membership_assert_contract();
  SELECT * INTO p FROM public.training_membership_parity();
  IF p.unindexed<>0 OR p.missing_refs<>0 OR p.extra_refs<>0 THEN RAISE EXCEPTION 'training_membership not ready'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.training_membership_snapshot_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_membership_snapshot_ready() TO service_role;
COMMIT;
