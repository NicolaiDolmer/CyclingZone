-- PREPARED, NOT APPLIED. Owner-approved current-plan calculation, not prod-go.
-- Refs #6061. Separate compensation ledger: no replay of historic condition/races.
CREATE TABLE IF NOT EXISTS public.training_compensation_receipts (
 rider_id uuid NOT NULL, season_id uuid NOT NULL, game_day integer NOT NULL,
 tick_date date NOT NULL, team_id uuid NOT NULL, plan_hash text NOT NULL,
 payload jsonb NOT NULL, applied_at timestamptz NOT NULL,
 PRIMARY KEY(rider_id,season_id,game_day)
);
ALTER TABLE public.training_compensation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_compensation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.training_compensation_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.reject_compensated_training_tick() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.training_compensation_receipts c WHERE c.rider_id=NEW.rider_id AND c.season_id=NEW.season_id AND c.game_day=NEW.game_day) THEN
  RAISE EXCEPTION 'Training slot already compensated; historical retry requires reconciliation';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.reject_compensated_training_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_compensated_training_tick() TO service_role;
DROP TRIGGER IF EXISTS reject_compensated_training_tick ON public.training_rider_ticks;
CREATE TRIGGER reject_compensated_training_tick BEFORE INSERT ON public.training_rider_ticks FOR EACH ROW EXECUTE FUNCTION public.reject_compensated_training_tick();
CREATE OR REPLACE FUNCTION public.apply_training_compensation_6061(
 p_plan_text text,p_approved_hash text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE plan jsonb;item jsonb;day jsonb;current_rider public.riders%ROWTYPE;
 actual jsonb;before_condition jsonb;assignments text;field text;expected integer;check_row jsonb;allowed_key text;required_table text;
 existing_count integer;affected integer;written integer:=0;initialized integer:=0;
BEGIN
 SET LOCAL lock_timeout='5s';
 IF encode(sha256(convert_to(p_plan_text,'UTF8')),'hex') IS DISTINCT FROM p_approved_hash THEN
  RAISE EXCEPTION 'Approved file hash mismatch';
 END IF;
 plan:=p_plan_text::jsonb;
 IF plan->>'policy' IS DISTINCT FROM 'current_plans_current_engine' OR (plan->>'issue')::integer IS DISTINCT FROM 6061
   OR jsonb_typeof(plan->'plans') IS DISTINCT FROM 'array' OR p_now IS NULL THEN
  RAISE EXCEPTION 'Verified compensation plan required';
 END IF;
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
 IF jsonb_typeof(plan->'source_checks') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Complete source checks required'; END IF;
 FOREACH required_table IN ARRAY ARRAY['teams','users','app_config','riders','seasons','training_race_loads','training_rider_ticks','training_condition_settlements','training_date_work','training_plans','training_week_plans','team_training_rules','training_groups','training_group_members','team_facilities','team_staff','staff_derived_abilities','races','race_stage_schedule','race_stage_profiles','race_simulation_runs','race_results','race_entry_days'] LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(plan->'source_checks')c WHERE c->>'table'=required_table)<>1 THEN RAISE EXCEPTION 'Complete unique source checks required'; END IF;
 END LOOP;
 -- Brief one-off table locks also cover inserts into previously empty evidence
 -- sets. Any lock conflict aborts this transaction; it never permits stale credit.
 FOR check_row IN SELECT c FROM jsonb_array_elements(plan->'source_checks')c ORDER BY c->>'table' LOOP
  allowed_key:=CASE check_row->>'table'
   WHEN 'teams' THEN 'id' WHEN 'users' THEN 'id' WHEN 'riders' THEN 'id' WHEN 'seasons' THEN 'id' WHEN 'app_config' THEN 'key'
   WHEN 'training_race_loads' THEN 'rider_id' WHEN 'training_rider_ticks' THEN 'rider_id' WHEN 'training_condition_settlements' THEN 'rider_id' WHEN 'race_results' THEN 'rider_id' WHEN 'race_entry_days' THEN 'rider_id'
   WHEN 'staff_derived_abilities' THEN 'staff_id' WHEN 'races' THEN 'season_id'
   WHEN 'race_stage_schedule' THEN 'race_id' WHEN 'race_stage_profiles' THEN 'race_id' WHEN 'race_simulation_runs' THEN 'race_id'
   WHEN 'training_date_work' THEN 'team_id' WHEN 'training_plans' THEN 'team_id' WHEN 'training_week_plans' THEN 'team_id' WHEN 'team_training_rules' THEN 'team_id'
   WHEN 'training_groups' THEN 'team_id' WHEN 'training_group_members' THEN 'team_id' WHEN 'team_facilities' THEN 'team_id' WHEN 'team_staff' THEN 'team_id' END;
  IF allowed_key IS NULL OR allowed_key IS DISTINCT FROM check_row->>'key' THEN RAISE EXCEPTION 'Unsupported source check'; END IF;
  EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',check_row->>'table');
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r WHERE r.%I::text IN(SELECT jsonb_array_elements_text($1))',check_row->>'table',allowed_key) INTO actual USING check_row->'values';
  IF actual IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(e ORDER BY e::text),'[]'::jsonb) FROM jsonb_array_elements(check_row->'rows')e) THEN RAISE EXCEPTION 'Compensation source changed; repeat dry-run'; END IF;
 END LOOP;
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
   IF (day->>'tickDate')::date>(plan->>'through')::date THEN RAISE EXCEPTION 'Slot outside approved cutoff'; END IF;
  END LOOP;
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
  IF item->'current_condition'='null'::jsonb THEN
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
