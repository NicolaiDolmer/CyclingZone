-- Perf: dashboard rider-ranking via dedikeret RPC (#2692, Sentry CYCLINGZONE-36)
-- ============================================================================
--
-- ROD-ÅRSAG: GET /api/dashboard/rider-ranking hentede ALLE race_results for
-- managerens division/sæson (op til ~63k rækker i div 1) via fetchAllRows'
-- side-for-side paginering (backend/lib/supabasePagination.js) og aggregerede
-- top-5 i Node. Pagineringen er SEKVENTIEL (én round-trip pr. 1000 rækker) →
-- ~8s "Consecutive HTTP"-spans i Sentry. Dette flytter aggregeringen ind i
-- Postgres, så endpointet laver ét enkelt RPC-kald.
--
-- PARITY (kritisk): funktionen spejler det NUVÆRENDE Node-agg-loop 1:1 — den
-- kopierer IKKE rider_rankings_mv (som splitter gc_wins pr. races.race_type og
-- desuden bucketer klassiker/dags-/trøje-typer). Node-loopet (api.js ~L8582):
--   points     = SUM(points_earned) over ALLE rytterens rækker i div/sæson
--   stage_wins = COUNT(*) FILTER (rank = 1 AND result_type = 'stage')
--   gc_wins    = COUNT(*) FILTER (rank = 1 AND result_type = 'gc')  -- ALLE
--                race-typer (loopet filtrerer IKKE på race_type)
--   ekskluder riders.is_retired; is_ai/team_name fra rytterens NUVÆRENDE hold
--   (riders.team_id, ikke race_results.team_id-snapshot); top-5 efter points DESC.
-- Tie-break: points DESC, dernæst MIN(race_results.id) ASC — spejler at Node
-- itererer rækker i .order("id") og bevarer først-sete rytter ved lige point
-- (JS' stabile sort). race_results.id er uuid → sammenlignes som text.
--
-- Paritet verificeret read-only mod prod 2026-07-19 (sæsonens aktive divisioner
-- 1/2/7): den ækvivalente SELECT gav samme top-5 (rider_id, points, stage_wins,
-- gc_wins, is_ai) som en uafhængig pr.-rytter-aggregering; retired-rækker
-- ekskluderet.
--
-- SIKKERHED: route-laget (backend/routes/api.js) kalder Supabase med
-- SUPABASE_SERVICE_KEY (service_role). GRANT gives derfor KUN til service_role
-- (anon blev netop låst ned i #2676 — udvid den ALDRIG her). SECURITY DEFINER
-- så funktionen kan læse race_results/riders/teams uafhængigt af RLS; intern
-- gate afviser alt der ikke er service_role (defense-in-depth hvis grants
-- nogensinde udvides). SET search_path pinned (samme mønster som
-- get_retention_scorecard_activity / refresh_ranking_matviews).
--
-- Idempotent (CREATE OR REPLACE). Ingen nye indexes: races(season_id,
-- league_division_id) [idx_races_season_pool] + race_results(race_id)
-- [idx_race_results] dækker allerede join-stien.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.dashboard_rider_ranking(uuid, integer);

CREATE OR REPLACE FUNCTION public.dashboard_rider_ranking(
  p_season_id uuid,
  p_league_division_id integer
)
RETURNS TABLE (
  rider_id         uuid,
  firstname        text,
  lastname         text,
  nationality_code text,
  team_name        text,
  is_ai            boolean,
  points           bigint,
  stage_wins       bigint,
  gc_wins          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ri.id,
    ri.firstname,
    ri.lastname,
    ri.nationality_code,
    te.name,
    COALESCE(te.is_ai, false),
    SUM(COALESCE(rr.points_earned, 0))::bigint,
    COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'stage'),
    COUNT(*) FILTER (WHERE rr.rank = 1 AND rr.result_type = 'gc')
  FROM public.race_results rr
  JOIN public.races ra
    ON ra.id = rr.race_id
   AND ra.season_id = p_season_id
   AND (p_league_division_id IS NULL OR ra.league_division_id = p_league_division_id)
  JOIN public.riders ri
    ON ri.id = rr.rider_id
   AND ri.is_retired IS NOT TRUE
  LEFT JOIN public.teams te
    ON te.id = ri.team_id
  WHERE rr.rider_id IS NOT NULL
  GROUP BY ri.id, ri.firstname, ri.lastname, ri.nationality_code, te.name, te.is_ai
  ORDER BY SUM(COALESCE(rr.points_earned, 0)) DESC, MIN(rr.id::text) ASC
  LIMIT 5;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_rider_ranking(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_rider_ranking(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.dashboard_rider_ranking(uuid, integer) IS
  'Top-5 ryttere efter point i en managers division+sæson til dashboard-kortet (#2692). Spejler det gamle Node-agg-loop 1:1 (IKKE rider_rankings_mv). Gate: service_role (route kalder med SUPABASE_SERVICE_KEY).';

-- PostgREST schema-cache reload så RPC'en er kaldbar umiddelbart efter migrate.
NOTIFY pgrst, 'reload schema';
