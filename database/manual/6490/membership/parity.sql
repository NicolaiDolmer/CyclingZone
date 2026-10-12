-- MANUAL-ONLY #6490 M2. Reviewed M1 foundation required; no production mandate.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION public.training_membership_assert_contract()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE refs oid:=to_regclass('public.rider_training_report_refs'); report_att smallint; key_att smallint;
BEGIN
  IF to_regclass('public.rider_training_seen') IS NOT NULL OR EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.training_day_runs')
    AND tgname IN('training_seen_mark','training_seen_insert','training_seen_update','training_seen_delete','training_seen_truncate'))
    THEN RAISE EXCEPTION 'training_membership counter contract conflict'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('public.training_day_runs','id','uuid',0::oid),
    ('public.training_day_runs','training_seen_indexed','boolean',0::oid),
    ('public.rider_training_report_refs','report_id','uuid',0::oid),
    ('public.rider_training_report_refs','rider_key','text','pg_catalog."C"'::regcollation::oid)
  ) e(relation,attribute,type_name,collation_id)
  LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(e.relation) AND a.attname=e.attribute AND NOT a.attisdropped
  WHERE a.attnum IS NULL OR NOT a.attnotnull OR a.atttypid<>e.type_name::regtype OR a.attcollation<>e.collation_id)
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid=refs AND attnum>0 AND NOT attisdropped)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=refs AND relkind='r')
    OR NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE a.attrelid=to_regclass('public.training_day_runs') AND a.attname='training_seen_indexed'
      AND pg_get_expr(d.adbin,d.adrelid)='false')
    THEN RAISE EXCEPTION 'training_membership column contract mismatch'; END IF;
  SELECT attnum INTO report_att FROM pg_attribute WHERE attrelid=refs AND attname='report_id';
  SELECT attnum INTO key_att FROM pg_attribute WHERE attrelid=refs AND attname='rider_key';
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='id'
      WHERE i.indrelid=to_regclass('public.training_day_runs') AND i.indisprimary AND i.indisunique
      AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indnkeyatts=1 AND i.indnatts=1
      AND i.indkey[0]=a.attnum AND i.indpred IS NULL AND i.indexprs IS NULL)
    OR NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
      WHERE i.indrelid=refs AND i.indisprimary AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready
      AND am.amname='btree' AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indkey[0]=report_att AND i.indkey[1]=key_att
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indcollation[1]='pg_catalog."C"'::regcollation::oid)
    OR NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam
      WHERE i.indrelid=refs AND i.indexrelid=to_regclass('public.idx_rider_training_report_refs_rider')
      AND NOT i.indisunique AND i.indisvalid AND i.indisready AND am.amname='btree'
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indkey[0]=key_att AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indcollation[0]='pg_catalog."C"'::regcollation::oid)
    OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid=refs AND indisunique AND NOT indisprimary)
    -- PG18 also catalogs NOT NULL as contype=n; attributes above validate them.
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=refs AND contype NOT IN('p','n'))
    THEN RAISE EXCEPTION 'training_membership index contract mismatch'; END IF;

  -- Reviewed M1 7a6ec783f. Normalize CRLF only; include execution/return attributes.
  IF EXISTS(SELECT 1 FROM (VALUES
    ('public.training_membership_keys(jsonb)','e13d6ae9d9a06871fedbacb3572c42d7'),
    ('public.training_membership_mark_row()','a22156546edda22adef6d2f2750152de'),
    ('public.training_membership_after_insert()','4fdd46f4ae4777ae5b1899314c57591c'),
    ('public.training_membership_after_update()','a0357d2047c899a6ac7f6ffe844c67c5'),
    ('public.training_membership_after_delete()','465513a547d9b582a199cc208b3902df'),
    ('public.training_membership_after_truncate()','f044966cc73ba340870f01a043effe54')
  ) e(signature,fingerprint) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,chr(13),'')||coalesce(array_to_string(p.proconfig,','),'')
    ||p.provolatile::text||p.proparallel::text||p.prosecdef::text||p.prorettype::regtype::text)<>e.fingerprint
    OR p.prokind<>'f' OR p.proretset IS DISTINCT FROM (e.signature='public.training_membership_keys(jsonb)')
    OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'training_membership function contract mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('training_membership_mark',23,'public.training_membership_mark_row()',NULL::name,NULL::name),
    ('training_membership_insert',4,'public.training_membership_after_insert()',NULL::name,'membership_new'::name),
    ('training_membership_update',16,'public.training_membership_after_update()','membership_old'::name,'membership_new'::name),
    ('training_membership_delete',8,'public.training_membership_after_delete()','membership_old'::name,NULL::name),
    ('training_membership_truncate',32,'public.training_membership_after_truncate()',NULL::name,NULL::name)
  ) e(name,kind,signature,old_table,new_table)
  LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.training_day_runs') AND t.tgname=e.name
  WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgtype<>e.kind OR t.tgfoid IS DISTINCT FROM to_regprocedure(e.signature)
    OR t.tgoldtable IS DISTINCT FROM e.old_table OR t.tgnewtable IS DISTINCT FROM e.new_table
    OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR t.tgattr<>''::int2vector OR t.tgisinternal)
    THEN RAISE EXCEPTION 'training_membership trigger contract mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=refs AND relrowsecurity)
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=refs)
    OR EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role_name) WHERE
      has_table_privilege(r.role_name,refs,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_any_column_privilege(r.role_name,refs,'SELECT,INSERT,UPDATE,REFERENCES'))
    OR EXISTS(SELECT 1 FROM (VALUES('SELECT'),('INSERT'),('DELETE')) p(privilege)
      WHERE NOT has_table_privilege('service_role',refs,p.privilege))
    OR has_table_privilege('service_role',refs,'UPDATE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    OR has_any_column_privilege('service_role',refs,'UPDATE,REFERENCES')
    THEN RAISE EXCEPTION 'training_membership access contract mismatch'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.training_membership_parity()
RETURNS TABLE(unindexed bigint,missing_refs bigint,extra_refs bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  WITH expected AS MATERIALIZED(
    SELECT r.id AS report_id,k.rider_key COLLATE "C" AS rider_key FROM public.training_day_runs r
      CROSS JOIN LATERAL public.training_membership_keys(r.report) k(rider_key)
  )
  SELECT (SELECT count(*) FROM public.training_day_runs WHERE NOT training_seen_indexed),
    count(*) FILTER(WHERE e.report_id IS NOT NULL AND m.report_id IS NULL),
    count(*) FILTER(WHERE e.report_id IS NULL AND m.report_id IS NOT NULL)
  FROM expected e FULL JOIN public.rider_training_report_refs m ON m.report_id=e.report_id AND m.rider_key=e.rider_key
$$;
CREATE OR REPLACE FUNCTION public.training_membership_assert_ready()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE p record;
BEGIN
  PERFORM public.training_membership_assert_contract();
  SELECT * INTO p FROM public.training_membership_parity();
  IF p.unindexed<>0 OR p.missing_refs<>0 OR p.extra_refs<>0 THEN RAISE EXCEPTION 'training_membership not ready'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.training_membership_assert_contract(),public.training_membership_parity(),public.training_membership_assert_ready()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.training_membership_assert_contract(),public.training_membership_parity(),public.training_membership_assert_ready()
  TO service_role;
SELECT public.training_membership_assert_contract();
COMMIT;
