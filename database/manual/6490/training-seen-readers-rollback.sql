-- MANUAL-ONLY: #6490 L3. Guarded reader rollback; no production mandate.
-- Complete reviewed definitions are pinned, then only the history predicate changes.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
DO $switch$
DECLARE item record; definition text; fingerprint text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.idx_training_day_runs_report_riders')
    AND indisvalid AND indisready AND md5(pg_get_indexdef(indexrelid))='04cd8548445df6474dbc1b077b3538f1') THEN
    RAISE EXCEPTION 'training_seen rollback requires the original valid GIN index';
  END IF;
  FOR item IN SELECT * FROM (VALUES
      ('public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamp with time zone,timestamp with time zone)','475ac007ef939d147b3ca40db3ca400f','bd34a64816856cf102ec5f9db84a2d74',$old$SELECT 1 FROM public.training_day_runs t
          WHERE t.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',r.id))$old$,$new$SELECT 1 FROM public.rider_training_seen t
          WHERE t.rider_key=r.id::text COLLATE "C" AND t.report_count>0$new$),
      ('public.initialize_first_use_rider_condition()','7730a6d6eb2037b1e2793a220c38cc3b','a6345762ec367e7365333307b7870900',$old$SELECT 1 FROM public.training_day_runs
        WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',NEW.id))$old$,$new$SELECT 1 FROM public.rider_training_seen
        WHERE rider_key=NEW.id::text COLLATE "C" AND report_count>0$new$),
      ('public.apply_training_compensation_6061(text,text,timestamp with time zone)','376566f52bfa1a6b2bcb309f95a5c2ba','8ca953a2935a519eca9847048be32685',$old$SELECT 1 FROM public.training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',item->>'rider_id'))$old$,$new$SELECT 1 FROM public.rider_training_seen WHERE rider_key=(item->>'rider_id') COLLATE "C" AND report_count>0$new$)
    ) e(signature,old_hash,new_hash,old_part,new_part)
  LOOP
    SELECT replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),'') INTO definition;
    fingerprint:=md5(definition);
    IF fingerprint=item.new_hash THEN
      EXECUTE replace(definition,item.new_part,item.old_part);
    ELSIF fingerprint IS DISTINCT FROM item.old_hash THEN
      RAISE EXCEPTION 'training_seen reader definition mismatch: %',item.signature;
    END IF;
    IF md5(replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),''))
      IS DISTINCT FROM item.old_hash THEN
      RAISE EXCEPTION 'training_seen reader replacement failed';
    END IF;
  END LOOP;
END;
$switch$;
COMMIT;
