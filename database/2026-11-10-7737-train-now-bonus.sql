-- #7737 PR4. Additive, idempotent and dormant until a separate owner activation.
SET lock_timeout = '3s';
BEGIN;
INSERT INTO public.app_config(key,value,description)
VALUES('training_train_now_bonus','"off"'::jsonb,
  'Independent Train now training-yield control. Requires instant mode and date settlement. Owner-only activation.')
ON CONFLICT(key) DO NOTHING;

ALTER TABLE public.training_train_now_locks ADD COLUMN IF NOT EXISTS train_now_bonus boolean NOT NULL DEFAULT false;
GRANT SELECT(train_now_bonus), INSERT(train_now_bonus) ON public.training_train_now_locks TO service_role;

CREATE OR REPLACE FUNCTION public.training_train_now_bonus_choice()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.train_now_bonus IS DISTINCT FROM OLD.train_now_bonus THEN
      RAISE EXCEPTION 'Train-now bonus choice is immutable';
    END IF;
    -- Publishing frozen eligibility also publishes the receipt-CAS stamp. A lost
    -- RPC response must not strand an otherwise complete automatic continuation.
    IF NEW.train_now_bonus IS TRUE AND NEW.instant_entry_snapshot IS NOT NULL THEN
      NEW.instant_at := COALESCE(OLD.instant_at,NEW.pressed_at);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.train_now_bonus IS TRUE THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||NEW.tick_date::text,0));
    PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||NEW.team_id::text,0));
    -- The first lock publication decides. A previous receipt can never be upgraded.
    NEW.train_now_bonus :=
      (SELECT count(*)=3 FROM public.app_config WHERE key IN
        ('training_train_now_bonus','training_train_now_instant','training_condition_per_date') AND value='"on"'::jsonb)
      AND EXISTS(SELECT 1 FROM public.training_date_work w
        WHERE w.team_id=NEW.team_id AND w.season_id=NEW.season_id AND w.tick_date=NEW.tick_date
          AND NEW.rider_id=ANY(w.expected_rider_ids) AND NOT NEW.rider_id=ANY(w.quarantined_rider_ids))
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t
        WHERE t.rider_id=NEW.rider_id AND t.tick_date=NEW.tick_date);
  END IF;
  RETURN NEW;
END $$;

-- Alphabetical order places publication before the existing entry serialization.
DROP TRIGGER IF EXISTS aa_train_now_bonus_choice ON public.training_train_now_locks;
CREATE TRIGGER aa_train_now_bonus_choice BEFORE INSERT OR UPDATE OF train_now_bonus,instant_entry_snapshot
ON public.training_train_now_locks FOR EACH ROW EXECUTE FUNCTION public.training_train_now_bonus_choice();

CREATE OR REPLACE FUNCTION public.training_train_now_bonus_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_choice boolean:=false; v_stamp timestamptz; v_snapshot jsonb;
BEGIN
  -- commit_training_date_tick already owns cutover -> team -> rider locks.
  -- A stale calculation must roll back the entire transaction, including abilities.
  SELECT l.train_now_bonus,l.instant_at,l.instant_entry_snapshot INTO v_choice,v_stamp,v_snapshot
    FROM public.training_train_now_locks l WHERE l.rider_id=NEW.rider_id
      AND l.tick_date=NEW.tick_date AND l.team_id=NEW.team_id AND l.season_id=NEW.season_id;
  IF COALESCE(v_choice,false) IS DISTINCT FROM COALESCE(NEW.report->'train_now_bonus'='true'::jsonb,false)
    OR (v_choice IS TRUE AND (v_stamp IS NULL OR v_snapshot IS NULL)) THEN
    RAISE EXCEPTION 'Train-now bonus decision changed or publication incomplete; retry';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS train_now_bonus_receipt ON public.training_rider_ticks;
CREATE TRIGGER train_now_bonus_receipt BEFORE INSERT ON public.training_rider_ticks
FOR EACH ROW EXECUTE FUNCTION public.training_train_now_bonus_receipt();

REVOKE ALL ON FUNCTION public.training_train_now_bonus_choice() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.training_train_now_bonus_receipt() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_train_now_bonus_choice() TO service_role;
GRANT EXECUTE ON FUNCTION public.training_train_now_bonus_receipt() TO service_role;

CREATE OR REPLACE FUNCTION public.publish_train_now_bonus_press(
  p_team_id uuid,p_season_id uuid,p_tick_date date,p_rider_ids uuid[],p_eligible_rider_ids uuid[],p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_work public.training_date_work%ROWTYPE; v_rider uuid; v_eligible uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('training-date-cutover:'||p_tick_date::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('training-date:'||p_team_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtext(p_team_id::text));
  SELECT * INTO STRICT v_work FROM public.training_date_work
    WHERE team_id=p_team_id AND season_id=p_season_id AND tick_date=p_tick_date;
  IF p_now IS NULL OR p_rider_ids IS DISTINCT FROM v_work.expected_rider_ids OR p_eligible_rider_ids IS NULL
    OR EXISTS(SELECT 1 FROM unnest(p_eligible_rider_ids) id WHERE NOT id=ANY(v_work.expected_rider_ids)) THEN
    RAISE EXCEPTION 'Registered first-press roster required';
  END IF;
  -- Race entry guards take rider-entry before the whole-day rider/date key.
  -- Take every rider-entry key before the insert invokes the existing date trigger.
  FOR v_rider IN SELECT DISTINCT id FROM unnest(p_rider_ids) id ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('train-now-entry-rider:'||v_rider::text,0));
  END LOOP;
  SELECT COALESCE(array_agg(r.id ORDER BY r.id),'{}') INTO v_eligible FROM public.riders r
    WHERE r.id=ANY(p_eligible_rider_ids) AND r.team_id=p_team_id AND r.is_retired IS NOT TRUE
      AND NOT r.id=ANY(v_work.quarantined_rider_ids) AND v_work.opening_conditions?r.id::text;
  INSERT INTO public.training_train_now_locks(rider_id,tick_date,season_id,team_id,pressed_at,train_now_bonus)
    SELECT id,p_tick_date,p_season_id,p_team_id,p_now,id=ANY(v_eligible) FROM unnest(p_rider_ids) id ORDER BY id
    ON CONFLICT(rider_id,tick_date) DO NOTHING;
  -- No publication survives if eligibility freezing fails. A lost response after
  -- commit leaves complete frozen work discoverable by automatic continuation.
  PERFORM public.freeze_train_now_date_entries(p_team_id,p_season_id,p_tick_date,v_eligible,p_now);
  RETURN jsonb_build_object('published',true);
END $$;
REVOKE ALL ON FUNCTION public.publish_train_now_bonus_press(uuid,uuid,date,uuid[],uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_train_now_bonus_press(uuid,uuid,date,uuid[],uuid[],timestamptz) TO service_role;
COMMIT;
RESET lock_timeout;
