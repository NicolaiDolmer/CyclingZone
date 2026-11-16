-- #7741 (ejer 16/11): training_train_now_bonus kan staa paa "beta" (kun beta-testernes egne
-- tryk), samme moenster som training_train_now_instant 10/11 (#7737).
-- training_train_now_bonus_choice godkendte kun bonus-kontakten paa "on"; "beta" godkendes nu
-- ogsaa. Serveren afgoer forinden, at trykket er en beta-testers (isTrainNowBonusEnabled), og
-- triggeren regner kun, naar serveren har valgt bonus, saa et ikke-beta-tryk aldrig faar den.
-- Resten af funktionen er uaendret fra 2026-11-10-7737-train-now-instant-beta.sql.
-- Additiv og idempotent (CREATE OR REPLACE); ingen data aendres. Kontakten roeres ikke.
SET lock_timeout = '3s';
BEGIN;

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
    -- #7741: the bonus and instant switches both accept "beta" (the server has already
    -- decided the press is a beta tester's); date settlement must be "on".
    NEW.train_now_bonus :=
      (SELECT count(*)=3 FROM public.app_config WHERE key IN
        ('training_train_now_bonus','training_train_now_instant','training_condition_per_date')
          AND (value='"on"'::jsonb OR (key IN ('training_train_now_instant','training_train_now_bonus') AND value='"beta"'::jsonb)))
      AND EXISTS(SELECT 1 FROM public.training_date_work w
        WHERE w.team_id=NEW.team_id AND w.season_id=NEW.season_id AND w.tick_date=NEW.tick_date
          AND NEW.rider_id=ANY(w.expected_rider_ids) AND NOT NEW.rider_id=ANY(w.quarantined_rider_ids))
      AND NOT EXISTS(SELECT 1 FROM public.training_rider_ticks t
        WHERE t.rider_id=NEW.rider_id AND t.tick_date=NEW.tick_date);
  END IF;
  RETURN NEW;
END $$;

-- CREATE OR REPLACE bevarer rettighederne; gentages eksplicit som i de tidligere migrationer (#2858).
REVOKE ALL ON FUNCTION public.training_train_now_bonus_choice() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_train_now_bonus_choice() TO service_role;

UPDATE public.app_config
   SET description = 'Separate Train now training bonus (#7737/#7741): a player''s own press earns extra training yield for the date. Requires instant mode and date settlement. "on" = everyone, "beta" = only beta testers'' own presses, anything else = off. Owner-only flip.'
 WHERE key = 'training_train_now_bonus';

COMMIT;
RESET lock_timeout;
