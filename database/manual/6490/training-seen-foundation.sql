-- MANUAL-ONLY: #6490 L1. Test/staging candidate; no production apply authorized.
-- Existing readers and idx_training_day_runs_report_riders remain unchanged.
-- data-api-access: {"table":"public.rider_training_seen","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE"]},"reason":"Internal exact report-reference projection maintained atomically by training report triggers"}
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.rider_training_seen (
  rider_key text COLLATE "C" PRIMARY KEY,
  report_count bigint NOT NULL CHECK (report_count >= 0)
);
ALTER TABLE public.rider_training_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_training_seen FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rider_training_seen TO service_role;
ALTER TABLE public.training_day_runs ADD COLUMN IF NOT EXISTS training_seen_indexed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.training_seen_keys(p_report jsonb)
RETURNS SETOF text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog AS $$
  SELECT DISTINCT (e.value->>'rider_id') COLLATE "C"
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_report->'riders')='array'
    THEN p_report->'riders' ELSE '[]'::jsonb END) AS e(value)
  WHERE jsonb_typeof(e.value)='object' AND jsonb_typeof(e.value->'rider_id')='string'
$$;

CREATE OR REPLACE FUNCTION public.training_seen_change(p_key text, p_delta bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF p_delta > 0 THEN
    INSERT INTO public.rider_training_seen(rider_key,report_count) VALUES(p_key,p_delta)
    ON CONFLICT(rider_key) DO UPDATE
      SET report_count=public.rider_training_seen.report_count+EXCLUDED.report_count;
  ELSIF p_delta < 0 THEN
    UPDATE public.rider_training_seen SET report_count=report_count+p_delta
      WHERE rider_key=p_key COLLATE "C" AND report_count>=-p_delta;
    IF NOT FOUND THEN RAISE EXCEPTION 'training_seen counter underflow'; END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_mark_row()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  NEW.training_seen_indexed := true;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT k.rider_key COLLATE "C" AS rider_key,count(*)::bigint AS delta
    FROM training_seen_new n CROSS JOIN LATERAL public.training_seen_keys(n.report) k(rider_key)
    WHERE n.training_seen_indexed GROUP BY k.rider_key COLLATE "C" ORDER BY k.rider_key COLLATE "C"
  LOOP PERFORM public.training_seen_change(item.rider_key,item.delta); END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT d.rider_key,sum(d.delta)::bigint AS delta FROM (
      SELECT k.rider_key COLLATE "C" AS rider_key,1::bigint AS delta
      FROM training_seen_new n CROSS JOIN LATERAL public.training_seen_keys(n.report) k(rider_key)
      WHERE n.training_seen_indexed
      UNION ALL
      SELECT k.rider_key COLLATE "C",-1::bigint
      FROM training_seen_old o CROSS JOIN LATERAL public.training_seen_keys(o.report) k(rider_key)
      WHERE o.training_seen_indexed
    ) d GROUP BY d.rider_key HAVING sum(d.delta)<>0 ORDER BY d.rider_key
  LOOP PERFORM public.training_seen_change(item.rider_key,item.delta); END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT k.rider_key COLLATE "C" AS rider_key,-count(*)::bigint AS delta
    FROM training_seen_old o CROSS JOIN LATERAL public.training_seen_keys(o.report) k(rider_key)
    WHERE o.training_seen_indexed GROUP BY k.rider_key COLLATE "C" ORDER BY k.rider_key COLLATE "C"
  LOOP PERFORM public.training_seen_change(item.rider_key,item.delta); END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_after_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.rider_training_seen SET report_count=0 WHERE report_count<>0;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.training_seen_keys(jsonb), public.training_seen_change(text,bigint),
  public.training_seen_mark_row(), public.training_seen_after_insert(), public.training_seen_after_update(),
  public.training_seen_after_delete(), public.training_seen_after_truncate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_seen_keys(jsonb), public.training_seen_change(text,bigint),
  public.training_seen_mark_row(), public.training_seen_after_insert(), public.training_seen_after_update(),
  public.training_seen_after_delete(), public.training_seen_after_truncate() TO service_role;

CREATE OR REPLACE TRIGGER training_seen_mark BEFORE INSERT OR UPDATE ON public.training_day_runs
  FOR EACH ROW EXECUTE FUNCTION public.training_seen_mark_row();
CREATE OR REPLACE TRIGGER training_seen_insert AFTER INSERT ON public.training_day_runs
  REFERENCING NEW TABLE AS training_seen_new FOR EACH STATEMENT EXECUTE FUNCTION public.training_seen_after_insert();
CREATE OR REPLACE TRIGGER training_seen_update AFTER UPDATE ON public.training_day_runs
  REFERENCING OLD TABLE AS training_seen_old NEW TABLE AS training_seen_new
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_seen_after_update();
CREATE OR REPLACE TRIGGER training_seen_delete AFTER DELETE ON public.training_day_runs
  REFERENCING OLD TABLE AS training_seen_old FOR EACH STATEMENT EXECUTE FUNCTION public.training_seen_after_delete();
CREATE OR REPLACE TRIGGER training_seen_truncate AFTER TRUNCATE ON public.training_day_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_seen_after_truncate();
COMMIT;
