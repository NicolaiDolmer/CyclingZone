-- Refs #6129 (#6061). Forward migration: slim, read-only source check for the
-- historical training compensation writer. Requires the objects from
-- database/proposals/2026-10-03-6061-apply-compensation.sql (already in prod as
-- migration 6061_apply_training_compensation). Idempotent: CREATE OR REPLACE only.
--
-- Why: the first writer compared whole rows (incl. presence/UI columns such as
-- users.last_seen and teams.*_dismissed_at) and received the full 16 MB plan
-- file, which built jsonb_agg over 23 tables inside the RPC. Now one read-only
-- function hashes explicit, relevant columns per table. Both the calculator
-- (capture, before and after) and the writer call it, so the comparison is the
-- same on both sides, and the writer payload carries only plans + hashes.
--
-- Race evidence is bounded to the closed cutoff (p_through, Copenhagen date of
-- the scheduled stage / the cutoff's last game day), so stages ridden after the
-- cutoff do not fail the check, while new rows for compensated slots still do.

CREATE OR REPLACE FUNCTION public.training_compensation_6061_source_hashes(
 p_rider_ids uuid[],p_team_ids uuid[],p_season_ids uuid[],p_through date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
SET "TimeZone"='UTC'
SET "DateStyle"='ISO, YMD'
SET "IntervalStyle"='postgres'
SET extra_float_digits=1
AS $fn$
DECLARE q record;digest text;result jsonb:='{}'::jsonb;
BEGIN
 IF p_rider_ids IS NULL OR p_team_ids IS NULL OR p_season_ids IS NULL OR p_through IS NULL THEN
  RAISE EXCEPTION 'Complete compensation source scope required';
 END IF;
 -- $1 riders, $2 teams, $3 seasons, $4 closed cutoff date.
 -- Each row is reduced to md5(row text) before aggregation, so memory stays
 -- proportional to row count, not to row width (entrant snapshots, JSON).
 FOR q IN SELECT * FROM (VALUES
  ('teams',$q$SELECT t.id,t.user_id FROM public.teams t WHERE t.id=ANY($2)$q$),
  ('users',$q$SELECT u.id,u.role,u.is_beta_tester FROM public.users u WHERE u.id IN(SELECT t.user_id FROM public.teams t WHERE t.id=ANY($2))$q$),
  ('app_config',$q$SELECT c.key,c.value FROM public.app_config c WHERE c.key=ANY(ARRAY['training_condition_per_date','training_tick_per_race_day','race_day_development_enabled','race_day_engine_enabled','training_programs','training_program_cells','training_fatigue_rules','training_groups'])$q$),
  ('riders',$q$SELECT r.id,r.team_id,r.is_retired,r.is_academy,r.birthdate,r.potentiale,r.primary_type,r.secondary_type FROM public.riders r WHERE r.id=ANY($1)$q$),
  ('seasons',$q$SELECT s.id,s.number FROM public.seasons s WHERE s.id=ANY($3)$q$),
  ('training_race_loads',$q$SELECT l.rider_id,l.race_id,l.stage_number,l.season_id,l.game_day,l.tick_date,l.load,l.consumed_at,l.reconciliation_required,l.duplicate_of_race_id,l.duplicate_of_stage_number FROM public.training_race_loads l WHERE l.rider_id=ANY($1) AND (l.tick_date IS NULL OR l.tick_date<=$4)$q$),
  ('training_rider_ticks',$q$SELECT k.rider_id,k.season_id,k.game_day,k.tick_date,k.team_id FROM public.training_rider_ticks k WHERE k.rider_id=ANY($1)$q$),
  ('training_condition_settlements',$q$SELECT s.rider_id,s.season_id,s.tick_date,s.team_id,s.status,s.opening_condition,s.applied_condition,s.missing_evidence FROM public.training_condition_settlements s WHERE s.rider_id=ANY($1)$q$),
  ('training_date_work',$q$SELECT w.team_id,w.season_id,w.tick_date,w.game_days,w.expected_rider_ids,w.status,w.missing_evidence,w.opening_conditions,w.quarantined_rider_ids,w.quarantine_evidence FROM public.training_date_work w WHERE w.tick_date<=$4 AND (w.team_id=ANY($2) OR w.quarantined_rider_ids&&$1)$q$),
  ('training_plans',$q$SELECT p.id,p.team_id,p.rider_id,p.season_id,p.focus,p.intensity FROM public.training_plans p WHERE p.team_id=ANY($2)$q$),
  ('training_week_plans',$q$SELECT p.id,p.team_id,p.rider_id,p.days,p.program_key FROM public.training_week_plans p WHERE p.team_id=ANY($2)$q$),
  ('team_training_rules',$q$SELECT r.id,r.team_id,r.rider_id,r.fatigue_threshold,r.fallback,r.recovery_after_stage FROM public.team_training_rules r WHERE r.team_id=ANY($2)$q$),
  ('training_groups',$q$SELECT g.id,g.team_id,g.days,g.program_key,g.fatigue_threshold,g.fallback FROM public.training_groups g WHERE g.team_id=ANY($2)$q$),
  ('training_group_members',$q$SELECT m.rider_id,m.group_id,m.team_id,m.follows_group FROM public.training_group_members m WHERE m.team_id=ANY($2)$q$),
  ('team_facilities',$q$SELECT f.id,f.team_id,f.track,f.tier FROM public.team_facilities f WHERE f.team_id=ANY($2)$q$),
  ('team_staff',$q$SELECT s.id,s.team_id,s.role,s.name,s.tier,s.status FROM public.team_staff s WHERE s.team_id=ANY($2)$q$),
  ('staff_derived_abilities',$q$SELECT a.staff_id,a.overall,a.dimensions,a.levels FROM public.staff_derived_abilities a WHERE a.staff_id IN(SELECT s.id FROM public.team_staff s WHERE s.team_id=ANY($2))$q$),
  ('races',$q$SELECT r.id,r.season_id,r.race_type,COALESCE(r.stages_completed,0)>0 AS started FROM public.races r WHERE r.season_id=ANY($3) AND EXISTS(SELECT 1 FROM public.race_stage_schedule s WHERE s.race_id=r.id AND (s.scheduled_at IS NULL OR (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date<=$4))$q$),
  ('race_stage_schedule',$q$SELECT s.race_id,s.stage_number,s.game_day,s.scheduled_at FROM public.race_stage_schedule s JOIN public.races r ON r.id=s.race_id WHERE r.season_id=ANY($3) AND (s.scheduled_at IS NULL OR (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date<=$4)$q$),
  ('race_stage_profiles',$q$SELECT p.id,p.race_id,p.stage_number,p.profile_type FROM public.race_stage_profiles p JOIN public.races r ON r.id=p.race_id WHERE r.season_id=ANY($3) AND EXISTS(SELECT 1 FROM public.race_stage_schedule s WHERE s.race_id=p.race_id AND s.stage_number=p.stage_number AND (s.scheduled_at IS NULL OR (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date<=$4))$q$),
  ('race_simulation_runs',$q$SELECT x.id,x.race_id,x.stage_number,x.entrant_snapshot FROM public.race_simulation_runs x JOIN public.races r ON r.id=x.race_id WHERE x.stage_number=1 AND r.season_id=ANY($3) AND EXISTS(SELECT 1 FROM public.race_stage_schedule s WHERE s.race_id=x.race_id AND s.stage_number=1 AND (s.scheduled_at IS NULL OR (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date<=$4))$q$),
  ('race_results',$q$SELECT rr.id,rr.race_id,rr.stage_number,rr.rider_id,rr.result_type FROM public.race_results rr JOIN public.races r ON r.id=rr.race_id WHERE rr.rider_id=ANY($1) AND r.season_id=ANY($3) AND (rr.result_type='stage' OR (r.race_type='single' AND rr.result_type='gc')) AND NOT EXISTS(SELECT 1 FROM public.race_stage_schedule s WHERE s.race_id=rr.race_id AND s.stage_number=rr.stage_number AND (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date>$4)$q$),
  ('race_entry_days',$q$SELECT e.race_id,e.rider_id,e.season_id,e.game_day,e.team_id FROM public.race_entry_days e WHERE e.rider_id=ANY($1) AND e.season_id=ANY($3) AND e.game_day<=(SELECT max(g) FROM public.training_date_work w CROSS JOIN LATERAL unnest(w.game_days) g WHERE w.season_id=e.season_id AND w.tick_date<=$4 AND w.team_id=ANY($2))$q$)
 ) v(tbl,query) LOOP
  EXECUTE format('SELECT encode(sha256(convert_to(COALESCE(string_agg(md5(x::text),'','' ORDER BY md5(x::text) COLLATE "C"),''''),''UTF8'')),''hex'') FROM (%s) x',q.query)
   INTO digest USING p_rider_ids,p_team_ids,p_season_ids,p_through;
  result:=result||jsonb_build_object(q.tbl,digest);
 END LOOP;
 RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.training_compensation_6061_source_hashes(uuid[],uuid[],uuid[],date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_compensation_6061_source_hashes(uuid[],uuid[],uuid[],date) TO service_role;

-- Same signature as the 3/10 writer. The payload is the slim apply file
-- (plans + scope + per-table hashes); raw source rows never reach the RPC.
CREATE OR REPLACE FUNCTION public.apply_training_compensation_6061(
 p_plan_text text,p_approved_hash text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb;item jsonb;day jsonb;current_rider public.riders%ROWTYPE;
 actual jsonb;before_condition jsonb;assignments text;field text;expected integer;lock_table text;changed text;
 scope_riders uuid[];scope_teams uuid[];scope_seasons uuid[];
 required_tables text[]:=ARRAY['app_config','race_entry_days','race_results','race_simulation_runs','race_stage_profiles','race_stage_schedule','races','riders','seasons','staff_derived_abilities','team_facilities','team_staff','team_training_rules','teams','training_condition_settlements','training_date_work','training_group_members','training_groups','training_plans','training_race_loads','training_rider_ticks','training_week_plans','users'];
 existing_count integer;affected integer;written integer:=0;initialized integer:=0;
BEGIN
 SET LOCAL lock_timeout='5s';
 IF p_plan_text IS NULL OR octet_length(p_plan_text)>2097152 THEN RAISE EXCEPTION 'Slim compensation payload required'; END IF;
 IF encode(sha256(convert_to(p_plan_text,'UTF8')),'hex') IS DISTINCT FROM p_approved_hash THEN
  RAISE EXCEPTION 'Approved file hash mismatch';
 END IF;
 plan:=p_plan_text::jsonb;
 IF plan->>'policy' IS DISTINCT FROM 'current_plans_current_engine' OR (plan->>'issue')::integer IS DISTINCT FROM 6061
   OR jsonb_typeof(plan->'plans') IS DISTINCT FROM 'array' OR p_now IS NULL THEN
  RAISE EXCEPTION 'Verified compensation plan required';
 END IF;
 IF plan ? 'source_checks' THEN RAISE EXCEPTION 'Slim compensation payload required'; END IF;
 IF (plan->>'through')::date IS NULL OR (plan->>'through')::date >= (p_now AT TIME ZONE 'Europe/Copenhagen')::date THEN RAISE EXCEPTION 'Closed compensation cutoff required'; END IF;
 IF (SELECT count(DISTINCT p->>'rider_id') FROM jsonb_array_elements(plan->'plans')p)<>jsonb_array_length(plan->'plans') THEN RAISE EXCEPTION 'One compensation plan per rider required'; END IF;
 IF extract(hour FROM (p_now AT TIME ZONE 'Europe/Copenhagen'))>=17 AND EXISTS(SELECT 1 FROM public.training_date_work WHERE tick_date=(p_now AT TIME ZONE 'Europe/Copenhagen')::date AND status IN('pending','partial')) THEN RAISE EXCEPTION 'Wait for current date close before compensation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_condition_per_date' AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb))
  OR NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_tick_per_race_day' AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN
  RAISE EXCEPTION 'Normalized training ownership required';
 END IF;
 SELECT count(*) INTO expected FROM jsonb_array_elements(plan->'plans') p CROSS JOIN LATERAL jsonb_array_elements(p->'days') d;
 IF expected IS DISTINCT FROM (plan->'summary'->>'rider_days')::integer OR expected=0 THEN RAISE EXCEPTION 'Exact rider-day count required'; END IF;
 IF (SELECT count(DISTINCT (p->>'rider_id')||':'||(p->>'season_id')||':'||(d->>'gameDay')) FROM jsonb_array_elements(plan->'plans')p CROSS JOIN LATERAL jsonb_array_elements(p->'days')d)<>expected THEN RAISE EXCEPTION 'Duplicate compensation slot'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('training-compensation:6061',0));
 SELECT count(*) INTO existing_count FROM public.training_compensation_receipts c
 JOIN jsonb_array_elements(plan->'plans')p ON c.rider_id=(p->>'rider_id')::uuid AND c.season_id=(p->>'season_id')::uuid
 JOIN LATERAL jsonb_array_elements(p->'days')d ON c.game_day=(d->>'gameDay')::integer;
 IF existing_count=expected AND NOT EXISTS(SELECT 1 FROM public.training_compensation_receipts c
  JOIN jsonb_array_elements(plan->'plans')p ON c.rider_id=(p->>'rider_id')::uuid AND c.season_id=(p->>'season_id')::uuid
  JOIN LATERAL jsonb_array_elements(p->'days')d ON c.game_day=(d->>'gameDay')::integer WHERE c.plan_hash<>p_approved_hash) THEN
  RETURN jsonb_build_object('already_applied',true,'rider_days',expected);
 END IF;
 IF existing_count>0 THEN RAISE EXCEPTION 'Partial or conflicting prior compensation'; END IF;
 -- Scope and hashes must be complete, and the scope must cover every plan.
 IF jsonb_typeof(plan->'source_hashes') IS DISTINCT FROM 'object'
   OR (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(plan->'source_hashes')k) IS DISTINCT FROM (SELECT array_agg(t ORDER BY t COLLATE "C") FROM unnest(required_tables)t) THEN
  RAISE EXCEPTION 'Complete source hashes required';
 END IF;
 IF jsonb_typeof(plan->'source_scope'->'rider_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(plan->'source_scope'->'team_ids') IS DISTINCT FROM 'array'
   OR jsonb_typeof(plan->'source_scope'->'season_ids') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Complete source scope required';
 END IF;
 scope_riders:=ARRAY(SELECT jsonb_array_elements_text(plan->'source_scope'->'rider_ids')::uuid);
 scope_teams:=ARRAY(SELECT jsonb_array_elements_text(plan->'source_scope'->'team_ids')::uuid);
 scope_seasons:=ARRAY(SELECT jsonb_array_elements_text(plan->'source_scope'->'season_ids')::uuid);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'plans')p WHERE NOT((p->>'rider_id')::uuid=ANY(scope_riders)) OR NOT((p->>'team_id')::uuid=ANY(scope_teams)) OR NOT((p->>'season_id')::uuid=ANY(scope_seasons))) THEN
  RAISE EXCEPTION 'Compensation plan outside source scope';
 END IF;
 -- Brief one-off table locks also cover inserts into previously empty evidence
 -- sets. Any lock conflict aborts this transaction; it never permits stale credit.
 FOREACH lock_table IN ARRAY required_tables LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',lock_table);
 END LOOP;
 actual:=public.training_compensation_6061_source_hashes(scope_riders,scope_teams,scope_seasons,(plan->>'through')::date);
 IF actual IS DISTINCT FROM plan->'source_hashes' THEN
  SELECT string_agg(t,',' ORDER BY t) INTO changed FROM unnest(required_tables)t WHERE actual->>t IS DISTINCT FROM plan->'source_hashes'->>t;
  RAISE EXCEPTION 'Compensation source changed (%); repeat dry-run',COALESCE(changed,'unknown');
 END IF;
 -- Ordered team locks share the normalized writer's serialization boundary.
 FOR item IN SELECT p FROM jsonb_array_elements(plan->'plans')p ORDER BY p->>'team_id',p->>'rider_id' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||(item->>'team_id'),0));
 END LOOP;
 PERFORM id FROM public.riders WHERE id IN(SELECT (p->>'rider_id')::uuid FROM jsonb_array_elements(plan->'plans')p) ORDER BY id FOR UPDATE;
 PERFORM rider_id FROM public.rider_derived_abilities WHERE rider_id IN(SELECT (p->>'rider_id')::uuid FROM jsonb_array_elements(plan->'plans')p) ORDER BY rider_id FOR UPDATE;
 PERFORM rider_id FROM public.rider_condition WHERE rider_id IN(SELECT (p->>'rider_id')::uuid FROM jsonb_array_elements(plan->'plans')p) ORDER BY rider_id FOR UPDATE;
 -- Validate the entire batch before changing any abilities or first-use state.
 FOR item IN SELECT p FROM jsonb_array_elements(plan->'plans')p LOOP
  SELECT * INTO STRICT current_rider FROM public.riders WHERE id=(item->>'rider_id')::uuid;
  IF current_rider.team_id IS DISTINCT FROM (item->>'team_id')::uuid OR current_rider.is_retired IS TRUE THEN RAISE EXCEPTION 'Rider ownership changed'; END IF;
  SELECT to_jsonb(a) INTO STRICT actual FROM public.rider_derived_abilities a WHERE rider_id=current_rider.id;
  IF actual IS DISTINCT FROM item->'expected_abilities' THEN RAISE EXCEPTION 'Current abilities changed; repeat dry-run'; END IF;
  SELECT to_jsonb(c) INTO before_condition FROM public.rider_condition c WHERE rider_id=current_rider.id;
  before_condition:=COALESCE(before_condition,'null'::jsonb);
  IF before_condition IS DISTINCT FROM COALESCE(item->'current_condition','null'::jsonb) THEN RAISE EXCEPTION 'Current condition or injury changed'; END IF;
  FOR day IN SELECT d FROM jsonb_array_elements(item->'days')d LOOP
   IF EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=current_rider.id AND t.season_id=(item->>'season_id')::uuid AND t.game_day=(day->>'gameDay')::integer) THEN RAISE EXCEPTION 'Slot already trained'; END IF;
   IF (day->>'tickDate')::date IS NULL OR (day->>'tickDate')::date>(plan->>'through')::date THEN RAISE EXCEPTION 'Slot outside approved cutoff'; END IF;
  END LOOP;
  IF jsonb_typeof(item->'patch') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Compensation patch required'; END IF;
  FOR field IN SELECT jsonb_object_keys(item->'patch') LOOP
   IF field NOT IN('flat','climbing','punch','time_trial','aggression','cobblestone','sprint','acceleration','descending','endurance','durability','tempo','recovery','positioning','tactics','teamwork','leadership','ability_progress') THEN RAISE EXCEPTION 'Unsupported compensation field'; END IF;
   IF field<>'ability_progress' AND (jsonb_typeof(item->'patch'->field) IS DISTINCT FROM 'number' OR (item->'patch'->>field)::numeric<>trunc((item->'patch'->>field)::numeric) OR (item->'patch'->>field)::numeric NOT BETWEEN 0 AND 99 OR (item->'patch'->>field)::numeric<COALESCE((actual->>field)::numeric,0)) THEN RAISE EXCEPTION 'Compensation cannot reduce or corrupt visible ability'; END IF;
   IF field='ability_progress' AND jsonb_typeof(item->'patch'->field) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Progress object required'; END IF;
  END LOOP;
 END LOOP;
 FOR item IN SELECT p FROM jsonb_array_elements(plan->'plans')p LOOP
  SELECT string_agg(format('%I=v.%I',f,f),',') INTO assignments FROM jsonb_object_keys(item->'patch')f;
  IF assignments IS NOT NULL THEN
   EXECUTE format('UPDATE public.rider_derived_abilities a SET %s FROM jsonb_populate_record(NULL::public.rider_derived_abilities,$1)v WHERE a.rider_id=$2',assignments)
    USING item->'patch',(item->>'rider_id')::uuid;
   GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'Ability write changed'; END IF;
  END IF;
  -- Existing condition/injury is never rewritten. Missing first-use state is
  -- materialized only where the source has no applied activity history at all.
  IF item->'current_condition'='null'::jsonb OR NOT(item ? 'current_condition') THEN
   IF EXISTS(SELECT 1 FROM public.training_rider_ticks WHERE rider_id=(item->>'rider_id')::uuid)
    OR EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=(item->>'rider_id')::uuid)
    OR EXISTS(SELECT 1 FROM public.training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',item->>'rider_id'))) THEN
    RAISE EXCEPTION 'Missing state has applied history; administrative review required';
   END IF;
   INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at) VALUES((item->>'rider_id')::uuid,50,0,p_now);
   initialized:=initialized+1;
   -- Only the current date can resume from this first-use default. Historical
   -- quarantines remain historical evidence, not fabricated settlements.
   UPDATE public.training_date_work w SET
    opening_conditions=jsonb_set(COALESCE(w.opening_conditions,'{}'),ARRAY[item->>'rider_id'],(SELECT to_jsonb(c) FROM public.rider_condition c WHERE c.rider_id=(item->>'rider_id')::uuid)),
    quarantined_rider_ids=array_remove(w.quarantined_rider_ids,(item->>'rider_id')::uuid),
    quarantine_evidence=COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(w.quarantine_evidence)e WHERE e->>'rider_id'<>item->>'rider_id'),'[]'),
    status='pending',updated_at=p_now
   WHERE w.team_id=(item->>'team_id')::uuid AND w.season_id=(item->>'season_id')::uuid
    AND w.tick_date=(p_now AT TIME ZONE 'Europe/Copenhagen')::date
    AND (item->>'rider_id')::uuid=ANY(w.expected_rider_ids)
    AND NOT(w.opening_conditions?(item->>'rider_id'))
    AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=(item->>'rider_id')::uuid AND t.tick_date=w.tick_date);
  END IF;
  FOR day IN SELECT d FROM jsonb_array_elements(item->'days')d LOOP
   INSERT INTO public.training_compensation_receipts(rider_id,season_id,game_day,tick_date,team_id,plan_hash,payload,applied_at)
    VALUES((item->>'rider_id')::uuid,(item->>'season_id')::uuid,(day->>'gameDay')::integer,(day->>'tickDate')::date,(item->>'team_id')::uuid,p_approved_hash,day,p_now);
   written:=written+1;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('already_applied',false,'rider_days',written,'initialized_conditions',initialized);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_training_compensation_6061(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_training_compensation_6061(text,text,timestamptz) TO service_role;
