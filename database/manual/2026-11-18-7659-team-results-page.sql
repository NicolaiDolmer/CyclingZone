-- Manual only. PC1 runs this file after merge.
-- Refs #7659. Choose the page before looking up its riders, races and seasons.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_team_result_history_page(
  p_team_id uuid,
  p_offset integer,
  p_page_size integer
)
RETURNS TABLE (
  id uuid,
  rank integer,
  result_type text,
  stage_number integer,
  points_earned integer,
  prize_money bigint,
  rider_name text,
  rider jsonb,
  race jsonb
)
-- Keep the search path pinned when this manual definition is replayed (#8741).
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH page AS MATERIALIZED (
    SELECT rr.id, rr.rank, rr.result_type, rr.stage_number, rr.points_earned,
           rr.prize_money, rr.rider_name, rr.rider_id, rr.race_id
    FROM public.race_results rr
    WHERE rr.team_id = p_team_id
    ORDER BY rr.id
    LIMIT LEAST(GREATEST(COALESCE(p_page_size, 0), 0), 1000)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT p.id, p.rank, p.result_type, p.stage_number, p.points_earned,
         p.prize_money, p.rider_name,
         CASE WHEN ri.id IS NOT NULL THEN
           pg_catalog.jsonb_build_object('id', ri.id, 'firstname', ri.firstname, 'lastname', ri.lastname)
         END AS rider,
         CASE WHEN ra.id IS NOT NULL THEN
           pg_catalog.jsonb_build_object(
             'id', ra.id, 'name', ra.name, 'race_type', ra.race_type, 'squad', ra.squad,
             'season', CASE WHEN se.id IS NOT NULL THEN pg_catalog.jsonb_build_object('number', se.number) END
           )
         END AS race
  FROM page p
  LEFT JOIN public.riders ri ON ri.id = p.rider_id
  LEFT JOIN public.races ra ON ra.id = p.race_id
  LEFT JOIN public.seasons se ON se.id = ra.season_id
  ORDER BY p.id;
$$;

REVOKE ALL ON FUNCTION public.get_team_result_history_page(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_result_history_page(uuid, integer, integer)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
