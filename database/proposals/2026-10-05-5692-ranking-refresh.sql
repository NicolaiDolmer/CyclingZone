-- PROPOSAL ONLY. Refs #5692; no production apply/deploy authority in this lane.
-- SSOT: docs/GAME_INVARIANTS.md, ranking admission + public aggregate contracts.
-- Preserve #5911 cadence/training gates and #6133 admission. No view definition,
-- index, historical data, role timeout, owner or scheduler change.
--
-- PostgreSQL 17 supports REFRESH CONCURRENTLY inside a function. The historical
-- #3013 / audit 25 September SPI/isTopLevel assertion does not apply to REFRESH.
-- https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html
-- https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/tcop/utility.c
--
-- Deployment gate: verify populated views + usable full-column UNIQUE indexes
-- on ALL five views, service_role EXECUTE, owner MAINTAIN, and actual PostgREST
-- concurrency in staging. Approve this SQL separately before activating Node.
-- Missing prerequisites MUST fail; never retry a plain REFRESH as a fallback.
-- Existing no-argument functions remain available for rollback/legacy callers;
-- the Node helper sends the named boolean argument and cannot select them.
-- They must be inventoried before claiming every possible DB writer is safe.
-- Each call remains its own transaction; the heartbeat follows all five commits.
-- Rollback: restore the previous Node commit; drop ONLY these boolean overloads
-- in a separately approved SQL action. Old no-argument functions are untouched.

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_rider_rankings_mv(p_concurrently boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_concurrently IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE = '22023';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.rider_rankings_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_rider_rankings_mv(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_rider_rankings_mv(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_team_standings_ext_mv(p_concurrently boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_concurrently IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE = '22023';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.team_standings_ext_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_team_standings_ext_mv(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_standings_ext_mv(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_team_race_points_mv(p_concurrently boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_concurrently IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE = '22023';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.team_race_points_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_team_race_points_mv(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_race_points_mv(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_global_rank_mv(p_concurrently boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_concurrently IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE = '22023';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.global_rank_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_global_rank_mv(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_global_rank_mv(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_youth_rider_rankings_mv(p_concurrently boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_concurrently IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE = '22023';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.youth_rider_rankings_mv;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
