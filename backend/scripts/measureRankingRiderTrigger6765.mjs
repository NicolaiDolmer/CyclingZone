// Authorized staging-only before/after measurement. Each bulk UPDATE rolls back.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {assertBenchmarkTarget,TARGET} from './measureRankingShadow6765.mjs';
const root=resolve(import.meta.dirname,'../..');
const guard="DO $g$ BEGIN IF coalesce((SELECT value #>> '{}' FROM public.app_config WHERE key='cz_environment'),'')<>'loadtest-staging' OR (SELECT value FROM public.app_config WHERE key='ranking_shadow_enabled') IS DISTINCT FROM '\"off\"'::jsonb THEN RAISE EXCEPTION '6765: isolated staging and flag off required'; END IF; END $g$;";
function main(){
  const url=assertBenchmarkTarget(process.env);
  const psql=process.env.PG_BIN?join(process.env.PG_BIN,'psql.exe'):join(homedir(),'scoop/apps/postgresql/current/bin/psql.exe');
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),
    PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)||'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'};
  function sql(source){
    const r=spawnSync(psql,['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:source,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    if(r.status!==0) throw Error((r.stderr||'psql failed').replaceAll(env.PGPASSWORD,'[redacted]'));
    return r.stdout.trim();
  }
  function state(){return JSON.parse(sql(guard+" SELECT jsonb_build_object('pg_version',current_setting('server_version'),'riders',(SELECT count(*) FROM public.riders),'rider_checksum',(SELECT sum(hashtextextended(row_to_json(r)::text,0)::numeric)::text FROM public.riders r),'flag',(SELECT value FROM public.app_config WHERE key='ranking_shadow_enabled'),'queue_length',(SELECT count(*) FROM public.ranking_dirty_log),'row_trigger',(SELECT (tgtype::int & 1)=1 FROM pg_trigger WHERE tgname='ranking_delta_riders_update'),'trigger_definition',(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='ranking_delta_riders_update'));"));}
  const before=state();
  if(process.argv.includes('--verify-only')){
    sql(guard+'\n'+readFileSync(join(root,'database/2026-10-19-6765-incremental-rankings-shadow.sql'),'utf8'));
    const verified=state();
    const admission=JSON.parse(sql(guard+" SELECT jsonb_build_object('apply',public.apply_ranking_deltas(200)->>'status','parity',public.check_ranking_shadow_parity()->>'status');"));
    if(!verified.row_trigger||verified.flag!=='off'||verified.queue_length!==1||verified.rider_checksum!==before.rider_checksum) throw Error('6765: final replay invariant failed');
    if(admission.apply!=='disabled'||admission.parity!=='disabled') throw Error('6765: runtime SQL off gate missing');
    const out=join(root,'docs/audits/2026-10-19-6765-rider-trigger.json');
    const report=JSON.parse(readFileSync(out,'utf8'));
    report.final_replay={verified_at:new Date().toISOString(),...verified,normal_rpc_status:admission};
    writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.final_replay,null,2));return;
  }
  if(before.row_trigger!==false) throw Error('6765: baseline must be the original statement trigger; refusing mislabeled measurement');
  const size=Math.min(10000,Number(before.riders));
  if(size<1) throw Error('6765: empty riders fixture');
  function sample(){
    const plan=JSON.parse(sql("BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='60s';"+guard+
      ' EXPLAIN(ANALYZE,BUFFERS,TIMING,FORMAT JSON) UPDATE public.riders r SET team_id=r.team_id FROM (SELECT id FROM public.riders ORDER BY id LIMIT '+size+') picked WHERE r.id=picked.id RETURNING r.id; ROLLBACK;'))[0];
    const trigger=plan.Triggers?.find(t=>t['Trigger Name']==='ranking_delta_riders_update');
    if(plan.Plan['Actual Rows']!==size) throw Error('6765: unexpected update cardinality');
    return {execution_ms:plan['Execution Time'],planning_ms:plan['Planning Time'],m1_trigger_ms:trigger?.Time??0,m1_trigger_calls:trigger?.Calls??0};
  }
  function phase(){sample();return Array.from({length:5},()=>sample());}
  const oldSamples=phase();
  sql(guard+'\n'+readFileSync(join(root,'database/2026-10-19-6765-incremental-rankings-shadow.sql'),'utf8'));
  const installed=state();
  if(!installed.row_trigger||!installed.trigger_definition.includes('WHEN')) throw Error('6765: replacement row guard missing');
  const newSamples=phase();const after=state();
  if(before.riders!==after.riders||before.rider_checksum!==after.rider_checksum||after.flag!=='off'||after.queue_length!==1) throw Error('6765: rollback/flag/queue invariant failed');
  const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  const summarize=xs=>({median_execution_ms:median(xs.map(x=>x.execution_ms)),median_m1_trigger_ms:median(xs.map(x=>x.m1_trigger_ms)),samples:xs});
  const report={branch:'staging-cutover',project_ref:TARGET,measured_at:new Date().toISOString(),bulk_rows:size,warmups_per_variant:1,trials_per_variant:5,
    workload:'UPDATE team_id=team_id; EXPLAIN ANALYZE; every transaction ROLLBACK',before,old:summarize(oldSamples),replacement:summarize(newSamples),after};
  writeFileSync(join(root,'docs/audits/2026-10-19-6765-rider-trigger.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
