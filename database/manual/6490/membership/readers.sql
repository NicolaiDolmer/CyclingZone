-- MANUAL-ONLY: #6490 M3. Guarded reader candidate; no production mandate.
-- Complete reviewed definitions are pinned, then only the history predicate changes.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='2s';
SELECT public.training_membership_assert_ready();
DO $switch$
DECLARE item record; definition text; fingerprint text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
      ('public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamp with time zone,timestamp with time zone)','475ac007ef939d147b3ca40db3ca400f','a8ab7c7915de71cb10f8c26f440270eb',$old$SELECT 1 FROM public.training_day_runs t
          WHERE t.report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',r.id))$old$,$new$SELECT 1 FROM public.rider_training_report_refs t
          WHERE t.rider_key=r.id::text COLLATE "C"$new$),
      ('public.initialize_first_use_rider_condition()','7730a6d6eb2037b1e2793a220c38cc3b','38f5b5775438ba5322ba6607ce38cf08',$old$SELECT 1 FROM public.training_day_runs
        WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',NEW.id))$old$,$new$SELECT 1 FROM public.rider_training_report_refs
        WHERE rider_key=NEW.id::text COLLATE "C"$new$),
      ('public.apply_training_compensation_6061(text,text,timestamp with time zone)','376566f52bfa1a6b2bcb309f95a5c2ba','63f0d316725c1bf00496d3f1f388a2ae',$old$SELECT 1 FROM public.training_day_runs WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',item->>'rider_id'))$old$,$new$SELECT 1 FROM public.rider_training_report_refs WHERE rider_key=(item->>'rider_id') COLLATE "C"$new$)
    ) e(signature,old_hash,new_hash,old_part,new_part)
  LOOP
    SELECT replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),'') INTO definition;
    fingerprint:=md5(definition);
    IF fingerprint=item.old_hash THEN
      EXECUTE replace(definition,replace(item.old_part,chr(13),''),replace(item.new_part,chr(13),''));
    ELSIF fingerprint IS DISTINCT FROM item.new_hash THEN
      RAISE EXCEPTION 'training_seen reader definition mismatch: %',item.signature;
    END IF;
    IF md5(replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),''))
      IS DISTINCT FROM item.new_hash THEN
      RAISE EXCEPTION 'training_seen reader replacement failed';
    END IF;
  END LOOP;
END;
$switch$;
COMMIT;
