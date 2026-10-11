-- MANUAL-ONLY: #6490 L2. Requires the reviewed L1 foundation; no production mandate.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.training_seen_assert_contract()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.training_day_runs','training_seen_indexed','boolean',0::oid),
      ('public.rider_training_seen','rider_key','text','pg_catalog."C"'::regcollation::oid),
      ('public.rider_training_seen','report_count','bigint',0::oid)
    ) e(relation,attribute,type_name,collation_id)
    LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(e.relation) AND a.attname=e.attribute AND NOT a.attisdropped
    WHERE a.attnum IS NULL OR NOT a.attnotnull OR a.atttypid<>e.type_name::regtype OR a.attcollation<>e.collation_id
  ) THEN RAISE EXCEPTION 'training_seen column contract mismatch'; END IF;

  -- Fingerprints come from reviewed L1 dac15a312, not from the database being checked.
  -- Normalize CRLF only. Include execution attributes and return type, not just body.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.training_seen_keys(jsonb)','e13d6ae9d9a06871fedbacb3572c42d7'),
      ('public.training_seen_change(text,bigint)','727f97ccc06da0d1f415a2947e84c61c'),
      ('public.training_seen_mark_row()','47a9d872b6e30ef362caadf2f40d778e'),
      ('public.training_seen_after_insert()','7d767f5a9b0c32eec97e84f4c910f11c'),
      ('public.training_seen_after_update()','9d928bcce56bb6cdfdae697afd3726d0'),
      ('public.training_seen_after_delete()','86488d9b07a4c255afa422b0f6d737ea'),
      ('public.training_seen_after_truncate()','2868a2743b35cca050f709473c178991')
    ) e(signature,fingerprint)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
    WHERE p.oid IS NULL OR md5(replace(p.prosrc,chr(13),'')||coalesce(array_to_string(p.proconfig,','),'')
      ||p.provolatile::text||p.proparallel::text||p.prosecdef::text||p.prorettype::regtype::text)<>e.fingerprint
      OR p.proretset IS DISTINCT FROM (e.signature='public.training_seen_keys(jsonb)')
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'training_seen function contract mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('training_seen_mark',23,'public.training_seen_mark_row()',NULL::name,NULL::name),
      ('training_seen_insert',4,'public.training_seen_after_insert()',NULL::name,'training_seen_new'::name),
      ('training_seen_update',16,'public.training_seen_after_update()','training_seen_old'::name,'training_seen_new'::name),
      ('training_seen_delete',8,'public.training_seen_after_delete()','training_seen_old'::name,NULL::name),
      ('training_seen_truncate',32,'public.training_seen_after_truncate()',NULL::name,NULL::name)
    ) e(name,kind,signature,old_table,new_table)
    LEFT JOIN pg_trigger t ON t.tgrelid='public.training_day_runs'::regclass AND t.tgname=e.name
    WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgtype<>e.kind
      OR t.tgfoid IS DISTINCT FROM to_regprocedure(e.signature)
      OR t.tgoldtable IS DISTINCT FROM e.old_table OR t.tgnewtable IS DISTINCT FROM e.new_table
      OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR t.tgattr<>''::int2vector OR t.tgisinternal
  ) THEN RAISE EXCEPTION 'training_seen trigger contract mismatch'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.rider_training_seen'::regclass AND relrowsecurity)
    OR has_table_privilege('anon','public.rider_training_seen','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('authenticated','public.rider_training_seen','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION 'training_seen access contract mismatch'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_seen_parity()
RETURNS TABLE(unindexed bigint,missing_keys bigint,extra_keys bigint,wrong_counts bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  WITH expected AS (
    SELECT k.rider_key COLLATE "C" AS rider_key,count(*)::bigint AS n
    FROM public.training_day_runs r CROSS JOIN LATERAL public.training_seen_keys(r.report) k(rider_key)
    GROUP BY k.rider_key COLLATE "C"
  )
  SELECT (SELECT count(*) FROM public.training_day_runs WHERE NOT training_seen_indexed),
    count(*) FILTER(WHERE e.rider_key IS NOT NULL AND s.rider_key IS NULL),
    count(*) FILTER(WHERE e.rider_key IS NULL AND s.report_count<>0),
    count(*) FILTER(WHERE e.rider_key IS NOT NULL AND s.rider_key IS NOT NULL AND e.n<>s.report_count)
  FROM expected e FULL JOIN public.rider_training_seen s ON s.rider_key=e.rider_key
$$;

CREATE OR REPLACE FUNCTION public.training_seen_assert_ready()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result record;
BEGIN
  PERFORM public.training_seen_assert_contract();
  SELECT * INTO result FROM public.training_seen_parity();
  IF result.unindexed<>0 OR result.missing_keys<>0 OR result.extra_keys<>0 OR result.wrong_counts<>0 THEN
    RAISE EXCEPTION 'training_seen not ready';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.training_seen_assert_contract(),public.training_seen_parity(),public.training_seen_assert_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_seen_assert_contract(),public.training_seen_parity(),public.training_seen_assert_ready()
  TO service_role;
COMMIT;
