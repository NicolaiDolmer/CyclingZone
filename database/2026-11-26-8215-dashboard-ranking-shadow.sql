-- #8215: one snapshot and one round trip for the dashboard's shadow ranking.
SET lock_timeout = '2s';

-- A cancelled concurrent build can leave an invalid index under this name.
DO $index$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid = to_regclass('public.ranking_rider_season_dashboard_order') AND NOT indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.ranking_rider_season_dashboard_order';
  END IF;
END;
$index$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ranking_rider_season_dashboard_order
  ON public.ranking_rider_season (season_id, points DESC NULLS LAST, rider_id);
RESET lock_timeout;

BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.dashboard_rider_ranking_shadow(
  p_season_id uuid,
  p_league_division_id integer
)
RETURNS TABLE (
  rider_id uuid, firstname text, lastname text, nationality_code text,
  team_name text, is_ai boolean, points numeric, stage_wins bigint, gc_wins bigint, classic_wins bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
  SELECT ranking.rider_id, rider.firstname::text, rider.lastname::text,
    rider.nationality_code::text, team.name::text, COALESCE(team.is_ai, false),
    ranking.points::numeric, ranking.stage_wins::bigint, ranking.gc_wins::bigint, ranking.classic_wins::bigint
  FROM public.ranking_rider_season AS ranking
  JOIN public.riders AS rider ON rider.id = ranking.rider_id AND rider.is_retired = false
  LEFT JOIN public.teams AS team ON team.id = rider.team_id
  WHERE ranking.season_id = p_season_id
    AND (p_league_division_id IS NULL OR team.league_division_id = p_league_division_id)
  ORDER BY ranking.points DESC NULLS LAST, ranking.rider_id
  LIMIT 5;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_rider_ranking_shadow(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_rider_ranking_shadow(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
