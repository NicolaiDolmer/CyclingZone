-- Prepared for #6102; NOT applied. Move to top-level only after owner mandate
-- and realistic staging evidence. No scheduler/engine flags or player data writes.
BEGIN;
CREATE OR REPLACE FUNCTION public.stall_watchdog_result_summary(p_race_ids uuid[])
RETURNS TABLE (
  race_id uuid,
  last_imported_at timestamptz,
  has_prize boolean,
  stage_numbers integer[]
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_race_ids IS NULL OR cardinality(p_race_ids) > 300 OR array_position(p_race_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'watchdog candidate batch must contain at most 300 non-null IDs' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT requested.id, summary.last_imported_at, summary.has_prize, summary.stage_numbers
  FROM (SELECT DISTINCT id FROM unnest(p_race_ids) AS candidates(id)) AS requested
  CROSS JOIN LATERAL (
    SELECT max(rr.imported_at) AS last_imported_at,
           coalesce(bool_or(rr.prize_money > 0), false) AS has_prize,
           coalesce(array_agg(DISTINCT rr.stage_number ORDER BY rr.stage_number), ARRAY[]::integer[]) AS stage_numbers
    FROM public.race_results rr
    WHERE rr.race_id = requested.id
  ) AS summary
  ORDER BY requested.id;
END;
$$;

REVOKE ALL ON FUNCTION public.stall_watchdog_result_summary(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stall_watchdog_result_summary(uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
