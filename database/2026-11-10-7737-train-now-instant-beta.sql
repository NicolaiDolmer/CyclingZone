-- #7737 (ejer 10/11): training_train_now_instant kan staa paa "beta" (kun beta-testernes egne
-- tryk). To laesere i databasen kendte kun "on":
-- 1) race_entries_train_now_instant_guard: den hurtige vej sprang rytterlaasen over for "beta",
--    saa en udtagelse kunne glide forbi freeze_train_now_date_entries (review 10/11). "beta"
--    tager nu den langsomme vej som "on".
-- 2) training_train_now_bonus_choice: bonussen kraevede instant = "on"; "beta" godkendes nu
--    ogsaa (serveren afgoer forinden, at trykket er en beta-testers).
-- Additiv og idempotent (CREATE OR REPLACE); ingen data aendres. Kontakterne roeres ikke.
SET lock_timeout = '3s';
BEGIN;

CREATE OR REPLACE FUNCTION public.race_entries_train_now_instant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_rider uuid;
BEGIN
  -- Fast path (same shape as the #6461 guard): switch neither on nor beta (owner 10/11) and no frozen snapshot for the
  -- rider(s) this row touches. Snapshots exist only after an instant press, so with the
  -- switch off every selection save, withdrawal, cascade and season reset takes no lock.
  IF COALESCE((SELECT value #>> '{}' FROM public.app_config WHERE key='training_train_now_instant'),'off') NOT IN ('on','beta')
    AND NOT EXISTS(SELECT 1 FROM public.training_train_now_locks l
      WHERE l.instant_entry_snapshot IS NOT NULL
        AND l.rider_id IN (CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.rider_id END,
                           CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.rider_id END)) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  FOR v_rider IN SELECT DISTINCT id FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.rider_id]
    WHEN TG_OP='DELETE' THEN ARRAY[OLD.rider_id] ELSE ARRAY[OLD.rider_id,NEW.rider_id] END) id ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('train-now-entry-rider:'||v_rider::text,0));
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF EXISTS(SELECT 1 FROM public.training_train_now_locks l JOIN public.races r ON r.id=NEW.race_id AND r.season_id=l.season_id
    WHERE l.rider_id=NEW.rider_id AND l.instant_entry_snapshot IS NOT NULL
      AND NOT (l.instant_entry_snapshot->'raceIds' @> jsonb_build_array(NEW.race_id))
      AND (EXISTS(SELECT 1 FROM public.race_stage_schedule s WHERE s.race_id=NEW.race_id AND (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date=l.tick_date)
        OR EXISTS(SELECT 1 FROM unnest(l.instant_game_days) d WHERE d BETWEEN
          (SELECT min(s.game_day) FROM public.race_stage_schedule s WHERE s.race_id=NEW.race_id)
          AND (SELECT max(s.game_day) FROM public.race_stage_schedule s WHERE s.race_id=NEW.race_id)))) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

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
        ('training_train_now_bonus','training_train_now_instant','training_condition_per_date')
          AND (value='"on"'::jsonb OR (key='training_train_now_instant' AND value='"beta"'::jsonb)))
      AND EXISTS(SELECT 1 FROM public.training_date_work w
        WHERE w.team_id=NEW.team_id AND w.season_id=NEW.season_id AND w.tick_date=NEW.tick_date
          AND NEW.rider_id=ANY(w.expected_rider_ids) AND NOT NEW.rider_id=ANY(w.quarantined_rider_ids))
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t
        WHERE t.rider_id=NEW.rider_id AND t.tick_date=NEW.tick_date);
  END IF;
  RETURN NEW;
END $$;

-- CREATE OR REPLACE bevarer rettighederne; gentages eksplicit som i den oprindelige migration (#2858).
REVOKE ALL ON FUNCTION public.race_entries_train_now_instant_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.training_train_now_bonus_choice() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_train_now_bonus_choice() TO service_role;

UPDATE public.app_config
   SET description = 'Switch for Train now straight away (#7737): a rider with a race later today trains his free race days at the press and gets provisional form and fatigue. "on" = everyone, "beta" = only beta testers'' own presses, anything else = off. Owner-only flip.'
 WHERE key = 'training_train_now_instant';

COMMIT;
RESET lock_timeout;
