-- #6765 M1.5 (shadow only): rider transfers stay off the raw race_results path.
-- Design: PR #6849, open review finding "Keep rider transfers off the raw-race
-- rebuild path". Builds on 2026-10-19-6765-incremental-rankings-shadow.sql.
--
-- Order matters: replaying 2026-10-19-6765-incremental-rankings-shadow.sql
-- after this file restores the M1 function (unbounded claim, raw fan-out).
-- Any manual M1 replay must be followed by a replay of this file.
--
-- Legacy matviews remain the only reader and heartbeat contract. This file
-- replaces two shadow functions in place; no table, trigger, grant or flag
-- changes. Replaying it is a no-op.
--
-- 1. apply_ranking_deltas: a 'rider' queue item (riders.team_id changed, rider
--    inserted or deleted) no longer fans out into per-race raw rebuilds. A
--    transfer never changes ranking_race_contrib (keyed by the race-time
--    race_results.team_id), only the rollups that join the rider's current
--    team. Those are now recomputed from the compact contrib rows: work is
--    proportional to the rider's contrib rows, not to every raw result in
--    every historical race the rider started.
-- 2. The team_standings_ext recompute is index-driven per affected key
--    (direct team rows via (season_id,team_id), owner-attributed rows via
--    riders(team_id) -> (season_id,rider_id)) instead of scanning all of
--    contrib joined to riders on every batch.
-- 3. The queue claim is bounded for real: p_max_items is picked once in a
--    materialized CTE (see the comment at the claim).
-- 4. get_ranking_shadow_metrics also reports the age of the oldest queue item,
--    so a head-of-line stall (same batch failing and rolling back) is visible.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.apply_ranking_deltas(
  p_max_items integer DEFAULT 200, p_owner_token uuid DEFAULT NULL,
  p_target_version bigint DEFAULT NULL, p_maintenance boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE v_races uuid[]; v_rider_races uuid[]; v_rollup_races uuid[]; v_count integer;
BEGIN
  IF p_max_items IS NULL OR p_max_items<1 OR p_max_items>200 THEN
    RAISE EXCEPTION 'p_max_items must be 1..200' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION 'Ranking processor requires READ COMMITTED; retry transaction at READ COMMITTED' USING ERRCODE='40001';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('cz-ranking-shadow-stage',0));
  IF NOT coalesce(p_maintenance,false) AND NOT public.ranking_shadow_writes_enabled() THEN
    RETURN jsonb_build_object('status','disabled','pending',false);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cz-ranking-refresh',0)) THEN
    RAISE EXCEPTION 'Ranking refresh writer busy' USING ERRCODE='55P03';
  END IF;
  -- NULL token is reserved for service-role maintenance/backfill. A coordinator
  -- always supplies both fields, fenced under the same lock as legacy refresh.
  IF p_owner_token IS NOT NULL OR p_target_version IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.ranking_refresh_work_state
      WHERE matview_group='ranking' AND lease_token=p_owner_token
        AND leased_version=p_target_version AND lease_expires_at>clock_timestamp()) THEN
      RAISE EXCEPTION 'Ranking refresh claim lost' USING ERRCODE='55000';
    END IF;
  END IF;
  DROP TABLE IF EXISTS pg_temp.ranking_batch;
  DROP TABLE IF EXISTS pg_temp.ranking_rider_keys;
  DROP TABLE IF EXISTS pg_temp.ranking_team_keys;
  -- The claim is picked exactly once. As `id IN (SELECT ... LIMIT ... FOR
  -- UPDATE SKIP LOCKED)` the planner may rescan the subquery per outer row;
  -- rows this statement already deleted are skipped by the lock, so each
  -- rescan returns the next ids and the batch silently grows to the whole
  -- queue (measured: 4,560 items in one "200" batch after a bulk transfer).
  CREATE TEMP TABLE ranking_batch ON COMMIT DROP AS
    WITH picked AS MATERIALIZED (
      SELECT id FROM public.ranking_dirty_log ORDER BY id
      LIMIT p_max_items FOR UPDATE SKIP LOCKED
    ), claimed AS (
      DELETE FROM public.ranking_dirty_log d USING picked p WHERE d.id=p.id RETURNING d.*
    ) SELECT * FROM claimed;
  SELECT count(*) INTO v_count FROM pg_temp.ranking_batch;
  IF v_count=0 THEN RETURN jsonb_build_object('processed',0,'pending',false); END IF;
  -- Expand repair into cheap race identifiers, never a history aggregate in DDL.
  -- Union with old contributions also removes deleted races after TRUNCATE.
  IF EXISTS(SELECT 1 FROM pg_temp.ranking_batch WHERE kind='rebuild') THEN
    INSERT INTO public.ranking_dirty_log(kind,race_id)
      SELECT 'race',id FROM public.races
      UNION SELECT 'race',race_id FROM public.ranking_race_contrib
      UNION SELECT 'race',race_id FROM public.ranking_team_race_points;
  END IF;
  -- Raw source work is limited to races whose results or metadata changed.
  SELECT array_agg(DISTINCT race_id) INTO v_races
    FROM pg_temp.ranking_batch WHERE kind='race';
  v_races:=coalesce(v_races,ARRAY[]::uuid[]);
  -- A rider event only moves current-team attribution. Contrib keeps the
  -- race-time team, so those rollups are recomputed from contrib alone.
  SELECT array_agg(DISTINCT c.race_id) INTO v_rider_races
    FROM public.ranking_race_contrib c
    WHERE c.rider_id IN (SELECT rider_id FROM pg_temp.ranking_batch WHERE kind='rider' AND rider_id IS NOT NULL);
  v_rider_races:=coalesce(v_rider_races,ARRAY[]::uuid[]);
  CREATE TEMP TABLE ranking_rider_keys ON COMMIT DROP AS
    SELECT DISTINCT season_id,rider_id FROM public.ranking_race_contrib
    WHERE race_id=ANY(v_races) AND rider_id IS NOT NULL;
  CREATE TEMP TABLE ranking_team_keys ON COMMIT DROP AS
    SELECT DISTINCT c.season_id,coalesce(c.team_id,ri.team_id) AS team_id
    FROM public.ranking_race_contrib c LEFT JOIN public.riders ri ON ri.id=c.rider_id
    WHERE c.race_id=ANY(v_races)
    -- Race items queued by the 2026-10-19 fan-out still carry old attribution.
    UNION SELECT DISTINCT c.season_id,b.old_team_id FROM public.ranking_race_contrib c
      JOIN pg_temp.ranking_batch b ON b.kind='race' AND b.race_id=c.race_id AND b.rider_id=c.rider_id;
  -- Rider items: owner-attributed contributions (race-time team NULL) move
  -- between the old and the current team in every season the rider scored.
  INSERT INTO pg_temp.ranking_team_keys
    SELECT DISTINCT c.season_id,k.team_id
      FROM pg_temp.ranking_batch b
      JOIN public.ranking_race_contrib c ON c.rider_id=b.rider_id AND c.team_id IS NULL AND c.squad='senior'
      LEFT JOIN public.riders ri ON ri.id=b.rider_id
      CROSS JOIN LATERAL (VALUES(b.old_team_id),(ri.team_id)) k(team_id)
      WHERE b.kind='rider' AND k.team_id IS NOT NULL
    EXCEPT SELECT * FROM pg_temp.ranking_team_keys;
  -- A previously queued race deletion may already have removed the last
  -- contribution. The old team's summary is durable evidence of every key
  -- that still needs invalidation, independently of contribution lifetime.
  INSERT INTO pg_temp.ranking_team_keys
    SELECT DISTINCT s.season_id,b.old_team_id
      FROM public.ranking_team_season_ext s JOIN pg_temp.ranking_batch b
        ON b.kind='rider' AND s.team_id=b.old_team_id
    EXCEPT SELECT * FROM pg_temp.ranking_team_keys;
  IF EXISTS(SELECT 1 FROM pg_temp.ranking_batch WHERE kind='rebuild') THEN
    INSERT INTO pg_temp.ranking_rider_keys
      SELECT season_id,rider_id FROM public.ranking_rider_season
      UNION SELECT season_id,rider_id FROM public.ranking_youth_rider_season
      EXCEPT SELECT * FROM pg_temp.ranking_rider_keys;
    INSERT INTO pg_temp.ranking_team_keys
      SELECT season_id,team_id FROM public.ranking_team_season_ext
      EXCEPT SELECT * FROM pg_temp.ranking_team_keys;
  END IF;

  DELETE FROM public.ranking_race_contrib WHERE race_id=ANY(v_races);
  INSERT INTO public.ranking_race_contrib
    SELECT rr.race_id,rr.rider_id,rr.team_id,ra.season_id,ra.squad,ra.race_type,
      sum(rr.points_earned),sum(rr.prize_money),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='stage'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='gc'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='points'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='mountain'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='young'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='leader'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='points_day'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='mountain_day'),
      count(*) FILTER(WHERE rr.rank=1 AND rr.result_type='young_day'),
      count(*) FILTER(WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 3),
      count(*) FILTER(WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 10),
      count(*) FILTER(WHERE rr.result_type='team' AND rr.rank=1),
      count(*) FILTER(WHERE rr.result_type='team' AND rr.rank BETWEEN 1 AND 3),
      count(*) FILTER(WHERE rr.result_type IN ('stage','gc') AND rr.rank BETWEEN 1 AND 3)
    FROM public.race_results rr JOIN public.races ra ON ra.id=rr.race_id
    WHERE rr.race_id=ANY(v_races) AND (rr.rider_id IS NOT NULL OR rr.team_id IS NOT NULL)
    GROUP BY rr.race_id,rr.rider_id,rr.team_id,ra.season_id,ra.squad,ra.race_type;
  INSERT INTO pg_temp.ranking_rider_keys
    SELECT DISTINCT season_id,rider_id FROM public.ranking_race_contrib
      WHERE race_id=ANY(v_races) AND rider_id IS NOT NULL
    EXCEPT SELECT * FROM pg_temp.ranking_rider_keys;
  INSERT INTO pg_temp.ranking_team_keys
    SELECT DISTINCT c.season_id,coalesce(c.team_id,ri.team_id)
      FROM public.ranking_race_contrib c LEFT JOIN public.riders ri ON ri.id=c.rider_id
      WHERE c.race_id=ANY(v_races)
    EXCEPT SELECT * FROM pg_temp.ranking_team_keys;
  ANALYZE pg_temp.ranking_rider_keys;
  ANALYZE pg_temp.ranking_team_keys;

  DELETE FROM public.ranking_rider_season s USING pg_temp.ranking_rider_keys k
    WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.rider_id=k.rider_id;
  DELETE FROM public.ranking_youth_rider_season s USING pg_temp.ranking_rider_keys k
    WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.rider_id=k.rider_id;
  INSERT INTO public.ranking_rider_season
    SELECT c.season_id,c.rider_id,sum(c.points),sum(c.prize),
      sum(c.stage_wins),sum(c.gc_wins_any) FILTER(WHERE c.race_type='stage_race'),
      sum(c.gc_wins_any) FILTER(WHERE c.race_type='single'),
      sum(c.pts_wins),sum(c.mtn_wins),sum(c.young_wins),sum(c.yellow_days),
      sum(c.green_days),sum(c.polka_days),sum(c.white_days),sum(c.top3),sum(c.top10)
    FROM public.ranking_race_contrib c JOIN pg_temp.ranking_rider_keys k
      ON (k.season_id=c.season_id OR (k.season_id IS NULL AND c.season_id IS NULL)) AND k.rider_id=c.rider_id
    WHERE c.squad='senior' GROUP BY c.season_id,c.rider_id;
  INSERT INTO public.ranking_youth_rider_season
    SELECT c.season_id,c.rider_id,sum(c.points),sum(c.prize),
      sum(c.stage_wins),sum(c.gc_wins_any) FILTER(WHERE c.race_type='stage_race'),
      sum(c.gc_wins_any) FILTER(WHERE c.race_type='single'),
      sum(c.pts_wins),sum(c.mtn_wins),sum(c.young_wins),sum(c.yellow_days),
      sum(c.green_days),sum(c.polka_days),sum(c.white_days),sum(c.top3),sum(c.top10),c.squad
    FROM public.ranking_race_contrib c JOIN pg_temp.ranking_rider_keys k
      ON (k.season_id=c.season_id OR (k.season_id IS NULL AND c.season_id IS NULL)) AND k.rider_id=c.rider_id
    WHERE c.squad<>'senior' GROUP BY c.season_id,c.squad,c.rider_id;
  -- COUNT/FILTER in the originals returns zero rather than NULL when a race
  -- type is absent. Restore that distinction after the two-stage SUM.
  UPDATE public.ranking_rider_season s SET gc_wins=coalesce(gc_wins,0),classic_wins=coalesce(classic_wins,0)
    FROM pg_temp.ranking_rider_keys k WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.rider_id=k.rider_id;
  UPDATE public.ranking_youth_rider_season s SET gc_wins=coalesce(gc_wins,0),classic_wins=coalesce(classic_wins,0)
    FROM pg_temp.ranking_rider_keys k WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.rider_id=k.rider_id;

  -- team_race_points attributes every race to the rider's current team, so
  -- rider events recompute their races from contrib (no raw source read).
  SELECT array_agg(DISTINCT r) INTO v_rollup_races FROM unnest(v_races||v_rider_races) r;
  v_rollup_races:=coalesce(v_rollup_races,ARRAY[]::uuid[]);
  DELETE FROM public.ranking_team_race_points WHERE race_id=ANY(v_rollup_races);
  INSERT INTO public.ranking_team_race_points
    SELECT c.season_id,ri.team_id,c.race_id,ra.name,sum(c.prize)
      FROM public.ranking_race_contrib c JOIN public.riders ri ON ri.id=c.rider_id
      JOIN public.races ra ON ra.id=c.race_id
      WHERE c.race_id=ANY(v_rollup_races) AND c.squad='senior' AND ri.team_id IS NOT NULL
      GROUP BY c.season_id,ri.team_id,c.race_id,ra.name;
  DELETE FROM public.ranking_team_season_ext s USING pg_temp.ranking_team_keys k
    WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.team_id=k.team_id;
  -- Same output as COALESCE(race-time team, current owner) grouping, read per
  -- key through indexes: direct rows by (season_id,team_id), owner-attributed
  -- rows by riders(team_id) then (season_id,rider_id). NULL seasons get their
  -- own arms so every equality stays sargable.
  INSERT INTO public.ranking_team_season_ext
    SELECT x.season_id,x.team_id,sum(x.comp_wins),sum(x.comp_podiums),sum(x.podiums),
      coalesce(sum(x.prize) FILTER(WHERE x.direct),0)
    FROM (
      SELECT c.season_id,c.team_id,c.comp_wins,c.comp_podiums,c.podiums,c.prize,true AS direct
        FROM (SELECT DISTINCT season_id,team_id FROM pg_temp.ranking_team_keys) k
        JOIN public.ranking_race_contrib c ON c.season_id=k.season_id AND c.team_id=k.team_id
        WHERE c.squad='senior'
      UNION ALL
      SELECT c.season_id,c.team_id,c.comp_wins,c.comp_podiums,c.podiums,c.prize,true
        FROM (SELECT DISTINCT team_id FROM pg_temp.ranking_team_keys WHERE season_id IS NULL) k
        JOIN public.ranking_race_contrib c ON c.season_id IS NULL AND c.team_id=k.team_id
        WHERE c.squad='senior'
      UNION ALL
      SELECT c.season_id,ri.team_id,c.comp_wins,c.comp_podiums,c.podiums,c.prize,false
        FROM (SELECT DISTINCT season_id,team_id FROM pg_temp.ranking_team_keys) k
        JOIN public.riders ri ON ri.team_id=k.team_id
        JOIN public.ranking_race_contrib c ON c.season_id=k.season_id AND c.rider_id=ri.id
        WHERE c.team_id IS NULL AND c.squad='senior'
      UNION ALL
      SELECT c.season_id,ri.team_id,c.comp_wins,c.comp_podiums,c.podiums,c.prize,false
        FROM (SELECT DISTINCT team_id FROM pg_temp.ranking_team_keys WHERE season_id IS NULL) k
        JOIN public.riders ri ON ri.team_id=k.team_id
        JOIN public.ranking_race_contrib c ON c.season_id IS NULL AND c.rider_id=ri.id
        WHERE c.team_id IS NULL AND c.squad='senior'
    ) x
    GROUP BY x.season_id,x.team_id;
  RETURN jsonb_build_object('processed',v_count,'races',cardinality(v_races),
    'rider_races',cardinality(v_rider_races),
    'pending',EXISTS(SELECT 1 FROM public.ranking_dirty_log));
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint,boolean) TO service_role;

-- oldest_age_s is NULL when the queue is empty. Integer seconds keep the
-- Node-side validation strict (safe integer, never negative).
CREATE OR REPLACE FUNCTION public.get_ranking_shadow_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('queue_length',count(*),
    'oldest_age_s',CASE WHEN min(enqueued_at) IS NULL THEN NULL
      ELSE greatest(0,floor(extract(epoch FROM clock_timestamp()-min(enqueued_at))))::bigint END)
  FROM public.ranking_dirty_log;
$$;
REVOKE ALL ON FUNCTION public.get_ranking_shadow_metrics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_shadow_metrics() TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
