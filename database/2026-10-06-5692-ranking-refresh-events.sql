-- Refs #5692. Transactional events, cross-process claims and fenced completion.
-- SSOT: docs/GAME_INVARIANTS.md. Existing ranking values/definitions stay intact.
-- data-api-access: {"table":"public.ranking_refresh_work_state","reason":"Backend ranking coordinator only","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE"]}}
BEGIN;

CREATE TABLE IF NOT EXISTS public.ranking_refresh_work_state (
  matview_group text PRIMARY KEY CHECK (matview_group = 'ranking'),
  requested_version bigint NOT NULL DEFAULT 0 CHECK (requested_version >= 0),
  completed_version bigint NOT NULL DEFAULT 0 CHECK (completed_version >= 0 AND completed_version <= requested_version),
  dirty_since timestamptz,
  lease_token uuid,
  leased_version bigint,
  lease_expires_at timestamptz,
  last_completed_at timestamptz,
  CHECK (requested_version=completed_version OR dirty_since IS NOT NULL),
  CHECK (completed_version=0 OR last_completed_at IS NOT NULL),
  CHECK ((lease_token IS NULL AND leased_version IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND leased_version IS NOT NULL AND lease_expires_at IS NOT NULL))
);
ALTER TABLE public.ranking_refresh_work_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ranking_refresh_work_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.ranking_refresh_work_state TO service_role;
INSERT INTO public.ranking_refresh_work_state(matview_group,requested_version,completed_version,dirty_since)
VALUES('ranking',1,0,clock_timestamp()) ON CONFLICT(matview_group) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_ranking_refresh_work_state(p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('requested_version',requested_version::text,'completed_version',completed_version::text,
    'pending',requested_version>completed_version,'pending_since',dirty_since,
    'pending_age_ms',greatest(0,extract(epoch FROM (p_now-dirty_since))*1000),
    'active',lease_token IS NOT NULL AND lease_expires_at>p_now,'last_completed_at',last_completed_at)
  FROM public.ranking_refresh_work_state WHERE matview_group='ranking';
$$;
REVOKE ALL ON FUNCTION public.get_ranking_refresh_work_state(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_refresh_work_state(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ranking_refresh_work(p_token uuid,p_force boolean DEFAULT false,p_now timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.ranking_refresh_work_state%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'Claim identity required' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.ranking_refresh_work_state WHERE matview_group='ranking' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ranking coordinator unavailable' USING ERRCODE='55000'; END IF;
  v_now:=coalesce(p_now,clock_timestamp());
  IF p_force IS TRUE THEN
    UPDATE public.ranking_refresh_work_state SET requested_version=requested_version+1,
      dirty_since=coalesce(dirty_since,v_now) WHERE matview_group='ranking' RETURNING * INTO s;
  END IF;
  IF s.requested_version=s.completed_version THEN RETURN jsonb_build_object('status','clean'); END IF;
  IF s.lease_token IS NOT NULL AND s.lease_expires_at>v_now THEN RETURN jsonb_build_object('status','busy'); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cz-ranking-refresh',0)) THEN RETURN jsonb_build_object('status','busy'); END IF;
  UPDATE public.ranking_refresh_work_state SET lease_token=p_token,leased_version=requested_version,
    lease_expires_at=v_now+interval '90 seconds' WHERE matview_group='ranking' RETURNING * INTO s;
  RETURN jsonb_build_object('status','claimed','token',p_token,'target_version',s.leased_version::text);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ranking_refresh_work(uuid,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ranking_refresh_work(uuid,boolean,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.renew_ranking_refresh_work(p_token uuid,p_now timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.ranking_refresh_work_state%ROWTYPE; v_now timestamptz;
BEGIN
  SELECT * INTO s FROM public.ranking_refresh_work_state WHERE matview_group='ranking' FOR UPDATE;
  v_now:=coalesce(p_now,clock_timestamp());
  IF NOT FOUND OR s.lease_token IS DISTINCT FROM p_token OR s.lease_expires_at<=v_now THEN RETURN false; END IF;
  UPDATE public.ranking_refresh_work_state SET lease_expires_at=v_now+interval '90 seconds' WHERE matview_group='ranking';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.renew_ranking_refresh_work(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renew_ranking_refresh_work(uuid,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_ranking_refresh_work(p_token uuid,p_target_version bigint,p_success boolean,p_now timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.ranking_refresh_work_state%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_token IS NULL OR p_target_version IS NULL THEN RETURN false; END IF;
  SELECT * INTO s FROM public.ranking_refresh_work_state WHERE matview_group='ranking' FOR UPDATE;
  v_now:=coalesce(p_now,clock_timestamp());
  IF NOT FOUND OR s.lease_token IS DISTINCT FROM p_token OR s.leased_version IS DISTINCT FROM p_target_version THEN RETURN false; END IF;
  IF p_success IS TRUE AND s.lease_expires_at<=v_now THEN RETURN false; END IF;
  IF p_success IS TRUE THEN
    UPDATE public.ranking_refresh_work_state SET completed_version=p_target_version,
      dirty_since=CASE WHEN requested_version=p_target_version THEN NULL ELSE dirty_since END,
      last_completed_at=v_now,lease_token=NULL,leased_version=NULL,lease_expires_at=NULL WHERE matview_group='ranking';
    INSERT INTO public.matview_refresh_heartbeat(matview_group,refreshed_at) VALUES('ranking',v_now)
    ON CONFLICT(matview_group) DO UPDATE SET refreshed_at=excluded.refreshed_at;
  ELSE
    UPDATE public.ranking_refresh_work_state SET lease_token=NULL,leased_version=NULL,lease_expires_at=NULL WHERE matview_group='ranking';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_ranking_refresh_work(uuid,bigint,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ranking_refresh_work(uuid,bigint,boolean,timestamptz) TO service_role;

-- Statement transition tables avoid a counter update per result/rytter. UPDATE
-- compares only ranking projections; training ratings/unchanged writes stay clean.
CREATE OR REPLACE FUNCTION public.mark_ranking_refresh_dirty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed boolean; columns_sql text;
BEGIN
  IF TG_OP='INSERT' THEN EXECUTE 'SELECT EXISTS(SELECT 1 FROM new_rows)' INTO changed;
  ELSIF TG_OP='DELETE' THEN EXECUTE 'SELECT EXISTS(SELECT 1 FROM old_rows)' INTO changed;
  ELSIF TG_OP='UPDATE' THEN
    SELECT string_agg(format('%I',column_name),',') INTO columns_sql FROM unnest(string_to_array(TG_ARGV[0],',')) column_name;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM (SELECT %s FROM new_rows EXCEPT ALL SELECT %s FROM old_rows) changed)',columns_sql,columns_sql) INTO changed;
  ELSE changed:=true;
  END IF;
  IF changed THEN
    UPDATE public.ranking_refresh_work_state SET requested_version=requested_version+1,
      dirty_since=coalesce(dirty_since,statement_timestamp()) WHERE matview_group='ranking';
    IF NOT FOUND THEN RAISE EXCEPTION 'Ranking coordinator unavailable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_ranking_refresh_dirty() FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE source record; event text; trigger_name text;
BEGIN
  FOR source IN SELECT * FROM (VALUES
    ('race_results','race_id,rider_id,team_id,points_earned,prize_money,rank,result_type'),
    ('races','id,season_id,squad,race_type,name'),('riders','id,team_id'),
    ('season_standings','season_id,team_id,total_points'),('seasons','id,status,number'),
    ('teams','id,name,division,is_ai,is_test_account,is_frozen,is_bank'),
    ('team_global_rank_points','team_id,banked_points')) AS sources(table_name,columns) LOOP
    FOREACH event IN ARRAY ARRAY['insert','update','delete','truncate'] LOOP
      trigger_name:='ranking_dirty_'||event;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',trigger_name,source.table_name);
      EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I %s FOR EACH STATEMENT EXECUTE FUNCTION public.mark_ranking_refresh_dirty(%L)',
        trigger_name,event,source.table_name,
        CASE event WHEN 'insert' THEN 'REFERENCING NEW TABLE AS new_rows' WHEN 'delete' THEN 'REFERENCING OLD TABLE AS old_rows'
          WHEN 'update' THEN 'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows' ELSE '' END,source.columns);
    END LOOP;
  END LOOP;
END;
$$;

-- All active refresh writers share one short-lived DB writer lock. Old owners
-- whose HTTP response outlives a lease cannot overlap another expensive query.
DO $$
DECLARE view_name text; definition text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY['rider_rankings_mv','team_standings_ext_mv','team_race_points_mv','global_rank_mv','youth_rider_rankings_mv'] LOOP
    definition:=format($f$CREATE OR REPLACE FUNCTION public.refresh_%I(p_concurrently boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$ BEGIN
      IF p_concurrently IS DISTINCT FROM true THEN RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE='22023'; END IF;
      IF NOT pg_try_advisory_xact_lock(hashtextextended('cz-ranking-refresh',0)) THEN
        RAISE EXCEPTION 'Ranking refresh writer busy' USING ERRCODE='55P03'; END IF;
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I; END; $body$;$f$,view_name,view_name);
    EXECUTE definition;
    -- Token/version validation and expensive execution occur under the same
    -- writer lock. Production takes DB time here; p_now is a deterministic seam.
    definition:=format($f$CREATE OR REPLACE FUNCTION public.refresh_%I(p_concurrently boolean,p_owner_token uuid,p_target_version bigint,p_now timestamptz DEFAULT NULL)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $body$
      DECLARE v_now timestamptz;
      BEGIN
        IF p_concurrently IS DISTINCT FROM true THEN RAISE EXCEPTION 'Concurrent refresh is required' USING ERRCODE='22023'; END IF;
        IF NOT pg_try_advisory_xact_lock(hashtextextended('cz-ranking-refresh',0)) THEN
          RAISE EXCEPTION 'Ranking refresh writer busy' USING ERRCODE='55P03'; END IF;
        v_now:=coalesce(p_now,clock_timestamp());
        IF NOT EXISTS(SELECT 1 FROM public.ranking_refresh_work_state WHERE matview_group='ranking'
          AND lease_token=p_owner_token AND leased_version=p_target_version AND lease_expires_at>v_now) THEN
          RAISE EXCEPTION 'Ranking refresh claim lost' USING ERRCODE='55000'; END IF;
        PERFORM public.refresh_%I(p_concurrently);
      END; $body$;$f$,view_name,view_name);
    EXECUTE definition;
  END LOOP;
  -- Preserve rollover mutation and its immediate season-start snapshot, changing
  -- only the publication transport/coordination. Never retry the mutation blindly.
  SELECT pg_get_functiondef('public.apply_global_rank_season_rollover(uuid)'::regprocedure) INTO definition;
  IF position('REFRESH MATERIALIZED VIEW public.global_rank_mv;' IN definition)>0 THEN
    definition:=replace(definition,'REFRESH MATERIALIZED VIEW public.global_rank_mv;',
      'PERFORM pg_advisory_xact_lock(hashtextextended(''cz-ranking-refresh'',0)); REFRESH MATERIALIZED VIEW CONCURRENTLY public.global_rank_mv;');
    EXECUTE definition;
  ELSIF position('REFRESH MATERIALIZED VIEW CONCURRENTLY public.global_rank_mv;' IN definition)=0
    OR position('pg_advisory_xact_lock(hashtextextended(''cz-ranking-refresh'',0))' IN definition)=0 THEN
    RAISE EXCEPTION 'Unrecognized rollover publication; review required' USING ERRCODE='55000';
  END IF;
END;
$$;
-- Literal privileges keep the changed-migration access audit fully auditable.
REVOKE ALL ON FUNCTION public.refresh_rider_rankings_mv(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_rider_rankings_mv(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_rider_rankings_mv(boolean,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_rider_rankings_mv(boolean,uuid,bigint,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_team_standings_ext_mv(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_standings_ext_mv(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_team_standings_ext_mv(boolean,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_standings_ext_mv(boolean,uuid,bigint,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_team_race_points_mv(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_race_points_mv(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_team_race_points_mv(boolean,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_team_race_points_mv(boolean,uuid,bigint,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_global_rank_mv(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_global_rank_mv(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_global_rank_mv(boolean,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_global_rank_mv(boolean,uuid,bigint,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean,uuid,bigint,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_youth_rider_rankings_mv(boolean,uuid,bigint,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
