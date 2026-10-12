// Read-only measurement prerequisite probe. Credentials stay in child environment.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assertIsolation, STAGING_REF, PROD_REF } from '../../backend/scripts/staging/assertLoadtestIsolation.mjs';

if (process.env.CZ_LOADTEST_WRAPPER !== '1' ||
    !process.env.SUPABASE_DB_URL?.includes(STAGING_REF) ||
    process.env.SUPABASE_DB_URL.includes(PROD_REF)) throw new Error('Staging wrapper required');
const isolation = await assertIsolation();
if (isolation.status !== 'ISOLATED') throw new Error(JSON.stringify(isolation));
const sql = `BEGIN READ ONLY;
SELECT jsonb_build_object(
 'observed_at',clock_timestamp(),'server_version',current_setting('server_version'),
 'database_bytes',pg_database_size(current_database()),
 'can_set_nested_tracking',has_parameter_privilege(current_user,'pg_stat_statements.track','SET'),
 'can_checkpoint',pg_has_role(current_user,'pg_checkpoint','MEMBER'),
 'index',(SELECT jsonb_build_object('definition',pg_get_indexdef(c.oid),'options',c.reloptions,'valid',i.indisvalid,'ready',i.indisready,'bytes',pg_relation_size(c.oid),'tablespace',c.reltablespace) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid=to_regclass('public.idx_training_day_runs_report_riders')),
 'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN('shared_preload_libraries','pg_stat_statements.track','full_page_writes','wal_compression','checkpoint_timeout','max_wal_size','shared_buffers')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'hash',md5(replace(pg_get_functiondef(p.oid),chr(13),'')))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('commit_training_date_tick','register_training_date_work')),
 'training_tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'estimate',c.reltuples,'bytes',pg_total_relation_size(c.oid))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('training_day_runs','training_rider_ticks','rider_training_scores','rider_derived_ability_history','rider_ability_race_day_history','training_date_work')),
 'other_sessions',(SELECT jsonb_agg(jsonb_build_object('application',application_name,'state',state,'backend',backend_type)) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())
)::text;
ROLLBACK;`;
const target = new URL(process.env.SUPABASE_DB_URL);
const result = spawnSync('psql', ['-X','-w','-qAt','-v','ON_ERROR_STOP=1'], {
  input: sql, encoding:'utf8', timeout:60_000,
  env:{...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',
    PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),
    PGDATABASE:decodeURIComponent(target.pathname.slice(1)),PGSSLMODE:'require',
    PGCONNECT_TIMEOUT:'15',PGAPPNAME:'6490-readonly-preflight'},
});
if(result.status!==0) {
  // Do not print server context, connection strings or arbitrary error details.
  const kinds = [
    ['dns', /could not translate host name|Name or service not known|getaddrinfo/i],
    ['network', /Network is unreachable|No route to host|timeout expired|Connection timed out|could not connect/i],
    ['authentication', /password authentication failed|no password supplied/i],
    ['permission', /permission denied/i],
    ['unknown_parameter', /unrecognized configuration parameter|unrecognized parameter/i],
    ['missing_relation', /does not exist/i],
    ['ssl', /SSL error|certificate verify failed/i],
  ].filter(([, pattern]) => pattern.test(result.stderr ?? '')).map(([kind]) => kind);
  const diagnostic = String(result.stderr ?? '').replace(/"[^"]*"|'[^']*'/g,'<redacted>')
    .replace(/[a-z]+:\/\/\S+/gi,'<redacted>').slice(0,500);
  console.error(JSON.stringify({status:'BLOCKED',phase:'readonly-psql',exit:result.status,code:result.error?.code??null,kinds,diagnostic}));
  process.exit(1);
}
const probe=JSON.parse(result.stdout.trim());
mkdirSync('docs/snapshots/6490',{recursive:true});
writeFileSync('docs/snapshots/6490/staging-preflight.json',JSON.stringify({isolation,probe},null,2)+'\n');
console.log(JSON.stringify(probe));
if (process.argv.includes('--capabilities')) {
  const capabilities=[];
  for (const [name, statement] of [
    ['nested_tracking', "SET LOCAL pg_stat_statements.track='all'"],
    ['walinspect', 'CREATE EXTENSION IF NOT EXISTS pg_walinspect WITH SCHEMA extensions'],
    ['gin_pending_inspection', 'CREATE EXTENSION IF NOT EXISTS pgstattuple WITH SCHEMA extensions'],
  ]) {
    const attempt=spawnSync('psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{
      input:`BEGIN; ${statement}; ROLLBACK;`,encoding:'utf8',timeout:30_000,
      env:{...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',
        PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),
        PGDATABASE:decodeURIComponent(target.pathname.slice(1)),PGSSLMODE:'require',
        PGCONNECT_TIMEOUT:'15',PGAPPNAME:'6490-rollback-capability-probe'},
    });
    capabilities.push({name,available:attempt.status===0,sqlstate:attempt.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??null});
  }
  writeFileSync('docs/snapshots/6490/staging-capabilities.json',JSON.stringify(capabilities,null,2)+'\n');
  console.log(JSON.stringify({capabilities,allChangesRolledBack:true}));
}
