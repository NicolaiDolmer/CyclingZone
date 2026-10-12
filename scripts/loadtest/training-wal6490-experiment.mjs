// #6490 measurement tooling; no product code. Always invoke through isolation wrapper.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync,createReadStream,statSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {assertIsolation,STAGING_REF,PROD_REF} from '../../backend/scripts/staging/assertLoadtestIsolation.mjs';

const tables=['rider_derived_abilities','rider_condition','rider_derived_ability_history',
  'rider_ability_race_day_history','rider_training_scores','training_rider_ticks',
  'training_condition_settlements','training_race_loads','training_day_runs',
  'training_date_work','training_condition_timeout_outbox'];
const mode=process.argv[2];
if(!['snapshot','prepare','restore','restore-local','restore-final','cache-original','capture','seal','recover-owned-restore'].includes(mode))throw new Error('Unknown mode');
if(process.env.CZ_LOADTEST_WRAPPER!=='1'||!process.env.SUPABASE_DB_URL?.includes(STAGING_REF)||
  process.env.SUPABASE_DB_URL.includes(PROD_REF))throw new Error('Staging wrapper required');
const isolation=await assertIsolation();
if(isolation.status!=='ISOLATED')throw new Error('Staging isolation failed');
const target=new URL(process.env.SUPABASE_DB_URL);
const env={...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',
  PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),
  PGDATABASE:decodeURIComponent(target.pathname.slice(1)),PGSSLMODE:'require',
  PGCONNECT_TIMEOUT:'15',PGAPPNAME:'6490-staging-measurement'};
