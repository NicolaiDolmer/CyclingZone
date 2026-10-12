-- =============================================================================
-- 2026-10-12 — rider_training_seen erstatter GIN-opslaget i træningsrapporter (#6490)
-- =============================================================================
--
-- Design (ejer-godkendt 12/10):
--   docs/superpowers/specs/2026-10-12-6490-rider-training-seen-design.md
--
-- PROBLEM: tre first-use-vagter spørger "har rytter X nogensinde optrådt i en
-- træningsrapport?" via `training_day_runs.report->'riders' @> [...]`. Det
-- holder GIN-indekset idx_training_day_runs_report_riders i live; det er langt
-- større end selve tabellen og står for hovedparten af WAL'en i
-- commit_training_date_tick (hver afregning skriver rapporten om).
--
-- LØSNING (additiv, GIN bevares indtil separat ejer-go):
--   1. Tabel rider_training_seen(rider_id PK, first_seen_date, first_team_id,
--      first_run_id). Ingen FK til riders: historikken overlever rytteren.
--      RLS slået til uden policies, ingen klientgrants (som training_rider_ticks).
--   2. AFTER INSERT OR UPDATE OF report-trigger på training_day_runs indsætter
--      rapportens ryttere (DISTINCT, sorteret, ON CONFLICT DO NOTHING). Dækker
--      RPC-stien, den gamle PostgREST-sti (game_day IS NULL), recovery og repair
--      uden kodeændring. Ugyldige rider_id springes over; afregningen fejler
--      aldrig på grund af historiktabellen.
--   3. rebuild_rider_training_seen() genberegner fra training_day_runs ∪
--      training_rider_ticks ∪ training_race_loads. Triggeren dækker ikke DELETE,
--      så den der sletter rapporter (beta-reset, recovery-rollback) kalder den.
--   4. Backfill (idempotent, ingen lås på rapporttabellen ud over læsning).
--   5. Læserskift: KUN JSON-leddet i initialize_first_use_rider_condition,
--      register_training_date_work og apply_training_compensation_6061 erstattes
--      af EXISTS mod rider_training_seen. Resten er prods aktuelle definition
--      (pg_get_functiondef 12/10), inkl. GUC'er, search_path og grants.
--      Skiftet sker først efter et paritetsværn i samme transaktion.
--
-- UDRULNING: auto-migrate kører filen med `psql -f` (autocommit). Filen har tre
-- trin: (A) objekter + trigger i én transaktion, (B) backfill, (C) paritetsværn
-- + læserskift i én transaktion. Fejler et trin, er de foregående stadig
-- korrekte og filen kan køres igen (alt er idempotent). Backfill og værn læser
-- hele rapporttabellen én gang hver (sekvensiel læsning, ingen sortering på
-- disk); kør helst uden for aftenafregningen.
--
-- =============================================================================
-- ROLLBACK (før GIN er droppet; kør i én session):
-- ROLLBACK-BEGIN
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DO $rollback$
-- DECLARE
--   d text;
-- BEGIN
--   d := pg_get_functiondef('public.initialize_first_use_rider_condition()'::regprocedure);
--   d := replace(d, 'NOT EXISTS(SELECT 1 FROM public.rider_training_seen WHERE rider_id=NEW.id)',
--     'NOT EXISTS(SELECT 1 FROM public.training_day_runs WHERE report->''riders'' @> jsonb_build_array(jsonb_build_object(''rider_id'',NEW.id)))');
--   IF d LIKE '%rider_training_seen%' THEN RAISE EXCEPTION 'rollback: initialize_first_use_rider_condition not restored'; END IF;
--   EXECUTE d;
--   d := pg_get_functiondef('public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamptz,timestamptz)'::regprocedure);
--   d := replace(d, 'NOT EXISTS(SELECT 1 FROM public.rider_training_seen seen WHERE seen.rider_id=r.id)',
--     'NOT EXISTS(SELECT 1 FROM public.training_day_runs t WHERE t.report->''riders'' @> jsonb_build_array(jsonb_build_object(''rider_id'',r.id)))');
--   IF d LIKE '%rider_training_seen%' THEN RAISE EXCEPTION 'rollback: register_training_date_work not restored'; END IF;
--   EXECUTE d;
--   d := pg_get_functiondef('public.apply_training_compensation_6061(text,text,timestamptz)'::regprocedure);
--   d := replace(d, 'EXISTS(SELECT 1 FROM public.rider_training_seen WHERE rider_id=(item->>''rider_id'')::uuid)',
--     'EXISTS(SELECT 1 FROM public.training_day_runs WHERE report->''riders'' @> jsonb_build_array(jsonb_build_object(''rider_id'',item->>''rider_id'')))');
--   IF d LIKE '%rider_training_seen%' THEN RAISE EXCEPTION 'rollback: apply_training_compensation_6061 not restored'; END IF;
--   EXECUTE d;
-- END
-- $rollback$;
-- DROP TRIGGER IF EXISTS trg_track_rider_training_seen ON public.training_day_runs;
-- DROP FUNCTION IF EXISTS public.track_rider_training_seen();
-- DROP FUNCTION IF EXISTS public.rebuild_rider_training_seen();
-- DROP FUNCTION IF EXISTS public.rider_training_seen_sources();
-- DROP TABLE IF EXISTS public.rider_training_seen;
-- COMMIT;
-- ROLLBACK-END
-- (CREATE OR REPLACE bevarer funktionernes grants og GUC'er.) Efter et DROP INDEX
-- af GIN skal indekset genopbygges (CREATE INDEX CONCURRENTLY) FØR rollback.
-- =============================================================================

SET lock_timeout = '3s';
SET statement_timeout = '10min';

-- -----------------------------------------------------------------------------
-- (A) Tabel, kildefunktion, trigger og rebuild
-- -----------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.rider_training_seen (
  rider_id uuid PRIMARY KEY,
  first_seen_date date,
  first_team_id uuid,
  first_run_id uuid
);
-- data-api-access: {"table":"public.rider_training_seen","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Server-only training history; written by the training_day_runs trigger and rebuild, read by the first-use guards in the service_role training RPCs"}
ALTER TABLE public.rider_training_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_training_seen FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rider_training_seen TO service_role;
-- Ingen eksplicit codex_readonly-grant (som training_rider_ticks): i prod får
-- nye public-tabeller SELECT til codex_readonly via postgres' default privileges,
-- og rollen findes ikke i alle miljøer (test, preview), så en statisk GRANT ville fejle.

-- Én række pr. rytter: tidligste kilde (dato, så rapport < kvittering <
-- løbsbelastning, så laveste id). Strømmende HashAggregate over en "C"-sortérbar
-- nøgle, så hverken backfill eller rebuild sorterer ~1,5 mio. rækker på disk.
CREATE OR REPLACE FUNCTION public.rider_training_seen_sources()
RETURNS TABLE(rider_id uuid, first_seen_date date, first_team_id uuid, first_run_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET work_mem = '64MB'
AS $$
  WITH src(rider_id, k) AS (
    SELECT (e->>'rider_id')::uuid,
           to_char(t.tick_date, 'YYYY-MM-DD') || '|0|' || t.team_id::text || '|' || t.id::text
      FROM public.training_day_runs t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.report->'riders') = 'array' THEN t.report->'riders' ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object'
       AND e->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    UNION ALL
    SELECT k.rider_id, to_char(k.tick_date, 'YYYY-MM-DD') || '|1|' || k.team_id::text || '|'
      FROM public.training_rider_ticks k
    UNION ALL
    SELECT l.rider_id, to_char(l.tick_date, 'YYYY-MM-DD') || '|2||'
      FROM public.training_race_loads l
  ), firsts AS (
    SELECT src.rider_id, min(src.k COLLATE "C") AS k FROM src GROUP BY src.rider_id
  )
  SELECT f.rider_id,
         split_part(f.k, '|', 1)::date,
         NULLIF(split_part(f.k, '|', 3), '')::uuid,
         NULLIF(split_part(f.k, '|', 4), '')::uuid
    FROM firsts f;
$$;
REVOKE ALL ON FUNCTION public.rider_training_seen_sources() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rider_training_seen_sources() TO service_role;

-- Trigger: insert-only, sorteret (fast låserækkefølge mellem samtidige
-- afregninger), ingen rækkelåse ved konflikt mod committede rækker. Kører som
-- skriveren (invoker); kun service_role/postgres kan skrive rapporter (RLS).
CREATE OR REPLACE FUNCTION public.track_rider_training_seen()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(NEW.report->'riders') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  INSERT INTO public.rider_training_seen(rider_id, first_seen_date, first_team_id, first_run_id)
  SELECT DISTINCT (e->>'rider_id')::uuid, NEW.tick_date, NEW.team_id, NEW.id
    FROM jsonb_array_elements(NEW.report->'riders') e
   WHERE jsonb_typeof(e) = 'object'
     AND e->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM public.rider_training_seen s WHERE s.rider_id = (e->>'rider_id')::uuid)
   ORDER BY 1
  ON CONFLICT (rider_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.track_rider_training_seen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_rider_training_seen() TO service_role;

CREATE OR REPLACE TRIGGER trg_track_rider_training_seen
  AFTER INSERT OR UPDATE OF report ON public.training_day_runs
  FOR EACH ROW EXECUTE FUNCTION public.track_rider_training_seen();

-- Fuld genberegning efter sletning af rapporter. SHARE på rapporttabellen venter
-- på igangværende rapportskrivere og holder nye tilbage til commit: en skriver
-- hvis ryttere allerede er set, indsætter intet og holder derfor ingen lås på
-- historiktabellen, så uden den lås kunne dens rapport mangle i genberegningen.
-- Samme låserækkefølge som skriverne (rapporter, så historik): ingen deadlock.
-- Læsere påvirkes ikke.
CREATE OR REPLACE FUNCTION public.rebuild_rider_training_seen()
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  LOCK TABLE public.training_day_runs IN SHARE MODE;
  LOCK TABLE public.rider_training_seen IN EXCLUSIVE MODE;
  SELECT count(*) INTO v_before FROM public.rider_training_seen;
  DELETE FROM public.rider_training_seen;
  INSERT INTO public.rider_training_seen(rider_id, first_seen_date, first_team_id, first_run_id)
  SELECT s.rider_id, s.first_seen_date, s.first_team_id, s.first_run_id
    FROM public.rider_training_seen_sources() s
   ORDER BY s.rider_id;
  GET DIAGNOSTICS v_after = ROW_COUNT;
  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.rebuild_rider_training_seen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_rider_training_seen() TO service_role;

COMMIT;

-- -----------------------------------------------------------------------------
-- (B) Backfill. Triggeren er aktiv fra (A)'s commit: CREATE TRIGGER ventede på
-- alle igangværende rapportskrivere, så enhver rapport er enten synlig her eller
-- fanget af triggeren. Ingen lås på rapporttabellen; en rytter som triggeren nåede
-- at indsætte med en senere dato får den tidligste dato. Idempotent.
-- -----------------------------------------------------------------------------
INSERT INTO public.rider_training_seen AS seen(rider_id, first_seen_date, first_team_id, first_run_id)
SELECT s.rider_id, s.first_seen_date, s.first_team_id, s.first_run_id
  FROM public.rider_training_seen_sources() s
 ORDER BY s.rider_id
ON CONFLICT (rider_id) DO UPDATE
   SET first_seen_date = EXCLUDED.first_seen_date,
       first_team_id = EXCLUDED.first_team_id,
       first_run_id = EXCLUDED.first_run_id
 WHERE EXCLUDED.first_seen_date < seen.first_seen_date;

-- -----------------------------------------------------------------------------
-- (C) Paritetsværn + læserskift (én transaktion; værnet fejler før skiftet)
-- -----------------------------------------------------------------------------
BEGIN;

DO $parity$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.training_day_runs t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.report->'riders') = 'array' THEN t.report->'riders' ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object'
       AND e->>'rider_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NOT EXISTS (SELECT 1 FROM public.rider_training_seen s WHERE s.rider_id = (e->>'rider_id')::uuid)
  ) THEN
    RAISE EXCEPTION '#6490 parity: a reported rider is missing from rider_training_seen; readers not switched';
  END IF;
