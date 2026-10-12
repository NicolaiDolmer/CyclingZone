// Replay captured real RPC inputs on the verified isolated staging fixture.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {assertIsolation,STAGING_REF,PROD_REF} from '../../backend/scripts/staging/assertLoadtestIsolation.mjs';

const [directory,arm,repeatText]=process.argv.slice(2),repeat=Number(repeatText);
const out=resolve(directory??''),privateRoot=resolve('.codex.local/6490-snapshots');
if(!out.startsWith(privateRoot+'\\')||!['baseline','fastupdate-off','no-gin'].includes(arm)||![1,2,3].includes(repeat))throw new Error('Invalid replay configuration');
if(process.env.CZ_LOADTEST_WRAPPER!=='1'||!process.env.SUPABASE_DB_URL?.includes(STAGING_REF)||process.env.SUPABASE_DB_URL.includes(PROD_REF))throw new Error('Staging wrapper required');
if((await assertIsolation()).status!=='ISOLATED')throw new Error('Staging isolation failed');
const target=new URL(process.env.SUPABASE_DB_URL);
const env={...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',PGUSER:decodeURIComponent(target.username),
 PGPASSWORD:decodeURIComponent(target.password),PGDATABASE:decodeURIComponent(target.pathname.slice(1)),PGSSLMODE:'require',
 PGCONNECT_TIMEOUT:'15',PGAPPNAME:'6490-measured-replay'};
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
class Session{
 constructor(){
  this.buffer='';this.sequence=0;this.ended=false;
  this.child=spawn('psql',['-X','-w','-qAt','-P','pager=off','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.done=new Promise(r=>{this.finishDone=r;});
  const finish=()=>{this.ended=true;this.finishDone();if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Object.assign(new Error('SQL failed'),{sqlstate:this.sqlstate}));this.pending=null;}};
  this.child.on('close',finish);this.child.on('error',finish);this.child.stdin.on('error',finish);
  this.child.stderr.on('data',data=>{const code=/ERROR:\s+([A-Z0-9]{5})/.exec(String(data));if(code)this.sqlstate=code[1];});
  this.child.stdout.on('data',data=>{
   this.buffer+=String(data).replaceAll('\r','');
   if(this.buffer.length>16*1024*1024){this.child.kill();return;}
   if(this.pending&&this.buffer.endsWith(this.pending.marker+'\n')){
    const text=this.buffer.slice(0,-this.pending.marker.length-1).trim();this.buffer='';
    clearTimeout(this.pending.timer);this.pending.resolve(text);this.pending=null;
   }
  });
 }
 query(sql){
  if(this.ended||this.pending)throw new Error('Session unavailable');
  return new Promise((resolve,reject)=>{
   const marker=`__6490_REPLAY_${++this.sequence}__`;
   this.pending={resolve,reject,marker,timer:setTimeout(()=>this.child.kill(),180000)};
   this.child.stdin.write(sql+';\n\\echo '+marker+'\n');
  });
 }
 async close(){if(!this.ended)this.child.kill();await this.done;}
}
const reportPath=`docs/snapshots/6490/${arm}-${repeat}.json`;
if(existsSync(reportPath))throw new Error('Refusing to overwrite trial');
const db=new Session();
const report={arm,repeat,status:'INCOMPLETE',calls:[],attribution:[],walWindows:[],teamDates:[],limitations:[
 'Reconstructed October 4 conditions/receipts; abilities and plans from October 5 staging snapshot.',
 'Database writer replay only; not full evening-close duration or production capacity.',
 'Serial replay, preserving per-team slot order; capture used four concurrent teams. No concurrent-latency claim.',
 'Logical data snapshot verified; cache/checkpoint/physical heap state are not a physical production clone.',
]};
const tables=['rider_derived_abilities','rider_condition','rider_derived_ability_history','rider_ability_race_day_history',
 'rider_training_scores','training_rider_ticks','training_condition_settlements','training_race_loads','training_day_runs','training_date_work','training_condition_timeout_outbox'];
