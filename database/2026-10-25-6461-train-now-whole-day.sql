-- #6461 "Train now" variant B, phase 1: the press settles each rider's whole known
-- date. Additive and idempotent (safe to run twice). Applied post-merge per #2642.
-- Design: docs/superpowers/specs/2026-10-23-6461-train-now-design.md + PR body.
--
-- 1) Stage flag training_train_now_whole_day, seeded OFF. Flip is owner-only.
-- 2) training_train_now_locks.whole_day_at: set by the B press on a rider whose
--    whole date (incl. the one condition settlement) it is about to settle.
-- 3) The shared lock (design §7): the mark and every race_entries insert take the
--    same transaction advisory lock per rider + date, and an insert for a marked
--    rider into a race with a stage still to run on that date is dropped (the row is
--    skipped, the rest of a batch goes through). A path that read the locks before
--    the press can therefore never insert after it. Nothing is marked while the flag
--    is off, and the guard returns at once without a mark, so flag off changes no row.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'training_train_now_whole_day',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for "Train now" variant B phase 1 (#6461): the press settles the whole date (all five race days and the date''s one fatigue/form settlement) for every rider without an open race slot; race riders still wait for their race. Requires training_train_now. off = the press as before.'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.training_train_now_locks ADD COLUMN IF NOT EXISTS whole_day_at timestamptz;
GRANT UPDATE (whole_day_at) ON public.training_train_now_locks TO service_role;

CREATE OR REPLACE FUNCTION public.train_now_whole_day_mark_serialize()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.whole_day_at IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('train-now-entry:'||NEW.rider_id::text||':'||NEW.tick_date::text,0));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS train_now_whole_day_mark_serialize ON public.training_train_now_locks;
CREATE TRIGGER train_now_whole_day_mark_serialize
  BEFORE INSERT OR UPDATE OF whole_day_at ON public.training_train_now_locks
  FOR EACH ROW EXECUTE FUNCTION public.train_now_whole_day_mark_serialize();

-- SECURITY DEFINER: the guard only reads app_config and the lock table, which an
-- inserting role (any path that writes race_entries) may not be allowed to read.
CREATE OR REPLACE FUNCTION public.race_entries_train_now_whole_day_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_date date;
BEGIN
  -- Fast path: flag off and no recent mark for this rider. Marks exist only after a
  -- B press, so with the flag off this is one indexed lookup and no lock.
  IF COALESCE((SELECT value #>> '{}' FROM public.app_config WHERE key='training_train_now_whole_day'),'off') NOT IN ('beta','on')
    AND NOT EXISTS(SELECT 1 FROM public.training_train_now_locks l WHERE l.rider_id=NEW.rider_id AND l.whole_day_at IS NOT NULL
      AND l.tick_date>=((now() AT TIME ZONE 'Europe/Copenhagen')::date-1)) THEN
    RETURN NEW;
  END IF;
  FOR v_date IN
    SELECT DISTINCT (s.scheduled_at AT TIME ZONE 'Europe/Copenhagen')::date
    FROM public.race_stage_schedule s JOIN public.races r ON r.id=s.race_id
    WHERE s.race_id=NEW.race_id AND s.stage_number>COALESCE(r.stages_completed,0)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('train-now-entry:'||NEW.rider_id::text||':'||v_date::text,0));
    IF EXISTS(SELECT 1 FROM public.training_train_now_locks l WHERE l.rider_id=NEW.rider_id AND l.tick_date=v_date AND l.whole_day_at IS NOT NULL) THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_entries_train_now_whole_day_guard ON public.race_entries;
CREATE TRIGGER race_entries_train_now_whole_day_guard
  BEFORE INSERT ON public.race_entries
  FOR EACH ROW EXECUTE FUNCTION public.race_entries_train_now_whole_day_guard();

REVOKE ALL ON FUNCTION public.train_now_whole_day_mark_serialize() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.race_entries_train_now_whole_day_guard() FROM PUBLIC,anon,authenticated;
