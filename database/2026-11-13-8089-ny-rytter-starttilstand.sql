-- =============================================================================
-- 2026-11-13 — Ny rytter starter med fast lav træthed i stedet for 0 (#8089)
-- =============================================================================
--
-- PROBLEM: en rytter, der kommer til et hold uden en tilstand i forvejen (køb fra
-- puljen, fri agent, akademi-optag), fik form 50 og træthed 0. Med træthed 0 taber
-- en ny rytter form de første dage, selv på normal træning.
--
-- LØSNING (ejer 13/11: "fast lav træthed", form som i dag, ens for alle veje; ingen
-- bagudrettelse): de tre funktioner, der giver en ny rytter sin første tilstand,
-- skriver nu den fælles starttilstand (form som før, fast lav træthed) i stedet
-- for træthed 0.
-- Samme tal som NEW_RIDER_START_CONDITION i backend/lib/riderCondition.js.
--   1. initialize_first_use_rider_condition(): triggeren på riders. Det ene sted,
--      der giver en ny rytter sin første tilstand (alle veje sætter team_id).
--   2. register_training_date_work(): reservevejen, når holdets dato åbnes.
--   3. apply_training_compensation_6061(): administrativ genopretning.
-- Alt andet er prods aktuelle definition (= 2026-10-12-6490-rider-training-seen.sql,
-- bekræftet med pg_get_functiondef 13/11), inkl. search_path, enable_seqscan,
-- first-use-vagter, ON CONFLICT og grants.
--
-- INGEN DATA-ÆNDRING: kun funktionsdefinitioner. Eksisterende rider_condition-rækker
-- røres ikke, og der oprettes ingen tilstand for ryttere, der allerede har et hold.
-- Kolonnens standardværdi (rider_condition.fatigue DEFAULT 0) er bevidst uændret.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT; kan køres igen uden effekt.
--
-- =============================================================================
-- ROLLBACK (kør i én session):
-- ROLLBACK-BEGIN
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DO $rollback$
-- DECLARE
--   d text;
-- BEGIN
--   d := pg_get_functiondef('public.initialize_first_use_rider_condition()'::regprocedure);
--   d := replace(d, 'SELECT NEW.id,50,20,', 'SELECT NEW.id,50,0,');
--   IF d LIKE '%NEW.id,50,20,%' THEN RAISE EXCEPTION 'rollback: initialize_first_use_rider_condition not restored'; END IF;
--   EXECUTE d;
--   d := pg_get_functiondef('public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)'::regprocedure);
--   d := replace(d, 'SELECT r.id,50,20,p_registered_at', 'SELECT r.id,50,0,p_registered_at');
--   IF d LIKE '%r.id,50,20,%' THEN RAISE EXCEPTION 'rollback: register_training_date_work not restored'; END IF;
--   EXECUTE d;
--   d := pg_get_functiondef('public.apply_training_compensation_6061(text,text,timestamptz)'::regprocedure);
--   d := replace(d, '::uuid,50,20,p_now)', '::uuid,50,0,p_now)');
--   IF d LIKE '%::uuid,50,20,p_now)%' THEN RAISE EXCEPTION 'rollback: apply_training_compensation_6061 not restored'; END IF;
--   EXECUTE d;
-- END
-- $rollback$;
-- COMMIT;
-- ROLLBACK-END
-- (CREATE OR REPLACE bevarer funktionernes grants og GUC'er.)
-- =============================================================================
--
-- POST-VERIFY (read-only, efter apply): dommerens prod-efterkontrol (kun SELECT).
--   SELECT p.proname, p.proconfig, p.proacl::text,
--          p.prosrc LIKE '%50,20,%' AS new_start, p.prosrc ~ '50,0,(COALESCE|p_registered_at|p_now)' AS old_start
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('initialize_first_use_rider_condition',
--      'register_training_date_work','apply_training_compensation_6061');
--   -- forventet: new_start=t, old_start=f; initialize_first_use_rider_condition beholder
--   -- enable_seqscan=off; proacl {postgres=X/postgres,service_role=X/postgres}
-- =============================================================================

SET lock_timeout = '3s';

BEGIN;

CREATE OR REPLACE FUNCTION public.initialize_first_use_rider_condition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET enable_seqscan TO 'off'
AS $function$
BEGIN
  IF NEW.team_id IS NULL OR NEW.is_retired IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.rider_condition WHERE rider_id=NEW.id) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_condition_per_date'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.app_config WHERE key='training_tick_per_race_day'
    AND value IN('"on"'::jsonb,'"beta"'::jsonb,'true'::jsonb)) THEN
    RAISE EXCEPTION 'training_condition_per_date requires training_tick_per_race_day';
  END IF;
  -- Same first-use guards as register_training_date_work. Ownership mutation
  -- already holds this rider row lock; ON CONFLICT preserves any existing state.
  INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
    SELECT NEW.id,50,20,COALESCE(NEW.acquired_at,NEW.created_at)
    WHERE NOT EXISTS(SELECT 1 FROM public.training_condition_settlements WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.training_race_loads WHERE rider_id=NEW.id)
      AND NOT EXISTS(SELECT 1 FROM public.rider_training_seen WHERE rider_id=NEW.id)
    ON CONFLICT(rider_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_training_date_work(p_team_id uuid, p_season_id uuid, p_tick_date date, p_game_days integer[], p_expected_rider_ids uuid[], p_deadline_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_registered_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_days integer[];v_riders uuid[];v_deadline timestamptz;v_work public.training_date_work%ROWTYPE;v_openings jsonb:='{}';
BEGIN
  IF p_expected_rider_ids IS NULL OR array_position(p_expected_rider_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Verified expected rider roster required'; END IF;
  SELECT array_agg(DISTINCT day ORDER BY day) INTO v_days FROM unnest(p_game_days) day;
  SELECT COALESCE(array_agg(DISTINCT rider ORDER BY rider),'{}'::uuid[]) INTO v_riders FROM unnest(p_expected_rider_ids) rider;
  IF cardinality(v_days) IS DISTINCT FROM 5 OR array_position(v_days,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Complete date game days required'; END IF;
  v_deadline:=(p_tick_date+1+time '02:00') AT TIME ZONE 'Europe/Copenhagen';
  IF ((v_deadline-interval '1 hour') AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date+1
    AND extract(hour FROM (v_deadline-interval '1 hour') AT TIME ZONE 'Europe/Copenhagen')>=2 THEN
    v_deadline:=v_deadline-interval '1 hour';
  END IF;
  IF p_deadline_at IS NOT NULL AND p_deadline_at<>v_deadline THEN RAISE EXCEPTION 'Deadline must be first valid Copenhagen 02:00'; END IF;
  -- Same lock order as commit/quarantine, including the cutover exclusion.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  -- An existing date is frozen. Do not repair or initialize it as a side effect
  -- of a retry; quarantined/historical riders require explicit reconciliation.
  SELECT * INTO v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF FOUND THEN
    IF v_work.game_days<>v_days OR v_work.deadline_at<>v_deadline THEN RAISE EXCEPTION 'Registered date contract changed'; END IF;
    RETURN to_jsonb(v_work);
  END IF;
  -- #6439: the team that opened the date keeps a rider who moves mid-date. Do not
  -- register him a second time for the same date on his new team.
  SELECT COALESCE(array_agg(rider ORDER BY rider),'{}'::uuid[]) INTO v_riders FROM unnest(v_riders) rider
    WHERE NOT EXISTS(SELECT 1 FROM public.training_date_work o WHERE o.season_id=p_season_id AND o.tick_date=p_tick_date
      AND o.team_id<>p_team_id AND rider=ANY(o.expected_rider_ids) AND NOT rider=ANY(o.quarantined_rider_ids));
  -- First use gets the shared new-rider start (#8089), same as the riders trigger.
  -- Historical state or any prior condition effects are never reconstructed.
  IF (p_registered_at AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date THEN
    PERFORM id FROM public.riders WHERE id=ANY(v_riders) ORDER BY id FOR UPDATE;
    INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
      SELECT r.id,50,20,p_registered_at FROM public.riders r
      WHERE r.id=ANY(v_riders) AND r.team_id=p_team_id AND r.is_retired IS NOT TRUE
        AND NOT EXISTS(SELECT 1 FROM public.rider_condition c WHERE c.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_condition_settlements s WHERE s.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t WHERE t.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.training_race_loads l WHERE l.rider_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM public.rider_training_seen seen WHERE seen.rider_id=r.id)
      ON CONFLICT(rider_id) DO NOTHING;
  END IF;
  IF p_registered_at<=v_deadline THEN SELECT COALESCE(jsonb_object_agg(rider_id::text,to_jsonb(c)),'{}') INTO v_openings FROM public.rider_condition c WHERE rider_id=ANY(v_riders); END IF;
  INSERT INTO public.training_date_work(team_id,season_id,tick_date,game_days,expected_rider_ids,deadline_at,status,opening_conditions,created_at,updated_at)
  VALUES(p_team_id,p_season_id,p_tick_date,v_days,v_riders,v_deadline,CASE WHEN cardinality(v_riders)=0 THEN 'complete' ELSE 'pending' END,v_openings,p_registered_at,p_registered_at)
  ON CONFLICT(team_id,season_id,tick_date) DO NOTHING;
  SELECT * INTO STRICT v_work FROM public.training_date_work WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF v_work.game_days<>v_days OR v_work.deadline_at<>v_deadline THEN RAISE EXCEPTION 'Registered date contract changed'; END IF;
  RETURN to_jsonb(v_work);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_training_compensation_6061(p_plan_text text, p_approved_hash text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    OR EXISTS(SELECT 1 FROM public.rider_training_seen WHERE rider_id=(item->>'rider_id')::uuid) THEN
    RAISE EXCEPTION 'Missing state has applied history; administrative review required';
   END IF;
   INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at) VALUES((item->>'rider_id')::uuid,50,20,p_now);
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
$function$;

-- Uændrede grants (CREATE OR REPLACE bevarer dem; gentaget eksplicit som i
-- de forrige migrationer).
REVOKE ALL ON FUNCTION public.initialize_first_use_rider_condition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_first_use_rider_condition() TO service_role;
REVOKE ALL ON FUNCTION public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.apply_training_compensation_6061(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_training_compensation_6061(text,text,timestamptz) TO service_role;

COMMIT;

RESET lock_timeout;
