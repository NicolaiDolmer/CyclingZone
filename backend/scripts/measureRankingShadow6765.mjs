// Explicit staging-only maintenance benchmark. Never enables the runtime flag.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const TARGET='pywxpnynzmbukdvoiazp';
export function assertBenchmarkTarget(env){
  if(env.CZ_TARGET_ENV!=='loadtest-staging'||env.CZ_LOADTEST_WRAPPER!=='1'
    ||env.SUPABASE_URL!=='https://'+TARGET+'.supabase.co') throw Error('6765: authorized loadtest wrapper/branch required');
  const url=new URL(env.SUPABASE_DB_URL??'');
  if(!['postgres:','postgresql:'].includes(url.protocol)
    ||!(url.hostname==='db.'+TARGET+'.supabase.co'||decodeURIComponent(url.username).endsWith('.'+TARGET))
    ||url.href.includes('ghwvkxzhsbbltzfnuhhz')) throw Error('6765: database is not the approved staging branch');
  return url;
}
const root=resolve(import.meta.dirname,'../..');
const guard="DO $g$ BEGIN IF coalesce((SELECT value #>> '{}' FROM public.app_config WHERE key='cz_environment'),'')<>'loadtest-staging' THEN RAISE EXCEPTION '6765: staging marker missing'; END IF; END $g$;";
const flagGuard="DO $g$ BEGIN IF (SELECT value FROM public.app_config WHERE key='ranking_shadow_enabled') IS DISTINCT FROM '\"off\"'::jsonb THEN RAISE EXCEPTION '6765: runtime flag must remain off'; END IF; END $g$;";
function main(){
  const url=assertBenchmarkTarget(process.env);
  const psql=process.env.PG_BIN?join(process.env.PG_BIN,'psql.exe')
    :process.platform==='win32'?join(homedir(),'scoop/apps/postgresql/current/bin/psql.exe'):'psql';
  const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:url.pathname.slice(1)||'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'};
  function query(source){
    const r=spawnSync(psql,['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1'],{
      input:source,env:pgEnv,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,
    });
    if(r.status!==0) throw Error((r.stderr||'6765: psql failed').replaceAll(decodeURIComponent(url.password),'[redacted]'));
    return r.stdout.trim();
  }
  const before=JSON.parse(query(guard+" SELECT jsonb_build_object('pg_version',current_setting('server_version'),'source_rows',(SELECT count(*) FROM public.race_results),'source_races',(SELECT count(DISTINCT race_id) FROM public.race_results),'all_races',(SELECT count(*) FROM public.races));"));
  if(before.source_rows<2000000) throw Error('6765: source volume below approved production-like fixture');
  if(process.argv.includes('--apply-migration')){
    const migration=readFileSync(join(root,'database/2026-10-19-6765-incremental-rankings-shadow.sql'),'utf8');
    query(guard+'\n'+migration);
  }
  query(guard+flagGuard);
  if(process.argv.includes('--verify-only')){
    const verification=JSON.parse(query(guard+flagGuard+" SELECT jsonb_build_object('queue_length',(SELECT count(*) FROM public.ranking_dirty_log),'runtime_flag',(SELECT value FROM public.app_config WHERE key='ranking_shadow_enabled'),'peak_status',public.check_ranking_shadow_parity(NULL,'2026-10-19T17:00:00Z')->>'status','old_overload_removed',to_regprocedure('public.check_ranking_shadow_parity(bigint)') IS NULL,'new_overload_present',to_regprocedure('public.check_ranking_shadow_parity(bigint,timestamptz)') IS NOT NULL);"));
    if(verification.runtime_flag!=='off'||verification.peak_status!=='deferred-peak'||!verification.old_overload_removed||!verification.new_overload_present) throw Error('6765: final migration verification failed');
    const out=join(root,'docs/audits/2026-10-19-6765-supabase-branch.json');
    const report=JSON.parse(readFileSync(out,'utf8'));
    report.post_controls_verification={verified_at:new Date().toISOString(),...verification};
    writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report.post_controls_verification,null,2));
    return;
  }
  const state=JSON.parse(query("SELECT jsonb_build_object('contributions',(SELECT count(*) FROM public.ranking_race_contrib),'queued',(SELECT count(*) FROM public.ranking_dirty_log));"));
  if(state.contributions!==0||state.queued!==1) throw Error('6765: first rebuild requires untouched shadow state; refusing reset');
  function pass(){
    const output=query("SET statement_timeout='60s';"+guard+flagGuard+
      " WITH started AS MATERIALIZED(SELECT clock_timestamp() t), applied AS MATERIALIZED(SELECT public.apply_ranking_deltas(200) result FROM started) SELECT jsonb_build_object('result',result,'server_ms',round((extract(epoch FROM(clock_timestamp()-(SELECT t FROM started)))*1000)::numeric,3)) FROM applied;");
    return JSON.parse(output);
  }
  const batches=[];const started=performance.now();
  for(let i=0;i<100;i++){
    const measured=pass(); batches.push(measured);
    console.log(JSON.stringify({phase:'first-rebuild',batch:i+1,...measured}));
    if(measured.result.pending===false) break;
  }
  if(batches.at(-1)?.result.pending!==false) throw Error('6765: first rebuild did not drain in 100 batches');
  const rebuildClientMs=performance.now()-started;
  const picked=JSON.parse(query("WITH counts AS(SELECT race_id,count(*) n FROM public.race_results GROUP BY race_id), p AS(SELECT percentile_disc(0.95) WITHIN GROUP(ORDER BY n) n FROM counts) SELECT jsonb_build_object('id',race_id,'rows',c.n) FROM counts c,p ORDER BY abs(c.n-p.n),race_id LIMIT 1;"));
  if(!/^[0-9a-f-]{36}$/.test(picked.id)) throw Error('6765: invalid selected race identity');
  query(guard+flagGuard+" INSERT INTO public.ranking_dirty_log(kind,race_id) VALUES('race','"+picked.id+"');");
  const single=pass();
  const senior=readFileSync(join(root,'database/2026-09-25-5535-senior-only-result-aggregates.sql'),'utf8');
  const youth=readFileSync(join(root,'database/2026-09-25-4620-youth-rider-rankings-mv.sql'),'utf8');
  const pairs=[['rider_rankings_mv','ranking_rider_season'],['youth_rider_rankings_mv','ranking_youth_rider_season'],['team_standings_ext_mv','ranking_team_season_ext'],['team_race_points_mv','ranking_team_race_points']];
  const parity={};
  for(const [view,shadow] of pairs){
    const definition=(view.startsWith('youth')?youth:senior).match(new RegExp('CREATE MATERIALIZED VIEW (?:IF NOT EXISTS )?public\\.'+view+' AS\\s*([\\s\\S]*?);'))[1];
    parity[view]=Number(query('SELECT count(*) FROM (('+definition+' EXCEPT ALL SELECT * FROM public.'+shadow+') UNION ALL (SELECT * FROM public.'+shadow+' EXCEPT ALL '+definition+')) differences;'));
  }
  const after=JSON.parse(query(guard+flagGuard+" SELECT jsonb_build_object('source_rows',(SELECT count(*) FROM public.race_results),'queue_length',(SELECT count(*) FROM public.ranking_dirty_log),'contributions',(SELECT count(*) FROM public.ranking_race_contrib),'runtime_flag',(SELECT value FROM public.app_config WHERE key='ranking_shadow_enabled'));"));
  const report={branch:'staging-cutover',project_ref:TARGET,measured_at:new Date().toISOString(),before,
    first_rebuild:{batches:batches.length,server_ms:batches.reduce((s,b)=>s+b.server_ms,0),
      client_ms:rebuildClientMs,max_batch_ms:Math.max(...batches.map(b=>b.server_ms)),batch_measurements:batches},
    one_pass:{source_race_rows:picked.rows,...single},parity,after};
  const out=join(root,'docs/audits/2026-10-19-6765-supabase-branch.json');
  writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(Object.values(parity).some(n=>n!==0)||after.runtime_flag!=='off'||after.source_rows!==before.source_rows) throw Error('6765: branch parity/flag/source invariant failed');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
