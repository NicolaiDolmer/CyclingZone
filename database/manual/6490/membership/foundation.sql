-- MANUAL-ONLY #6490 M1. Owner-approved membership design, no production apply mandate.
-- SSOT: docs/TRAINING_RULES.md. GIN and existing readers remain untouched.
-- data-api-access: {"table":"public.rider_training_report_refs","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","DELETE"]},"reason":"Derived exact report memberships maintained atomically by training report triggers"}
BEGIN;
SET LOCAL lock_timeout='2s';
DO $$ BEGIN
  IF to_regclass('public.rider_training_seen') IS NOT NULL OR EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgrelid='public.training_day_runs'::regclass
      AND tgname IN('training_seen_mark','training_seen_insert','training_seen_update','training_seen_delete','training_seen_truncate')) THEN
    RAISE EXCEPTION 'training_membership refuses rejected counter candidate';
  END IF;
  IF to_regclass('public.rider_training_report_refs') IS NULL AND EXISTS(
    SELECT 1 FROM pg_attribute WHERE attrelid='public.training_day_runs'::regclass
      AND attname='training_seen_indexed' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'training_membership orphan source marker';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.rider_training_report_refs(
  report_id uuid NOT NULL,
  rider_key text COLLATE "C" NOT NULL,
  PRIMARY KEY(report_id,rider_key)
);
-- No FK: a FK would change existing TRUNCATE training_day_runs into an error
-- unless callers add CASCADE. Source triggers and full parity own the invariant.
CREATE INDEX IF NOT EXISTS idx_rider_training_report_refs_rider ON public.rider_training_report_refs(rider_key);
ALTER TABLE public.rider_training_report_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_training_report_refs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.rider_training_report_refs TO service_role;
ALTER TABLE public.training_day_runs ADD COLUMN IF NOT EXISTS training_seen_indexed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.training_membership_keys(p_report jsonb)
RETURNS SETOF text LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER
SET search_path=pg_catalog AS $$
  SELECT DISTINCT (e.value->>'rider_id') COLLATE "C"
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_report->'riders')='array'
    THEN p_report->'riders' ELSE '[]'::jsonb END) AS e(value)
  WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'rider_id')='string'
$$;

CREATE OR REPLACE FUNCTION public.training_membership_mark_row()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN NEW.training_seen_indexed:=true;RETURN NEW;END;
$$;

CREATE OR REPLACE FUNCTION public.training_membership_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO public.rider_training_report_refs(report_id,rider_key)
    SELECT n.id,k.rider_key FROM membership_new n
    CROSS JOIN LATERAL public.training_membership_keys(n.report) k(rider_key)
    WHERE n.training_seen_indexed;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_membership_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.rider_training_report_refs m USING membership_old o
    WHERE m.report_id=o.id AND NOT EXISTS(
      SELECT 1 FROM membership_new n CROSS JOIN LATERAL public.training_membership_keys(n.report) k(rider_key)
      WHERE n.id=m.report_id AND n.training_seen_indexed AND k.rider_key=m.rider_key);
  INSERT INTO public.rider_training_report_refs(report_id,rider_key)
    SELECT n.id,k.rider_key FROM membership_new n
    CROSS JOIN LATERAL public.training_membership_keys(n.report) k(rider_key)
    WHERE n.training_seen_indexed AND NOT EXISTS(
      SELECT 1 FROM public.rider_training_report_refs m WHERE m.report_id=n.id AND m.rider_key=k.rider_key);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_membership_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.rider_training_report_refs m USING membership_old o WHERE m.report_id=o.id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_membership_after_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.rider_training_report_refs;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.training_membership_keys(jsonb),public.training_membership_mark_row(),
  public.training_membership_after_insert(),public.training_membership_after_update(),
  public.training_membership_after_delete(),public.training_membership_after_truncate() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_membership_keys(jsonb),public.training_membership_mark_row(),
  public.training_membership_after_insert(),public.training_membership_after_update(),
  public.training_membership_after_delete(),public.training_membership_after_truncate() TO service_role;

CREATE OR REPLACE TRIGGER training_membership_mark BEFORE INSERT OR UPDATE ON public.training_day_runs
  FOR EACH ROW EXECUTE FUNCTION public.training_membership_mark_row();
CREATE OR REPLACE TRIGGER training_membership_insert AFTER INSERT ON public.training_day_runs
  REFERENCING NEW TABLE AS membership_new FOR EACH STATEMENT EXECUTE FUNCTION public.training_membership_after_insert();
CREATE OR REPLACE TRIGGER training_membership_update AFTER UPDATE ON public.training_day_runs
  REFERENCING OLD TABLE AS membership_old NEW TABLE AS membership_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_membership_after_update();
CREATE OR REPLACE TRIGGER training_membership_delete AFTER DELETE ON public.training_day_runs
  REFERENCING OLD TABLE AS membership_old FOR EACH STATEMENT EXECUTE FUNCTION public.training_membership_after_delete();
CREATE OR REPLACE TRIGGER training_membership_truncate AFTER TRUNCATE ON public.training_day_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_membership_after_truncate();
COMMIT;
