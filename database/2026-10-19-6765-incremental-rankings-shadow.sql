-- #6765 M1: additive shadow tables. Design: PR #6849.
-- No reader swap or backfill while holding DDL locks. Existing dirty/version
-- triggers and all matviews remain authoritative. Backfill is queued once and
-- processed in bounded batches by the existing coordinator after its pass.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Seed only. Replaying this migration never changes an owner's existing stage.
INSERT INTO public.app_config(key,value)
VALUES('ranking_shadow_enabled','"off"'::jsonb) ON CONFLICT(key) DO NOTHING;

-- data-api-access: {"table":"public.ranking_race_contrib","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Internal ranking shadow processor"}
CREATE TABLE IF NOT EXISTS public.ranking_race_contrib (
  race_id uuid NOT NULL, rider_id uuid, team_id uuid,
  season_id uuid, squad text NOT NULL, race_type text,
  points bigint, prize numeric,
  stage_wins bigint NOT NULL, gc_wins_any bigint NOT NULL,
  pts_wins bigint NOT NULL, mtn_wins bigint NOT NULL, young_wins bigint NOT NULL,
  yellow_days bigint NOT NULL, green_days bigint NOT NULL,
  polka_days bigint NOT NULL, white_days bigint NOT NULL,
  top3 bigint NOT NULL, top10 bigint NOT NULL,
  comp_wins bigint NOT NULL, comp_podiums bigint NOT NULL, podiums bigint NOT NULL,
  UNIQUE NULLS NOT DISTINCT (race_id,rider_id,team_id)
);
CREATE INDEX IF NOT EXISTS ranking_contrib_season_rider ON public.ranking_race_contrib(season_id,rider_id);
CREATE INDEX IF NOT EXISTS ranking_contrib_season_team ON public.ranking_race_contrib(season_id,team_id);
CREATE INDEX IF NOT EXISTS ranking_contrib_rider ON public.ranking_race_contrib(rider_id);
-- The unique index's leading column also provides the race_id access path.