const relationSql=tables.map(t=>`SELECT '${t}' name,count(*) rows,md5(string_agg(h,'' ORDER BY h)) hash FROM(SELECT md5(to_jsonb(t)::text) h FROM public.${t} t)s`).join(' UNION ALL ');
try{
 const prepared=JSON.parse(readFileSync(join(out,'prepared-snapshot.json'))),metadata=JSON.parse(readFileSync(join(out,'original-metadata.json')));
 const seal=JSON.parse(readFileSync(join(out,'capture-complete.json')));
 if(seal.status!=='COMPLETED'||seal.preparedSnapshotSha256!==createHash('sha256').update(readFileSync(join(out,'prepared-snapshot.json'))).digest('hex'))throw new Error('Completed sealed capture required');
 const calls=[],hash=createHash('sha256');
 for await(const line of createInterface({input:createReadStream(join(out,'captured-calls.ndjson')),crlfDelay:Infinity})){
  hash.update(line+'\n');const c=JSON.parse(line);
  if(c.error)throw new Error('Capture contains failed RPC');
  if(!['commit_training_date_tick','register_training_date_work','quarantine_training_date_riders'].includes(c.name)||!metadata.keys.teams.includes(c.args.p_team_id))throw new Error('Unscoped captured RPC');
  calls.push({name:c.name,args:c.args,expected:c.result&&{alreadyRan:c.result.already_ran===true,applied:(c.result.applied_rider_ids??[]).length,appliedIds:[...(c.result.applied_rider_ids??[])].sort(),workStatus:c.result.work_status??null}});
 }
 report.workloadSha256=hash.digest('hex');report.workloadCalls=calls.length;
 if(report.workloadSha256!==seal.sha256||calls.length!==seal.callCount)throw new Error('Sealed workload checksum/count mismatch');
 if(JSON.stringify(JSON.parse(await db.query(`SELECT jsonb_agg(x ORDER BY name) FROM(${relationSql})x`)))!==JSON.stringify(prepared.tables))throw new Error('Prepared snapshot mismatch');
 const functionHashes=JSON.parse(await db.query("SELECT jsonb_object_agg(proname,md5(replace(pg_get_functiondef(p.oid),chr(13),''))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('commit_training_date_tick','register_training_date_work')"));
 if(JSON.stringify(functionHashes)!==JSON.stringify(prepared.functions))throw new Error('Writer version mismatch');
 await db.query("SET pg_stat_statements.track='all';SET statement_timeout='150s';SET lock_timeout='15s'");
 const indexBefore=JSON.parse(await db.query("SELECT jsonb_build_object('definition',pg_get_indexdef(c.oid),'options',c.reloptions,'valid',i.indisvalid,'ready',i.indisready) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid=to_regclass('public.idx_training_day_runs_report_riders')"));
 if(!indexBefore?.valid||!indexBefore.ready||indexBefore.definition!==metadata.index.definition||JSON.stringify(indexBefore.options)!==JSON.stringify(metadata.index.options))throw new Error('Original GIN definition required');
 if(arm==='fastupdate-off')await db.query('ALTER INDEX public.idx_training_day_runs_report_riders SET(fastupdate=off)');
 if(arm==='no-gin')await db.query('DROP INDEX public.idx_training_day_runs_report_riders');
 else await db.query("SELECT pg_catalog.gin_clean_pending_list('public.idx_training_day_runs_report_riders')");
 report.startIndex=arm==='no-gin'?null:JSON.parse(await db.query("SELECT to_jsonb(x) FROM extensions.pgstatginindex('public.idx_training_day_runs_report_riders')x"));
 report.settings=JSON.parse(await db.query("SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN('server_version','shared_buffers','checkpoint_timeout','wal_compression','full_page_writes','synchronous_commit','pg_stat_statements.track')"));
 await db.query('CREATE TEMP TABLE replay_result(data jsonb);GRANT SELECT,INSERT,DELETE ON replay_result TO service_role');
 // One request/commit per RPC avoids multiplying network round trips for instrumentation.
 // The inner EXPLAIN isolates writer WAL; this temporary invoker helper never exists in public.
 await db.query(`CREATE FUNCTION pg_temp.measure6490(statement text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $measure$
 DECLARE measured json; receipt jsonb; start_lsn pg_lsn; transaction_id text;
 BEGIN
  DELETE FROM pg_temp.replay_result;
  transaction_id:=(pg_current_xact_id()::text::bigint%4294967296)::text;
  start_lsn:=pg_current_wal_insert_lsn();
  PERFORM set_config('role','service_role',true);
  EXECUTE statement INTO measured;
  SELECT jsonb_build_object('alreadyRan',coalesce((data->>'already_ran')::boolean,false),
   'applied',jsonb_array_length(coalesce(data->'applied_rider_ids','[]')),
   'appliedIds',coalesce(data->'applied_rider_ids','[]'),'workStatus',data->>'work_status') INTO receipt FROM pg_temp.replay_result;
  RETURN jsonb_build_object('plan',measured->0,'receipt',receipt,'xid',transaction_id,'startLsn',start_lsn,'endLsn',pg_current_wal_insert_lsn());
 END;$measure$`);
 const signatures=JSON.parse(await db.query("SELECT jsonb_object_agg(proname,args) FROM(SELECT p.proname,jsonb_object_agg(p.proargnames[a.i],format_type(p.proargtypes[a.i-1],NULL))args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL generate_series(1,p.pronargs)a(i) WHERE n.nspname='public' AND p.proname IN('commit_training_date_tick','register_training_date_work','quarantine_training_date_riders') GROUP BY p.proname)s"));
 const mapping=JSON.parse(await db.query(`WITH owners AS(SELECT c.oid,c.relname,c.reltoastrelid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'), relations AS(
 SELECT c.oid,c.relname,coalesce(o.relname,t.relname,ti.relname,c.relname) owner_name,
 (t.oid IS NOT NULL OR ti.oid IS NOT NULL) is_toast FROM pg_class c
 LEFT JOIN pg_index i ON i.indexrelid=c.oid LEFT JOIN owners o ON o.oid=coalesce(i.indrelid,c.oid)
 LEFT JOIN owners t ON t.reltoastrelid=c.oid LEFT JOIN owners ti ON ti.reltoastrelid=i.indrelid)
 SELECT jsonb_object_agg(pg_relation_filenode(oid)::text,CASE WHEN relname='idx_training_day_runs_report_riders' THEN 'gin'
 WHEN owner_name='training_day_runs' AND is_toast THEN 'report_toast'
 WHEN owner_name='training_day_runs' THEN 'report_heap_other_indexes'
 WHEN owner_name IN('training_rider_ticks','rider_training_scores','rider_derived_ability_history','rider_ability_race_day_history') THEN owner_name ELSE 'other:'||owner_name END)
 FROM relations WHERE pg_relation_filenode(oid) IS NOT NULL`));
 const aliases=new Map(metadata.keys.teams.map((id,i)=>[id,`T${String(i+1).padStart(3,'0')}`]));
 const argument=(value,type)=>{
  if(!['uuid','text','integer','date','integer[]','uuid[]','jsonb','boolean','timestamp with time zone'].includes(type))throw new Error('Unexpected RPC argument type');
  if(value===null)return `NULL::${type}`;
  if(type.endsWith('[]')){if(!Array.isArray(value))throw new Error('Array required');return `ARRAY[${value.map(literal).join(',')}]::${type}`;}
  return `${literal(type==='jsonb'?JSON.stringify(value):value)}::${type}`;
 };
 let batch=[],batchStart=null;
 const attribute=async end=>{
  if(!batch.length)return;
  const xids=batch.map(x=>x.xid),keys=Object.fromEntries(batch.map(x=>[x.xid,{team:x.team,kind:x.kind}]));
  const data=JSON.parse(await db.query(`WITH blocks AS MATERIALIZED(
    SELECT start_lsn,jsonb_agg(DISTINCT coalesce(${literal(JSON.stringify(mapping))}::jsonb->>relfilenode::text,'unmapped')) categories
    FROM extensions.pg_get_wal_block_info(${literal(batchStart)},${literal(end)},false) WHERE xid::text=ANY(ARRAY[${xids.map(literal)}]) GROUP BY start_lsn),
    records AS(SELECT r.xid::text xid,CASE WHEN b.categories IS NULL THEN 'no_relation'
      WHEN jsonb_array_length(b.categories)=1 THEN b.categories->>0 ELSE 'mixed_relations' END category,
      r.record_length,r.fpi_length FROM extensions.pg_get_wal_records_info(${literal(batchStart)},${literal(end)})r LEFT JOIN blocks b USING(start_lsn)
      WHERE r.xid::text=ANY(ARRAY[${xids.map(literal)}]))
    SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT xid,category,count(*) records,sum(record_length) wal_bytes,sum(fpi_length) fpi_bytes FROM records GROUP BY xid,category)x`));
  report.walWindows.push({start:batchStart,end,xids});
  for(const row of data)report.attribution.push({...row,...keys[row.xid]});
  for(const call of batch){
   const attributed=data.filter(r=>r.xid===call.xid);
   const relationBytes=attributed.filter(r=>r.category!=='no_relation').reduce((n,r)=>n+Number(r.wal_bytes),0);
   const noRelationBytes=attributed.filter(r=>r.category==='no_relation').reduce((n,r)=>n+Number(r.wal_bytes),0);
   call.attributedRelationBytes=relationBytes;call.unassignedWriterBytes=call.walBytes-relationBytes;
   call.transactionRecordBytes=relationBytes+noRelationBytes;
   if(call.unassignedWriterBytes<0||call.unassignedWriterBytes>noRelationBytes)throw new Error('WAL attribution does not reconcile with statement WAL');
  }
  batch=[];batchStart=null;
 };
 for(const [i,c] of calls.entries()){
  const args=Object.entries(c.args).map(([name,value])=>{
   if(!/^p_[a-z_]+$/.test(name)||!Object.hasOwn(signatures[c.name],name))throw new Error('Unknown RPC argument');
   return `${name}=>${argument(value,signatures[c.name][name])}`;
  }).join(',');
  const begin=performance.now();
  const measured=JSON.parse(await db.query(`SELECT pg_temp.measure6490(${literal(`EXPLAIN(ANALYZE,WAL,BUFFERS,FORMAT JSON) INSERT INTO pg_temp.replay_result SELECT public.${c.name}(${args})`)})`));
  const clientMs=performance.now()-begin,plan=measured.plan,result=measured.receipt;
  if(c.name==='commit_training_date_tick'&&(result.alreadyRan!==c.expected.alreadyRan||result.applied!==c.expected.applied||JSON.stringify(result.appliedIds.sort())!==JSON.stringify(c.expected.appliedIds)||result.workStatus!==c.expected.workStatus))throw new Error('Replay receipt differs from capture');
  const row={team:aliases.get(c.args.p_team_id),kind:c.name==='commit_training_date_tick'?'writer':c.name==='register_training_date_work'?'registration':'quarantine',
   day:c.args.p_game_day??null,xid:measured.xid,startLsn:measured.startLsn,endLsnBeforeCommit:measured.endLsn,sqlMs:plan['Execution Time'],clientThroughCommitMs:clientMs,
   walBytes:plan.Plan['WAL Bytes']??0,walRecords:plan.Plan['WAL Records']??0,walFpi:plan.Plan['WAL FPI']??0,applied:result.applied,alreadyRan:result.alreadyRan};
  report.calls.push(row);batchStart??=measured.startLsn;batch.push(row);
  if(batch.length>=20||i===calls.length-1)await attribute(await db.query('SELECT pg_current_wal_insert_lsn()'));
  if((i+1)%100===0){writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({arm,repeat,processed:i+1,total:calls.length}));}
 }
 if(arm!=='no-gin'){
  report.endIndexBeforeDrain=JSON.parse(await db.query("SELECT to_jsonb(x) FROM extensions.pgstatginindex('public.idx_training_day_runs_report_riders')x"));
  await db.query('BEGIN');
  const start=JSON.parse(await db.query("SELECT jsonb_build_object('xid',(pg_current_xact_id()::text::bigint%4294967296)::text,'lsn',pg_current_wal_insert_lsn())"));
  const begin=performance.now();
  const plan=JSON.parse(await db.query("EXPLAIN(ANALYZE,WAL,BUFFERS,FORMAT JSON) SELECT pg_catalog.gin_clean_pending_list('public.idx_training_day_runs_report_riders')"))[0];
  await db.query('COMMIT');
  report.deferredCleanup={kind:'gin_cleanup',team:null,xid:start.xid,sqlMs:plan['Execution Time'],clientThroughCommitMs:performance.now()-begin,
   walBytes:plan.Plan['WAL Bytes']??0,walRecords:plan.Plan['WAL Records']??0,walFpi:plan.Plan['WAL FPI']??0};
  const end=await db.query('SELECT pg_current_wal_insert_lsn()');
  batchStart=start.lsn;batch=[report.deferredCleanup];await attribute(end);
  report.endIndexAfterDrain=JSON.parse(await db.query("SELECT to_jsonb(x) FROM extensions.pgstatginindex('public.idx_training_day_runs_report_riders')x"));
 }
 const teams=new Map();for(const call of report.calls.filter(c=>c.kind==='writer')){
  const t=teams.get(call.team)??{team:call.team,date:'2026-10-04',calls:0,applied:0,walBytes:0,sqlMs:0,clientThroughCommitMs:0};
  for(const key of ['applied','walBytes','sqlMs','clientThroughCommitMs'])t[key]+=call[key];t.calls++;teams.set(call.team,t);
 }
 report.teamDates=[...teams.values()];
 const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {count:a.length,p50:a[Math.max(0,Math.ceil(a.length*.5)-1)]??null,p95:a[Math.max(0,Math.ceil(a.length*.95)-1)]??null,max:a.at(-1)??null};};
 report.duration={appliedWriterSqlMs:stats(report.calls.filter(c=>c.kind==='writer'&&c.applied>0).map(c=>c.sqlMs)),allWriterSqlMs:stats(report.calls.filter(c=>c.kind==='writer').map(c=>c.sqlMs)),teamDateSqlMs:stats(report.teamDates.map(t=>t.sqlMs))};
 report.status='COMPLETED';
}catch(error){report.status='FAILED';report.error={message:error.message,sqlstate:error.sqlstate??null};process.exitCode=1;}
finally{await db.close();writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({arm,repeat,status:report.status,calls:report.calls.length,duration:report.duration,error:report.error}));
