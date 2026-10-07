-- schema-fingerprint-summary.sql - resumé-varianten (kind count md5) af schema-fingerprint.sql;
-- en enkelt lille raekke, egnet til read-only koersel mod prod via Supabase MCP (#5904).
select string_agg(s, ';' order by s) from (select kind || ' ' || count(*) || ' ' || md5(string_agg(fp, E'
' order by fp collate "C")) s from (
with rel as (
  select c.oid, c.relname, (c.relname ~ '(backup|_snapshot_2026)') as is_backup
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
), cols as (
  select 'table' as kind, c.table_name::text as name,
         md5(string_agg(c.column_name || ':' || c.data_type || ':' || coalesce(c.udt_name, '') || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), ',' order by c.column_name)) as def
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.table_name !~ '(backup|_snapshot_2026)'
  group by c.table_name
), backups as (
  select 'backup_table', r.relname::text, '-' from rel r join pg_class c on c.oid = r.oid where r.is_backup and c.relkind = 'r'
), views as (
  select case c.relkind when 'v' then 'view' else 'matview' end, c.relname::text, md5(pg_get_viewdef(c.oid, true))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
), funcs as (
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
), idx as (
  select 'index', i.indexname::text, md5(i.indexdef) from pg_indexes i
  where i.schemaname = 'public' and i.tablename !~ '(backup|_snapshot_2026)'
), cons as (
  select 'constraint', r.relname || '.' || co.conname, md5(pg_get_constraintdef(co.oid))
  from pg_constraint co join rel r on r.oid = co.conrelid where not r.is_backup
), trg as (
  select 'trigger', r.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join rel r on r.oid = t.tgrelid where not r.is_backup and not t.tgisinternal
), pol as (
  select 'policy', p.tablename || '.' || p.policyname,
         md5(coalesce(p.cmd, '') || '|' || coalesce(array_to_string(p.roles, ','), '') || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''))
  from pg_policies p where p.schemaname = 'public' and p.tablename !~ '(backup|_snapshot_2026)'
)
select kind || '|' || name || '|' || def as fp
from (select * from cols union all select * from backups union all select * from views union all select * from funcs
      union all select * from idx union all select * from cons union all select * from trg union all select * from pol) x
) f, lateral (select split_part(f.fp, '|', 1) as kind) k group by kind) z