-- data-api-access: {"table":"public.ranking_dirty_log","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"sequences":{"public.ranking_dirty_log_id_seq":{"anon":[],"authenticated":[],"service_role":["USAGE"]}},"reason":"Append-only queue; no shared row on the result-write path"}
CREATE TABLE IF NOT EXISTS public.ranking_dirty_log (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('race','rider','rebuild')),
  race_id uuid, rider_id uuid, old_team_id uuid,
  enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- LIKE preserves the legacy aggregate types and column order, including SUM's
-- NULL semantics. PKs match the unique keys on the corresponding matviews.
-- data-api-access: {"table":"public.ranking_rider_season","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Shadow of rider_rankings_mv"}
CREATE TABLE IF NOT EXISTS public.ranking_rider_season (
  LIKE public.rider_rankings_mv, UNIQUE NULLS NOT DISTINCT(season_id,rider_id)
);
-- data-api-access: {"table":"public.ranking_youth_rider_season","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Shadow of youth_rider_rankings_mv"}
CREATE TABLE IF NOT EXISTS public.ranking_youth_rider_season (
  LIKE public.youth_rider_rankings_mv, UNIQUE NULLS NOT DISTINCT(season_id,squad,rider_id)
);
-- data-api-access: {"table":"public.ranking_team_season_ext","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Shadow of team_standings_ext_mv"}
CREATE TABLE IF NOT EXISTS public.ranking_team_season_ext (
  LIKE public.team_standings_ext_mv, UNIQUE NULLS NOT DISTINCT(season_id,team_id)
);
-- data-api-access: {"table":"public.ranking_team_race_points","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Shadow of team_race_points_mv"}
CREATE TABLE IF NOT EXISTS public.ranking_team_race_points (
  LIKE public.team_race_points_mv, UNIQUE NULLS NOT DISTINCT(season_id,team_id,race_id)
);
CREATE INDEX IF NOT EXISTS ranking_team_race_points_race ON public.ranking_team_race_points(race_id);

ALTER TABLE public.ranking_race_contrib ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_dirty_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_rider_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_youth_rider_season ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_team_season_ext ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_team_race_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ranking_race_contrib FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.ranking_dirty_log FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.ranking_rider_season FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.ranking_youth_rider_season FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.ranking_team_season_ext FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE public.ranking_team_race_points FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_race_contrib TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_dirty_log TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_rider_season TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_youth_rider_season TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_team_season_ext TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.ranking_team_race_points TO service_role;
REVOKE ALL ON SEQUENCE public.ranking_dirty_log_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.ranking_dirty_log_id_seq TO service_role;

-- Seed only on first installation; replay neither resets progress nor adds work.
DO $$ BEGIN
  IF to_regprocedure('public.apply_ranking_deltas(integer,uuid,bigint)') IS NULL THEN
    INSERT INTO public.ranking_dirty_log(kind) VALUES('rebuild');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_ranking_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    INSERT INTO public.ranking_dirty_log(kind) VALUES('rebuild');
  ELSIF TG_TABLE_NAME='race_results' THEN
    IF TG_OP IN ('UPDATE','DELETE') THEN
      INSERT INTO public.ranking_dirty_log(kind,race_id)
        SELECT DISTINCT 'race',race_id FROM old_rows WHERE race_id IS NOT NULL;
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN
      INSERT INTO public.ranking_dirty_log(kind,race_id)
        SELECT DISTINCT 'race',race_id FROM new_rows WHERE race_id IS NOT NULL;
    END IF;
  ELSIF TG_TABLE_NAME='races' THEN
    IF TG_OP='UPDATE' THEN
      INSERT INTO public.ranking_dirty_log(kind,race_id)
        SELECT 'race',o.id FROM old_rows o JOIN new_rows n USING(id)
        WHERE ROW(o.season_id,o.squad,o.race_type,o.name)
          IS DISTINCT FROM ROW(n.season_id,n.squad,n.race_type,n.name);
    ELSIF TG_OP='DELETE' THEN
      INSERT INTO public.ranking_dirty_log(kind,race_id) SELECT 'race',id FROM old_rows;
    ELSE
      INSERT INTO public.ranking_dirty_log(kind,race_id) SELECT 'race',id FROM new_rows;
    END IF;
  ELSIF TG_TABLE_NAME='riders' THEN
    IF TG_OP='UPDATE' THEN
      INSERT INTO public.ranking_dirty_log(kind,rider_id,old_team_id)
        SELECT 'rider',o.id,o.team_id FROM old_rows o JOIN new_rows n USING(id)
        WHERE o.team_id IS DISTINCT FROM n.team_id;
    ELSIF TG_OP='DELETE' THEN
      INSERT INTO public.ranking_dirty_log(kind,rider_id,old_team_id)
        SELECT 'rider',id,team_id FROM old_rows;
    ELSE
      INSERT INTO public.ranking_dirty_log(kind,rider_id) SELECT 'rider',id FROM new_rows;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_ranking_delta() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ranking_delta() TO service_role;

CREATE OR REPLACE TRIGGER ranking_delta_results_insert AFTER INSERT ON public.race_results
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_results_update AFTER UPDATE ON public.race_results
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_results_delete AFTER DELETE ON public.race_results
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_results_truncate AFTER TRUNCATE ON public.race_results
  FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_races_insert AFTER INSERT ON public.races
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_races_update AFTER UPDATE ON public.races
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_races_delete AFTER DELETE ON public.races
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_races_truncate AFTER TRUNCATE ON public.races
  FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_riders_insert AFTER INSERT ON public.riders
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_riders_update AFTER UPDATE ON public.riders
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_riders_delete AFTER DELETE ON public.riders
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();
CREATE OR REPLACE TRIGGER ranking_delta_riders_truncate AFTER TRUNCATE ON public.riders
  FOR EACH STATEMENT EXECUTE FUNCTION public.enqueue_ranking_delta();

CREATE OR REPLACE FUNCTION public.apply_ranking_deltas(
  p_max_items integer DEFAULT 200, p_owner_token uuid DEFAULT NULL,
  p_target_version bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE v_races uuid[]; v_count integer;
BEGIN
  IF p_max_items IS NULL OR p_max_items<1 OR p_max_items>200 THEN
    RAISE EXCEPTION 'p_max_items must be 1..200' USING ERRCODE='22023';
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
  CREATE TEMP TABLE ranking_batch ON COMMIT DROP AS
    WITH claimed AS (
      DELETE FROM public.ranking_dirty_log WHERE id IN (
        SELECT id FROM public.ranking_dirty_log ORDER BY id
        LIMIT p_max_items FOR UPDATE SKIP LOCKED
      ) RETURNING *
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
  -- A transfer can touch many seasons. Fan it out rather than turning one
  -- queue item into an unbounded source scan; carry old attribution to each
  -- later race item, including multiple transfers before the queue drains.
  INSERT INTO public.ranking_dirty_log(kind,race_id,rider_id,old_team_id)
    SELECT DISTINCT 'race',c.race_id,b.rider_id,b.old_team_id
    FROM public.ranking_race_contrib c JOIN pg_temp.ranking_batch b
      ON b.kind='rider' AND b.rider_id=c.rider_id;
  SELECT array_agg(DISTINCT race_id) INTO v_races
    FROM pg_temp.ranking_batch WHERE kind='race';
  v_races:=coalesce(v_races,ARRAY[]::uuid[]);
  CREATE TEMP TABLE ranking_rider_keys ON COMMIT DROP AS
    SELECT DISTINCT season_id,rider_id FROM public.ranking_race_contrib
    WHERE race_id=ANY(v_races) AND rider_id IS NOT NULL;
  CREATE TEMP TABLE ranking_team_keys ON COMMIT DROP AS
    SELECT DISTINCT c.season_id,coalesce(c.team_id,ri.team_id) AS team_id
    FROM public.ranking_race_contrib c LEFT JOIN public.riders ri ON ri.id=c.rider_id
    WHERE c.race_id=ANY(v_races)
    UNION SELECT DISTINCT c.season_id,b.old_team_id FROM public.ranking_race_contrib c
      JOIN pg_temp.ranking_batch b ON b.kind='race' AND b.race_id=c.race_id AND b.rider_id=c.rider_id;
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

  DELETE FROM public.ranking_team_race_points WHERE race_id=ANY(v_races);
  INSERT INTO public.ranking_team_race_points
    SELECT c.season_id,ri.team_id,c.race_id,ra.name,sum(c.prize)
      FROM public.ranking_race_contrib c JOIN public.riders ri ON ri.id=c.rider_id
      JOIN public.races ra ON ra.id=c.race_id
      WHERE c.race_id=ANY(v_races) AND c.squad='senior' AND ri.team_id IS NOT NULL
      GROUP BY c.season_id,ri.team_id,c.race_id,ra.name;
  DELETE FROM public.ranking_team_season_ext s USING pg_temp.ranking_team_keys k
    WHERE s.season_id IS NOT DISTINCT FROM k.season_id AND s.team_id=k.team_id;
  INSERT INTO public.ranking_team_season_ext
    SELECT c.season_id,coalesce(c.team_id,ri.team_id),sum(c.comp_wins),sum(c.comp_podiums),
      sum(c.podiums),coalesce(sum(c.prize) FILTER(WHERE c.team_id IS NOT NULL),0)
    FROM public.ranking_race_contrib c LEFT JOIN public.riders ri ON ri.id=c.rider_id
    WHERE c.squad='senior' AND EXISTS(
      SELECT 1 FROM pg_temp.ranking_team_keys k WHERE (k.season_id=c.season_id OR (k.season_id IS NULL AND c.season_id IS NULL))
        AND k.team_id=coalesce(c.team_id,ri.team_id))
    GROUP BY c.season_id,coalesce(c.team_id,ri.team_id);
  RETURN jsonb_build_object('processed',v_count,'races',cardinality(v_races),
    'pending',EXISTS(SELECT 1 FROM public.ranking_dirty_log));
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.get_ranking_shadow_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('queue_length',count(*)) FROM public.ranking_dirty_log;
$$;
REVOKE ALL ON FUNCTION public.get_ranking_shadow_metrics() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_shadow_metrics() TO service_role;

-- One statement snapshot: concurrent source changes invalidate the generation
-- before a mismatch is reported. Backfill/active writes return pending.
DROP FUNCTION IF EXISTS public.check_ranking_shadow_parity(bigint);
CREATE OR REPLACE FUNCTION public.check_ranking_shadow_parity(p_target_version bigint DEFAULT NULL,p_now timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp SET statement_timeout='30s' AS $$
DECLARE v_differences jsonb; v_name text; v_shadow text; v_count bigint; v_hour integer;
BEGIN
  v_hour:=extract(hour FROM coalesce(p_now,clock_timestamp()) AT TIME ZONE 'Europe/Copenhagen');
  IF v_hour>=19 AND v_hour<22 THEN RETURN jsonb_build_object('status','deferred-peak'); END IF;
  IF EXISTS(SELECT 1 FROM public.ranking_dirty_log) OR EXISTS(
    SELECT 1 FROM public.ranking_refresh_work_state WHERE matview_group='ranking'
      AND requested_version IS DISTINCT FROM coalesce(p_target_version,completed_version)
  ) THEN RETURN jsonb_build_object('status','pending'); END IF;
  v_differences:='{}'::jsonb;
  FOR v_name,v_shadow IN SELECT * FROM (VALUES
    ('rider_rankings_mv','ranking_rider_season'),
    ('youth_rider_rankings_mv','ranking_youth_rider_season'),
    ('team_standings_ext_mv','ranking_team_season_ext'),
    ('team_race_points_mv','ranking_team_race_points')
  ) AS pairs(legacy,shadow) LOOP
    v_hour:=extract(hour FROM coalesce(p_now,clock_timestamp()) AT TIME ZONE 'Europe/Copenhagen');
    IF v_hour>=19 AND v_hour<22 THEN RETURN jsonb_build_object('status','deferred-peak'); END IF;
    EXECUTE format('SELECT count(*) FROM ((SELECT * FROM public.%I EXCEPT ALL SELECT * FROM public.%I)
      UNION ALL (SELECT * FROM public.%I EXCEPT ALL SELECT * FROM public.%I)) d',
      v_name,v_shadow,v_shadow,v_name) INTO v_count;
    v_differences:=v_differences||jsonb_build_object(v_name,v_count);
  END LOOP;
  RETURN jsonb_build_object('status',
    CASE WHEN EXISTS(SELECT 1 FROM jsonb_each_text(v_differences) WHERE value<>'0')
      THEN 'different' ELSE 'equal' END,'differences',v_differences);
END;
$$;
REVOKE ALL ON FUNCTION public.check_ranking_shadow_parity(bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_ranking_shadow_parity(bigint,timestamptz) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
