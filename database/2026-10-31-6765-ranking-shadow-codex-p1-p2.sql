-- #6765 (shadow only): the two open Codex findings in the design (PR #6849,
-- docs/superpowers/specs/2026-10-18-6765-incremental-rankings-design.md,
-- "Åbne review-fund"). Builds on 2026-10-19-6765-incremental-rankings-shadow.sql
-- and 2026-10-23-6765-ranking-shadow-contrib-transfers.sql (M1.5); everything
-- M1.5 does is kept, this file only adds to it.
--
-- Order matters: replaying the M1 or M1.5 file after this one restores an
-- older apply_ranking_deltas (inline whole-history sweep on rebuild, no queue
-- watermarks). That older function stays correct: it simply deletes 'season'
-- items as no-ops. Replay this file again afterwards to restore the bounds.
--
-- Legacy matviews remain the only reader and heartbeat contract. The flag
-- ranking_shadow_enabled is not touched. Replaying this file is a no-op.
--
-- P2 "Preserve progress across per-season rebuild calls": a 'rebuild' marker
--    used to recompute every summary key of every season inline, in the same
--    30 s call that consumed the marker. It now only expands into durable queue
--    work: one 'race' item per race (as before) followed by one 'season' sweep
--    item per summary season. A season sweep recomputes that season's summary
--    keys from contrib (removing orphan rows). A claimed batch holds at most one
--    season sweep, so no single call grows with the number of seasons, and a
--    failed or interrupted call rolls back with the remaining work still queued.
-- P1 "Drain the queue before acknowledging the refresh version": the queue
--    ids are the version boundary. get_ranking_shadow_metrics reports max_id
--    (read after the coordinator claimed its version, so it covers every item
--    committed with that version) and apply_ranking_deltas reports next_id (the
--    queue head) plus the id range a rebuild expanded into. The Node pass
--    (backend/lib/rankingShadowPass.ts) keeps draining under its lease until
--    the head is past the version's watermark, before the version is
--    acknowledged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A season sweep needs the season it covers. NULL is a real season value
-- (races without a season), so a 'season' item with season_id NULL sweeps the
-- NULL season. Additive, nullable, no default: metadata-only.
ALTER TABLE public.ranking_dirty_log ADD COLUMN IF NOT EXISTS season_id uuid;
ALTER TABLE public.ranking_dirty_log DROP CONSTRAINT IF EXISTS ranking_dirty_log_kind_check;
ALTER TABLE public.ranking_dirty_log ADD CONSTRAINT ranking_dirty_log_kind_check
  CHECK (kind IN ('race','rider','rebuild','season'));

