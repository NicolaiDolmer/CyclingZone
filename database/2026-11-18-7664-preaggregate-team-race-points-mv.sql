-- Refs #7664. Preaggregate by race and rider while keeping the independent legacy snapshot.
-- Same result shape, current-team attribution and NULL sums as #5535.
-- Owner approval gates merge, which schedules auto-migrate. Keep the prior view owner-only for rollback.
-- Rollback uses the same writer/lease checks and bounded transaction. Rename the
-- new view aside after refreshing the backup concurrently under the writer lock.
-- Rename team_race_points_mv_before_7664 back, then restore the
-- service_role and (when present) codex_readonly grants on the restored view.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $migration$
DECLARE
  current_view oid := to_regclass('public.team_race_points_mv');
  backup_view oid := to_regclass('public.team_race_points_mv_before_7664');
  readonly_select boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = current_view AND relkind = 'm'
  ) THEN
    RAISE EXCEPTION 'Missing legacy team race points materialized view' USING ERRCODE = '55000';
  END IF;

  IF backup_view IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = backup_view AND relkind = 'm')
       AND position('per_rider_7664' IN pg_get_viewdef(current_view)) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Unexpected existing team race points backup' USING ERRCODE = '55000';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended('cz-ranking-refresh', 0)) OR EXISTS (
    SELECT 1
    FROM public.ranking_refresh_work_state
    WHERE matview_group = 'ranking' AND lease_token IS NOT NULL AND lease_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Ranking refresh writer busy; retry the migration later' USING ERRCODE = '55P03';
  END IF;

  IF to_regclass('public.team_race_points_mv_candidate_7664') IS NOT NULL
     OR to_regclass('public.team_race_points_mv_7664_pk') IS NOT NULL
     OR to_regclass('public.team_race_points_mv_7664_season') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected existing team race points candidate or index' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = current_view AND a.grantee <> c.relowner
      AND a.grantee <> 'service_role'::regrole
      AND a.grantee IS DISTINCT FROM to_regrole('codex_readonly')::oid
  ) THEN
    RAISE EXCEPTION 'Unexpected legacy team race points grants' USING ERRCODE = '55000';
  END IF;

  IF to_regrole('codex_readonly') IS NOT NULL THEN
    readonly_select := has_table_privilege('codex_readonly', current_view, 'SELECT');
  END IF;

  CREATE MATERIALIZED VIEW IF NOT EXISTS public.team_race_points_mv_candidate_7664 AS
  WITH per_rider_7664 AS MATERIALIZED (
    SELECT rr.race_id, rr.rider_id, SUM(rr.prize_money) AS prize
    FROM public.race_results rr
    JOIN public.races ra ON ra.id = rr.race_id
    WHERE ra.squad = 'senior' AND rr.rider_id IS NOT NULL
    GROUP BY rr.race_id, rr.rider_id
  )
  SELECT ra.season_id, ri.team_id, rr.race_id, ra.name AS race_name, SUM(rr.prize) AS race_points
  FROM per_rider_7664 rr
  JOIN public.races ra ON ra.id = rr.race_id
  JOIN public.riders ri ON ri.id = rr.rider_id
  WHERE ri.team_id IS NOT NULL
  GROUP BY ra.season_id, ri.team_id, rr.race_id, ra.name;

  CREATE UNIQUE INDEX IF NOT EXISTS team_race_points_mv_7664_pk
    ON public.team_race_points_mv_candidate_7664 (season_id, team_id, race_id);
  CREATE INDEX IF NOT EXISTS team_race_points_mv_7664_season
    ON public.team_race_points_mv_candidate_7664 (season_id, team_id);
  REVOKE ALL ON TABLE public.team_race_points_mv_candidate_7664 FROM PUBLIC, anon, authenticated, service_role;
  GRANT ALL ON TABLE public.team_race_points_mv_candidate_7664 TO service_role;
  IF readonly_select THEN
    GRANT SELECT ON TABLE public.team_race_points_mv_candidate_7664 TO codex_readonly;
  END IF;
  ALTER MATERIALIZED VIEW public.team_race_points_mv_candidate_7664 OWNER TO postgres;

  -- Existing readers lock only the final metadata swap.
  ALTER MATERIALIZED VIEW public.team_race_points_mv RENAME TO team_race_points_mv_before_7664;
  -- Other stored objects would otherwise follow the original OID into the backup.
  IF EXISTS (
    SELECT 1
    FROM pg_depend d
    WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = current_view AND d.deptype = 'n'
      AND NOT (
        d.classid = 'pg_rewrite'::regclass AND EXISTS (
          SELECT 1 FROM pg_rewrite r WHERE r.oid = d.objid AND r.ev_class = current_view
        )
      )
  ) THEN
    RAISE EXCEPTION 'Stored dependencies on the legacy view require review' USING ERRCODE = '55000';
  END IF;

  ALTER MATERIALIZED VIEW public.team_race_points_mv_candidate_7664 RENAME TO team_race_points_mv;
  REVOKE ALL ON TABLE public.team_race_points_mv_before_7664 FROM PUBLIC, anon, authenticated, service_role;
  IF to_regrole('codex_readonly') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.team_race_points_mv_before_7664 FROM codex_readonly;
  END IF;
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