const out=resolve(process.argv[3]??'');
// Transient local rollback material, not a cloud export. Public evidence contains only hashes/counts.
const privateRoot=resolve('.codex.local/6490-snapshots');
if(!out.startsWith(privateRoot+'\\')&&!out.startsWith(privateRoot+'/'))throw new Error('Private snapshot directory required');
if(mode==='snapshot'){
  if(existsSync(out))throw new Error('Refusing to overwrite existing snapshot');
  mkdirSync(out,{recursive:true});
}else if(!existsSync(join(out,'snapshot-complete.json')))throw new Error('Complete backup required');
function native(exe,args,input,timeout=120000){
  const r=spawnSync(exe,args,{env,input,encoding:'utf8',timeout,maxBuffer:16*1024*1024,windowsHide:true});
  if(r.status!==0)throw Object.assign(new Error('Measurement command failed'),{
    phase:exe,exit:r.status,code:r.error?.code??null,sqlstate:r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]??null});
  return r.stdout.trim();
}
function query(sql,timeout=120000){return native('psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],sql,timeout);}
const relationSql=tables.map(t=>`SELECT '${t}' AS name,count(*) AS rows,md5(string_agg(h,'' ORDER BY h)) AS hash FROM (SELECT md5(to_jsonb(t)::text) h FROM public.${t} t) s`).join(' UNION ALL ');
const fingerprint=()=>JSON.parse(query(`BEGIN READ ONLY;SELECT jsonb_agg(x ORDER BY name) FROM (${relationSql}) x;ROLLBACK;`));
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
const checksum=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const cacheSchema='cz_measure_6490_20261012';
function keyTables(keys){return `CREATE TEMP TABLE restore_rider_id(rider_id uuid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO restore_rider_id SELECT value::uuid FROM jsonb_array_elements_text(${literal(JSON.stringify(keys.riders))}::jsonb);
 CREATE TEMP TABLE restore_team_id(team_id uuid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO restore_team_id SELECT value::uuid FROM jsonb_array_elements_text(${literal(JSON.stringify(keys.teams))}::jsonb);\n`;}
function scope(table,keys){
 const teamTables=['training_day_runs','training_date_work','training_condition_timeout_outbox'];
 const column=teamTables.includes(table)?'team_id':'rider_id';
 const ids=keys?(teamTables.includes(table)?keys.teams:keys.riders):null;
 const membership=keys?`${column} IN(SELECT value::uuid FROM jsonb_array_elements_text(${literal(JSON.stringify(ids))}::jsonb))`:
   `${column} IN(SELECT ${column} FROM pg_temp.restore_${column})`;
 if(['rider_derived_abilities','rider_condition'].includes(table))return membership;
 const dateColumn=['rider_derived_ability_history','rider_ability_race_day_history'].includes(table)?'snapshot_date':'tick_date';
 return `${membership} AND ${dateColumn}${table==='training_race_loads'?'=':'>='}'2026-10-04'`;
}
try{
 if(mode==='recover-owned-restore'){
  // Exact backend positively identified after its local client had exited. Never target other sessions.
  const terminated=query("SELECT pg_terminate_backend(pid,5000) FROM pg_stat_activity WHERE pid=650275 AND application_name='6490-staging-measurement' AND backend_start='2026-10-12T11:18:11.603649Z'::timestamptz AND wait_event_type='Client' AND wait_event='ClientRead'");
  const remaining=Number(query("SELECT count(*) FROM pg_stat_activity WHERE pid=650275 AND backend_start='2026-10-12T11:18:11.603649Z'::timestamptz"));
  if(remaining!==0)throw new Error('Identified orphan restore backend remains');
  console.log(JSON.stringify({phase:'orphan-restore-closed',pid:650275,terminated:terminated==='t',remaining}));
 }else if(mode==='cache-original'){
  const manifest=JSON.parse(readFileSync(join(out,'snapshot-complete.json'))),metadata=JSON.parse(readFileSync(join(out,'original-metadata.json')));
  if(JSON.stringify(fingerprint())!==JSON.stringify(manifest.tables))throw new Error('Original snapshot required for server-side cache');
  if(query(`SELECT to_regnamespace('${cacheSchema}') IS NULL`)!=='t')throw new Error('Refusing to replace existing snapshot schema');
  const provenance='6490 original snapshot '+checksum(join(out,'snapshot-complete.json'));
  query(`BEGIN;SET LOCAL statement_timeout='15min';SET LOCAL lock_timeout='15s';
    LOCK TABLE ${tables.map(t=>'public.'+t).join(',')} IN SHARE MODE;
    CREATE SCHEMA ${cacheSchema};
    REVOKE ALL ON SCHEMA ${cacheSchema} FROM PUBLIC,anon,authenticated,service_role;
    COMMENT ON SCHEMA ${cacheSchema} IS ${literal(provenance)};${keyTables(metadata.keys)}
    ${tables.map(t=>`CREATE TABLE ${cacheSchema}.${t} AS SELECT * FROM public.${t} WHERE ${scope(t)};
      ALTER TABLE ${cacheSchema}.${t} ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE ${cacheSchema}.${t} FROM PUBLIC,anon,authenticated,service_role;
      DO $$ BEGIN IF (SELECT count(*) FROM ${cacheSchema}.${t})<>(SELECT count(*) FROM public.${t} WHERE ${scope(t)}) OR
       (SELECT md5(string_agg(h,'' ORDER BY h)) FROM(SELECT md5(to_jsonb(x)::text) h FROM ${cacheSchema}.${t} x)s) IS DISTINCT FROM
       (SELECT md5(string_agg(h,'' ORDER BY h)) FROM(SELECT md5(to_jsonb(x)::text) h FROM public.${t} x WHERE ${scope(t)})s)
       THEN RAISE EXCEPTION 'Snapshot copy mismatch';END IF;END $$;`).join('\n')}
    DO $$ BEGIN IF (SELECT jsonb_agg(x ORDER BY name) FROM(${relationSql})x) IS DISTINCT FROM ${literal(JSON.stringify(manifest.tables))}::jsonb
      THEN RAISE EXCEPTION 'Original source changed during cache creation';END IF;END $$;
    COMMIT;`,1200000);
  const cacheHashes=JSON.parse(query(`SELECT jsonb_agg(x ORDER BY name) FROM(${tables.map(t=>`SELECT '${t}' name,count(*) rows,md5(string_agg(h,'' ORDER BY h)) hash FROM(SELECT md5(to_jsonb(x)::text)h FROM ${cacheSchema}.${t} x)s`).join(' UNION ALL ')})x`));
  const cached={schema:cacheSchema,provenance,tables:cacheHashes};
  writeFileSync(join(out,'server-cache.json'),JSON.stringify(cached,null,2)+'\n');
  writeFileSync('docs/snapshots/6490/server-cache.json',JSON.stringify(cached,null,2)+'\n');
  console.log(JSON.stringify({phase:'server-snapshot-ready',schema:cacheSchema,tables:tables.length,sourceParityVerified:true}));
 }else if(mode==='seal'){
  const reportFile='docs/snapshots/6490/capture-coverage.json',callFile=join(out,'captured-calls.ndjson');
  const coverage=JSON.parse(readFileSync(reportFile));
  if(statSync(callFile).mtimeMs>statSync(reportFile).mtimeMs)throw new Error('Capture still changing or stale coverage report');
  let count=0,writers=0,applied=0;const hash=createHash('sha256');
  for await(const line of createInterface({input:createReadStream(callFile),crlfDelay:Infinity})){
    hash.update(line+'\n');const call=JSON.parse(line);count++;
    if(call.error)throw new Error('Failed captured RPC');
    if(call.name==='commit_training_date_tick'){writers++;applied+=(call.result?.applied_rider_ids??[]).length;}
  }
  if(writers!==coverage.commits||applied!==coverage.applied)throw new Error('Coverage does not match captured workload');
  const seal={status:coverage.summary.failed===0&&coverage.failures===0&&coverage.coverage.pending===0&&coverage.coverage.partial===0?'COMPLETED':'INCOMPLETE',
    sha256:hash.digest('hex'),callCount:count,writerCalls:writers,applied,coverage:coverage.coverage,
    preparedSnapshotSha256:checksum(join(out,'prepared-snapshot.json'))};
  if(statSync(callFile).mtimeMs>statSync(reportFile).mtimeMs)throw new Error('Capture changed while sealing');
  writeFileSync(join(out,'capture-complete.json'),JSON.stringify(seal,null,2)+'\n');
  console.log(JSON.stringify(seal));if(seal.status!=='COMPLETED')process.exitCode=1;
 }else if(['restore','restore-local','restore-final'].includes(mode)){
  const manifest=JSON.parse(readFileSync(join(out,'snapshot-complete.json')));
  for(const file of manifest.files)if(checksum(join(out,file.name))!==file.sha256)throw new Error('Backup hash mismatch');
  const metadata=JSON.parse(readFileSync(join(out,'original-metadata.json')));
  const cachedExists=query(`SELECT to_regnamespace('${cacheSchema}') IS NOT NULL`)==='t';
  const expectedProvenance='6490 original snapshot '+checksum(join(out,'snapshot-complete.json'));
  const ownedCache=cachedExists&&query(`SELECT obj_description(oid,'pg_namespace') FROM pg_namespace WHERE nspname='${cacheSchema}'`)===expectedProvenance;
  let useCache=false;
  if(mode!=='restore-local'&&ownedCache&&existsSync(join(out,'server-cache.json'))){
    try{
      const cached=JSON.parse(readFileSync(join(out,'server-cache.json')));
      if(cached.schema===cacheSchema&&cached.provenance===expectedProvenance){
        const actual=JSON.parse(query(`SELECT jsonb_agg(x ORDER BY name) FROM(${tables.map(t=>`SELECT '${t}' name,count(*) rows,md5(string_agg(h,'' ORDER BY h)) hash FROM(SELECT md5(to_jsonb(x)::text)h FROM ${cacheSchema}.${t} x)s`).join(' UNION ALL ')})x`));
        useCache=JSON.stringify(actual)===JSON.stringify(cached.tables);
      }
    }catch{
      // Recovery fallback: a missing/unreadable cache manifest never blocks the verified local backup.
      console.log(JSON.stringify({phase:'restore-local-fallback',reason:'server-cache-unavailable'}));
    }
  }
  const restoreSql=`SET LOCAL session_replication_role=replica; SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='30min';\nDROP INDEX IF EXISTS public.idx_training_day_runs_report_riders;\n`+
    keyTables(metadata.keys)+
    tables.map(t=>`DELETE FROM public.${t} WHERE ${scope(t)};\n`+(useCache?`INSERT INTO public.${t} SELECT * FROM ${cacheSchema}.${t};\n`:
      `\\copy public.${t} FROM ${literal(join(out,t+'.copy').replaceAll('\\','/'))} WITH (FORMAT binary)\n`)).join('\n')+
    metadata.index.definition+';\n'+metadata.functions.map(f=>f.definition+';').join('\n')+'\n'+
    ['pg_walinspect','pgstattuple'].filter(e=>!metadata.extensions.some(x=>x.name===e)).map(e=>`DROP EXTENSION IF EXISTS ${e};`).join('\n')+
    `\nDO $$ BEGIN IF (SELECT jsonb_agg(x ORDER BY name) FROM(${relationSql})x) IS DISTINCT FROM ${literal(JSON.stringify(manifest.tables))}::jsonb
      THEN RAISE EXCEPTION 'Restored data mismatch before commit';END IF;END $$;`;
  writeFileSync(join(out,'restore.sql'),restoreSql);
  console.log(JSON.stringify({phase:'restore-original',tables:tables.length,source:useCache?'verified-server-snapshot':'verified-local-copy'}));
  native('psql',['-X','-w','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','--single-transaction',
    '-f',join(out,'restore.sql')],undefined,3600000);
  const restoredTables=fingerprint();
  if(JSON.stringify(restoredTables)!==JSON.stringify(manifest.tables))throw new Error('Restored data fingerprint mismatch');
  const index=JSON.parse(query("SELECT jsonb_build_object('definition',pg_get_indexdef(c.oid),'options',c.reloptions,'valid',i.indisvalid,'ready',i.indisready) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid=to_regclass('public.idx_training_day_runs_report_riders')"));
  if(!index.valid||!index.ready||index.definition!==metadata.index.definition||JSON.stringify(index.options)!==JSON.stringify(metadata.index.options))throw new Error('Index restoration mismatch');
  const checks=JSON.parse(query(`SELECT jsonb_build_object('extensions',(SELECT coalesce(jsonb_agg(extname ORDER BY extname),'[]') FROM pg_extension WHERE extname IN('pg_walinspect','pgstattuple')),'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('commit_training_date_tick','register_training_date_work')))`));
  if(JSON.stringify(checks.functions)!==JSON.stringify([...metadata.functions].sort((a,b)=>a.name.localeCompare(b.name))))throw new Error('Function restoration mismatch');
  if(JSON.stringify(checks.extensions)!==JSON.stringify(metadata.extensions.map(x=>x.name).sort()))throw new Error('Extension cleanup mismatch');
  if(mode==='restore-final'&&cachedExists){
    if(!ownedCache)throw new Error('Refusing to remove an unowned snapshot schema');
    // RESTRICT intentionally stops if anyone introduced unexpected dependencies or objects.
    query(`BEGIN;${tables.map(t=>`DROP TABLE ${cacheSchema}.${t} RESTRICT;`).join('\n')}DROP SCHEMA ${cacheSchema} RESTRICT;COMMIT;`);
    if(query(`SELECT to_regnamespace('${cacheSchema}') IS NULL`)!=='t')throw new Error('Snapshot schema cleanup failed');
  }
  if((await assertIsolation()).status!=='ISOLATED')throw new Error('Post-restoration isolation failed');
  writeFileSync('docs/snapshots/6490/restoration.json',JSON.stringify({observedAt:new Date().toISOString(),dataHashesMatch:true,tables:restoredTables,index,functionsRestored:true,extensionsRestored:true,measurementSnapshotRetained:cachedExists&&mode!=='restore-final'},null,2)+'\n');
  console.log(JSON.stringify({phase:'restored',dataHashesMatch:true,indexValid:true,indexDefinitionMatches:true,extensionsRestored:true,measurementSnapshotRetained:cachedExists&&mode!=='restore-final'}));
 }else if(mode==='prepare'){
  const manifest=JSON.parse(readFileSync(join(out,'snapshot-complete.json')));
  if(JSON.stringify(fingerprint())!==JSON.stringify(manifest.tables))throw new Error('Original snapshot no longer matches');
  // Reuse dead-row space between repetitions; maintenance stays outside measurement.
  console.log(JSON.stringify({phase:'prepare-vacuum',tables:tables.length}));
  query(`VACUUM (ANALYZE) ${tables.map(t=>'public.'+t).join(',')}`,600000);
  const source=readFileSync('database/2026-10-10-6439-training-follows-rider.sql','utf8');
  if((source.match(/^(?:REVOKE|GRANT) [^\n]+;\r?$/gm)??[]).length!==4)throw new Error('Unexpected source permissions statements');
  // Keep existing staging ACLs unchanged; CREATE OR REPLACE preserves them.
  const sql=source.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'').replace(/^(?:REVOKE|GRANT) [^\n]+;\r?$/gm,'');
  const condColumns=JSON.parse(query("SELECT jsonb_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.rider_condition'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'rider_id'"));
  query(`BEGIN;SET LOCAL lock_timeout='15s';CREATE EXTENSION IF NOT EXISTS pg_walinspect WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pgstattuple WITH SCHEMA extensions;${sql}
    CREATE TEMP TABLE replay_teams AS SELECT team_id,season_id,expected_rider_ids,opening_conditions FROM public.training_date_work WHERE tick_date='2026-10-04';
    CREATE TEMP TABLE replay_riders AS SELECT DISTINCT unnest(expected_rider_ids) rider_id FROM replay_teams;
    UPDATE public.rider_condition c SET ${condColumns.map(k=>`"${k}"=opening."${k}"`).join(',')}
      FROM replay_teams w CROSS JOIN LATERAL jsonb_each(w.opening_conditions) x
      CROSS JOIN LATERAL jsonb_populate_record(NULL::public.rider_condition,x.value) opening WHERE c.rider_id=x.key::uuid
        AND c.rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.training_rider_ticks WHERE tick_date>='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.training_condition_settlements WHERE tick_date>='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.rider_training_scores WHERE tick_date>='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.rider_derived_ability_history WHERE snapshot_date>='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.rider_ability_race_day_history WHERE snapshot_date>='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    DELETE FROM public.training_day_runs WHERE tick_date>='2026-10-04' AND team_id IN(SELECT team_id FROM replay_teams);
    DELETE FROM public.training_date_work WHERE tick_date>'2026-10-04' AND team_id IN(SELECT team_id FROM replay_teams);
    DELETE FROM public.training_condition_timeout_outbox WHERE tick_date>='2026-10-04' AND team_id IN(SELECT team_id FROM replay_teams);
    UPDATE public.training_race_loads SET consumed_at=NULL WHERE tick_date='2026-10-04' AND rider_id IN(SELECT rider_id FROM replay_riders);
    UPDATE public.training_date_work SET status='pending',missing_evidence='[]' WHERE tick_date='2026-10-04';
    COMMIT;`);
  const verified=JSON.parse(query("SELECT jsonb_object_agg(proname,md5(replace(pg_get_functiondef(p.oid),chr(13),''))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('commit_training_date_tick','register_training_date_work')"));
  if(verified.commit_training_date_tick!=='8b18fdfc29e0ea02fc62ab7847d45130'||verified.register_training_date_work!=='475ac007ef939d147b3ca40db3ca400f')throw new Error('Prepared writer differs from production');
  const prepared={date:'2026-10-04',functions:verified,tables:fingerprint(),sourceSha256:checksum('database/2026-10-10-6439-training-follows-rider.sql')};
  const preparedFile=join(out,'prepared-snapshot.json');
  if(existsSync(preparedFile)&&readFileSync(preparedFile,'utf8')!==JSON.stringify(prepared,null,2)+'\n')throw new Error('Prepared snapshot differs from first preparation');
  writeFileSync(preparedFile,JSON.stringify(prepared,null,2)+'\n');
  console.log(JSON.stringify({phase:'prepared',functionsMatchProduction:true,date:'2026-10-04'}));
 }else if(mode==='capture'){
  if(JSON.stringify(fingerprint())!==JSON.stringify(JSON.parse(readFileSync(join(out,'prepared-snapshot.json'))).tables))throw new Error('Prepared snapshot changed before capture');
  const require=createRequire(resolve('backend/package.json'));
  const {createClient}=require('@supabase/supabase-js');
  const {runNormalizedTrainingDateSweep}=await import('../../backend/lib/trainingDateClose.js');
  const {loadTrainingDateContext}=await import('../../backend/lib/trainingDateReadiness.js');
  const {runTeamTrainingDay}=await import('../../backend/lib/dailyTrainingEngine.js');
  const {loadDayCloseSpans}=await import('../../backend/lib/trainingDayCloseTrigger.js');
  const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const callFile=join(out,'captured-calls.ndjson');
  if(existsSync(callFile))throw new Error('Refusing to overwrite captured workload');
  const rpc=client.rpc.bind(client);let commits=0,applied=0,failures=0;
  client.rpc=(name,args,opts)=>{
    if(!['commit_training_date_tick','register_training_date_work','quarantine_training_date_riders'].includes(name))return rpc(name,args,opts);
    return rpc(name,args,opts).then(result=>{
      appendFileSync(callFile,JSON.stringify({name,args,result:result.data,error:result.error?.code??null})+'\n');
      if(result.error)failures++;
      if(name==='commit_training_date_tick'){commits++;applied+=(result.data?.applied_rider_ids??[]).length;if(commits%25===0)console.log(JSON.stringify({phase:'capture',commits,applied,failures}));}
      return result;
    });
  };
  const {data:season,error}=await client.from('seasons').select('id,number,start_date,end_date').eq('status','active').single();
  if(error)throw new Error('Active season unavailable');
  const errors=[];
  const keys=JSON.parse(readFileSync(join(out,'original-metadata.json'))).keys;
  const capturedTeams=new Set(keys.teams);
  const result=await runNormalizedTrainingDateSweep({supabase:client,now:new Date('2026-10-04T21:00:00Z'),runDay:runTeamTrainingDay,
    loadDaySpans:loadDayCloseSpans,teamConcurrency:4,
    loadIndex:async()=>({today:'2026-10-04',activeSeasonId:season.id,jobs:[{season,tickDate:'2026-10-04'}]}),
    loadContext:async args=>{const context=await loadTrainingDateContext(args);return {...context,teams:context.teams.filter(t=>capturedTeams.has(t.id))};},
    dispatchAlarms:async()=>({disabledForMeasurement:true}),refreshRankings:async()=>{},
    logger:{error:(_label,_id,message)=>{errors.push(String(message).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<id>'));}},
  });
  const coverage=JSON.parse(query("SELECT jsonb_build_object('teams',count(*),'roster_entries',sum(cardinality(expected_rider_ids)),'quarantined',sum(cardinality(quarantined_rider_ids)),'complete',count(*) FILTER(WHERE status='complete'),'needs_reconciliation',count(*) FILTER(WHERE status='needs_reconciliation'),'partial',count(*) FILTER(WHERE status='partial'),'pending',count(*) FILTER(WHERE status='pending'),'rider_ticks',(SELECT count(*) FROM training_rider_ticks WHERE tick_date='2026-10-04')) FROM training_date_work WHERE tick_date='2026-10-04'"));
  const report={date:'2026-10-04',captureOnly:true,commits,applied,failures,coverage,summary:{planned:result.planned,swept:result.swept,failed:result.failed,pending:result.pending,quarantined:result.quarantined},errors:[...new Set(errors)]};
  writeFileSync('docs/snapshots/6490/capture-coverage.json',JSON.stringify(report,null,2)+'\n');
  const lines=readFileSync(callFile,'utf8').trim().split('\n');
  const seal={status:result.failed===0&&failures===0&&coverage.pending===0&&coverage.partial===0?'COMPLETED':'INCOMPLETE',
    sha256:checksum(callFile),callCount:lines.length,writerCalls:commits,applied,coverage,
    preparedSnapshotSha256:checksum(join(out,'prepared-snapshot.json'))};
  writeFileSync(join(out,'capture-complete.json'),JSON.stringify(seal,null,2)+'\n');
  if(seal.status!=='COMPLETED')process.exitCode=1;
  console.log(JSON.stringify(report));
 }else{
  console.log(JSON.stringify({phase:'snapshot-before-hashes',tables:tables.length}));
  const before=fingerprint();
  const metadata=JSON.parse(query(`BEGIN READ ONLY;SELECT jsonb_build_object(
    'created_at',clock_timestamp(),'target','${STAGING_REF}',
    'keys',jsonb_build_object('teams',(SELECT jsonb_agg(DISTINCT team_id ORDER BY team_id) FROM training_date_work WHERE tick_date='2026-10-04'),'riders',(SELECT jsonb_agg(DISTINCT rider ORDER BY rider) FROM training_date_work CROSS JOIN LATERAL unnest(expected_rider_ids) rider WHERE tick_date='2026-10-04')),
    'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('commit_training_date_tick','register_training_date_work')),
    'index',(SELECT jsonb_build_object('definition',pg_get_indexdef(c.oid),'options',c.reloptions,'valid',i.indisvalid,'ready',i.indisready) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid=to_regclass('public.idx_training_day_runs_report_riders')),
    'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'schema',extnamespace::regnamespace::text,'version',extversion)),'[]') FROM pg_extension WHERE extname IN('pg_walinspect','pgstattuple')));ROLLBACK;`));
  writeFileSync(join(out,'original-metadata.json'),JSON.stringify(metadata,null,2)+'\n');
  const files=[];
  for(const table of tables){
    console.log(JSON.stringify({phase:'snapshot-scoped-copy',table}));
    const name=table+'.copy',file=join(out,name);
    query(`BEGIN READ ONLY;\n\\copy (SELECT * FROM public.${table} WHERE ${scope(table,metadata.keys)}) TO ${literal(file.replaceAll('\\','/'))} WITH (FORMAT binary)\nROLLBACK;`);
    files.push({name,sha256:checksum(file)});
  }
  const after=fingerprint();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Snapshot source changed during dump');
  const manifest={target:STAGING_REF,createdAt:metadata.created_at,tables:before,
    files,
    index:metadata.index,originalExtensions:metadata.extensions};
  writeFileSync(join(out,'snapshot-complete.json'),JSON.stringify(manifest,null,2)+'\n');
  mkdirSync('docs/snapshots/6490',{recursive:true});
  writeFileSync('docs/snapshots/6490/before-snapshot-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({phase:'snapshot-complete',tableCount:before.length,scopedFiles:files.length}));
 }
}catch(error){console.error(JSON.stringify({status:'BLOCKED',message:error.message,phase:error.phase??'snapshot',exit:error.exit??null,code:error.code??null,sqlstate:error.sqlstate??null}));process.exitCode=1;}