CREATE OR REPLACE FUNCTION public.apply_ranking_deltas(
  p_max_items integer DEFAULT 200, p_owner_token uuid DEFAULT NULL,
  p_target_version bigint DEFAULT NULL, p_maintenance boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp SET lock_timeout='2s' SET statement_timeout='30s' AS $$
DECLARE v_races uuid[]; v_rider_races uuid[]; v_rollup_races uuid[]; v_count integer;
  v_seasons integer; v_rebuild_from bigint; v_rebuild_through bigint; v_expanded bigint;
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
  -- P2: a batch also holds at most one season sweep. The window counts sweeps
  -- in id order; everything from the second sweep on stays queued (still
  -- locked by this statement until commit, then free for the next call).
  CREATE TEMP TABLE ranking_batch ON COMMIT DROP AS
    WITH picked AS MATERIALIZED (
      SELECT id,kind FROM public.ranking_dirty_log ORDER BY id
      LIMIT p_max_items FOR UPDATE SKIP LOCKED
    ), bounded AS MATERIALIZED (
      SELECT id FROM (
        SELECT id,count(*) FILTER(WHERE kind='season') OVER(ORDER BY id) AS sweeps FROM picked
      ) w WHERE sweeps<=1
    ), claimed AS (
      DELETE FROM public.ranking_dirty_log d USING bounded p WHERE d.id=p.id RETURNING d.*
    ) SELECT * FROM claimed;
  SELECT count(*),count(*) FILTER(WHERE kind='season'),min(id) FILTER(WHERE kind='rebuild')
    INTO v_count,v_seasons,v_rebuild_from FROM pg_temp.ranking_batch;
  IF v_count=0 THEN
    RETURN jsonb_build_object('processed',0,'pending',false,'next_id',NULL);
  END IF;
  -- Expand repair into cheap durable work, never a history aggregate in one
  -- call. Union with old contributions also removes deleted races after
  -- TRUNCATE. The season sweeps get higher ids than the race items, so they
  -- run after the races are rebuilt and only clean up what races cannot reach
  -- (summary rows without any contribution).
  IF v_rebuild_from IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.ranking_dirty_log(kind,race_id)
        SELECT 'race',id FROM public.races
        UNION SELECT 'race',race_id FROM public.ranking_race_contrib
        UNION SELECT 'race',race_id FROM public.ranking_team_race_points
      RETURNING id
    ) SELECT max(id) INTO v_rebuild_through FROM ins;
    WITH ins AS (
      INSERT INTO public.ranking_dirty_log(kind,season_id)
        SELECT 'season',season_id FROM public.ranking_rider_season
        UNION SELECT 'season',season_id FROM public.ranking_youth_rider_season
        UNION SELECT 'season',season_id FROM public.ranking_team_season_ext
      RETURNING id
    ) SELECT max(id) INTO v_expanded FROM ins;
    v_rebuild_through:=greatest(v_rebuild_through,v_expanded);
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
  -- P2: a season sweep recomputes every summary key of its one season from
  -- contrib. Keys without contributions are deleted and not re-inserted.
  IF v_seasons>0 THEN
    INSERT INTO pg_temp.ranking_rider_keys
      SELECT s.season_id,s.rider_id FROM public.ranking_rider_season s
        WHERE EXISTS(SELECT 1 FROM pg_temp.ranking_batch b
          WHERE b.kind='season' AND b.season_id IS NOT DISTINCT FROM s.season_id)
      UNION SELECT s.season_id,s.rider_id FROM public.ranking_youth_rider_season s
        WHERE EXISTS(SELECT 1 FROM pg_temp.ranking_batch b
          WHERE b.kind='season' AND b.season_id IS NOT DISTINCT FROM s.season_id)
      EXCEPT SELECT * FROM pg_temp.ranking_rider_keys;
    INSERT INTO pg_temp.ranking_team_keys
      SELECT s.season_id,s.team_id FROM public.ranking_team_season_ext s
        WHERE EXISTS(SELECT 1 FROM pg_temp.ranking_batch b
          WHERE b.kind='season' AND b.season_id IS NOT DISTINCT FROM s.season_id)
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
  -- P1: ids travel as text (bigint exceeds JSON-safe integers). next_id is the
  -- queue head after this batch; rebuild_from/rebuild_through say which marker
  -- this batch expanded and how far its durable work reaches, so a leased pass
  -- can treat that work as part of the version that queued the marker.
  SELECT min(id) INTO v_expanded FROM public.ranking_dirty_log;
  RETURN jsonb_build_object('processed',v_count,'races',cardinality(v_races),
    'rider_races',cardinality(v_rider_races),'seasons',v_seasons,
    'pending',v_expanded IS NOT NULL,'next_id',v_expanded::text,
    'rebuild_from',v_rebuild_from::text,'rebuild_through',v_rebuild_through::text);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ranking_deltas(integer,uuid,bigint,boolean) TO service_role;

-- Same signature as M1.5 (replaced in place, no new overload). max_id (text,
-- NULL on an empty queue) is the P1 version watermark: the coordinator reads it
-- after claiming its version, so every item committed with that version has an
-- id at or below it.
DROP FUNCTION IF EXISTS public.get_ranking_shadow_metrics();
CREATE OR REPLACE FUNCTION public.get_ranking_shadow_metrics(p_now timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('queue_length',count(*),
    'oldest_age_s',CASE WHEN min(enqueued_at) IS NULL THEN NULL
      ELSE greatest(0,floor(extract(epoch FROM coalesce(p_now,clock_timestamp())-min(enqueued_at))))::bigint END,
    'max_id',max(id)::text)
  FROM public.ranking_dirty_log;
$$;
REVOKE ALL ON FUNCTION public.get_ranking_shadow_metrics(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_shadow_metrics(timestamptz) TO service_role;

-- Verify inside the transaction: any failure rolls the whole file back.
DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='ranking_dirty_log' AND column_name='season_id') THEN
    RAISE EXCEPTION '6765 verify: ranking_dirty_log.season_id missing';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ranking_dirty_log'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%'
      AND pg_get_constraintdef(oid) NOT LIKE '%season%') THEN
    RAISE EXCEPTION '6765 verify: a kind check still rejects season items';
  END IF;
  IF position('rebuild_through' IN pg_get_functiondef(
      'public.apply_ranking_deltas(integer,uuid,bigint,boolean)'::regprocedure))=0 THEN
    RAISE EXCEPTION '6765 verify: apply_ranking_deltas is not the P1/P2 version';
  END IF;
  IF NOT (public.get_ranking_shadow_metrics() ? 'max_id') THEN
    RAISE EXCEPTION '6765 verify: get_ranking_shadow_metrics lacks max_id';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='apply_ranking_deltas')<>1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='get_ranking_shadow_metrics')<>1 THEN
    RAISE EXCEPTION '6765 verify: ambiguous shadow function overloads';
  END IF;
END
$verify$;
COMMIT;
NOTIFY pgrst,'reload schema';