END
$parity$;

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
    SELECT NEW.id,50,0,COALESCE(NEW.acquired_at,NEW.created_at)
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
  -- Preserve the legacy engine's neutral missing-row fallback on first use.
  -- Historical state or any prior condition effects are never reconstructed.
  IF (p_registered_at AT TIME ZONE 'Europe/Copenhagen')::date=p_tick_date THEN
    PERFORM id FROM public.riders WHERE id=ANY(v_riders) ORDER BY id FOR UPDATE;
    INSERT INTO public.rider_condition(rider_id,form,fatigue,updated_at)
      SELECT r.id,50,0,p_registered_at FROM public.riders r
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

RESET statement_timeout;
RESET lock_timeout;

-- =============================================================================
-- POST-VERIFY (read-only, efter apply)
-- =============================================================================
-- 1. Læserne peger på tabellen, GUC'er/grants uændrede:
--   SELECT p.proname, p.proconfig, p.proacl::text,
--          pg_get_functiondef(p.oid) LIKE '%rider_training_seen%' AS uses_seen,
--          pg_get_functiondef(p.oid) LIKE '%@> jsonb_build_array%' AS uses_json
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('initialize_first_use_rider_condition',
--      'register_training_date_work','apply_training_compensation_6061');
--     -- forventet: uses_seen=t, uses_json=f; initialize_first_use_rider_condition
--     -- beholder enable_seqscan=off; proacl {postgres=X/postgres,service_role=X/postgres}
-- 2. Trigger og tabel:
--   SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_track_rider_training_seen';
--   SELECT count(*), pg_size_pretty(pg_total_relation_size('public.rider_training_seen'))
--     FROM public.rider_training_seen;
-- 3. Paritet: scripts/ops/6490-parity.sql (read-only).
-- =============================================================================
