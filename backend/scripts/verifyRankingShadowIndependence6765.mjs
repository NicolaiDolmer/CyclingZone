// Native PG17 harness. Invoke through verifyRankingDeltas6765.mjs --independence.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as after from '../lib/refreshRankingMatviews.js';

const root=resolve(import.meta.dirname,'../..');
const NOW=new Date('2040-01-04T08:00:00Z');
const TOKEN='00000000-0000-4000-8000-000000000001';
const read=name=>readFileSync(join(root,'database',name),'utf8');
const literal=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";

export async function loadFrozenEntry(sourcePath, scratch) {
  assert.ok(sourcePath,'--before-source must point to the pre-edit entry-point source');
  const source=readFileSync(sourcePath,'utf8');
  const shadowSource=readFileSync(join(resolve(sourcePath,'..'),'rankingShadowPass-frozen.ts'),'utf8');
  const shadowTarget=join(scratch,'frozen-shadow.ts');
  const relocate=code=>code.replace(/from (['"])\.\/([^"'\n]+)\1/g,(_match,_quote,file)=>
    'from '+JSON.stringify(pathToFileURL(join(root,'backend/lib',file)).href));
  writeFileSync(shadowTarget,relocate(shadowSource));
  const relocated=source.replace(/from "\.\/([^"\n]+)"/g,(_match,file)=>
    'from '+JSON.stringify(pathToFileURL(file==='rankingShadowPass.ts'?shadowTarget:join(root,'backend/lib',file)).href));
  const target=join(scratch,'frozen-entry.mjs');
  writeFileSync(target,relocated);
  return {entry:await import(pathToFileURL(target).href),sha256:createHash('sha256').update(source).digest('hex'),shadowSha256:createHash('sha256').update(shadowSource).digest('hex')};
}

export async function verifyIndependence({sql,definitions,names,tables,refresh,dir}) {
  const sourceArg=process.argv.find(a=>a.startsWith('--before-source='));
  const frozen=await loadFrozenEntry(sourceArg?.slice('--before-source='.length),dir);
  for(const name of ['2026-10-23-6765-ranking-shadow-contrib-transfers.sql','2026-10-31-6765-ranking-shadow-codex-p1-p2.sql']) sql(read(name));
  const seed=read('2026-11-10-6765-ranking-shadow-decoupled.sql');
  sql(seed);sql(seed);
  assert.equal(sql("SELECT value #>> '{}' FROM app_config WHERE key='ranking_shadow_decoupled_6765'"),'off');
  sql("CREATE TABLE ranking_refresh_work_state(matview_group text,lease_token uuid,leased_version bigint,lease_expires_at timestamptz,requested_version bigint,completed_version bigint); INSERT INTO ranking_refresh_work_state VALUES('ranking',NULL,NULL,NULL,8,7);");
  function drain() {
    for(let i=0;i<100;i++) if(JSON.parse(sql('SELECT apply_ranking_deltas(200);')).pending===false) return;
    assert.fail('bounded backfill did not drain');
  }
  drain();
  const parity=(legacyToo)=>names.map((name,i)=>{
    const source=definitions[i],shadow='SELECT * FROM '+tables[i],legacy='SELECT * FROM '+name;
    const difference=(a,b)=>Number(sql('SELECT count(*) FROM (('+a+' EXCEPT ALL '+b+') UNION ALL ('+b+' EXCEPT ALL '+a+')) d;'));
    const result={name,shadow_source:difference(shadow,source),...(legacyToo?{legacy_source:difference(legacy,source),shadow_legacy:difference(shadow,legacy)}:{})};
    assert.equal(result.shadow_source,0,name+' shadow/source');
    if(legacyToo){assert.equal(result.legacy_source,0,name+' legacy/source');assert.equal(result.shadow_legacy,0,name+' shadow/legacy');}
    return result;
  });
  const options={now:NOW,nowFn:()=>NOW,testNowFn:()=>NOW,clock:()=>0,tokenFn:()=>TOKEN,logger:{info(){},warn(){},log(){}}};
  function client({mode='success',flag='off',batchClockStep=0}={}) {
    let completed=7,elapsed=0,publicationMs=null;
    let started=performance.now();
    const trace=[],captures=[],logs=[];
    sql("UPDATE app_config SET value="+literal(JSON.stringify(flag))+"::jsonb WHERE key='ranking_shadow_decoupled_6765'; UPDATE ranking_refresh_work_state SET requested_version=8,completed_version=7,lease_token=NULL,leased_version=NULL,lease_expires_at=NULL;");
    const c={
      from:table=>({select:()=>({
        eq:(_column,key)=>({maybeSingle:async()=>({data:JSON.parse(sql("SELECT coalesce((SELECT json_build_object('value',value) FROM app_config WHERE key="+literal(key)+"),'null'::json);")),error:null})}),
        in(){return this;},
        limit:async()=>({data:table==='training_date_work'&&mode==='deferred'?[{status:'pending'}]:[],error:null}),
      })}),
      rpc:async(name,args={})=>{
        trace.push({name,args});
        if(name==='get_ranking_refresh_work_state') return {data:{pending:completed<8,pending_age_ms:0,last_completed_at:null},error:null};
        if(name==='claim_ranking_refresh_work') {
          if(mode==='cooldown') return {data:{status:'cooldown'},error:null};
          sql('UPDATE ranking_refresh_work_state SET lease_token='+literal(args.p_token)+"::uuid,leased_version=8,lease_expires_at='infinity';");
          return {data:{status:'claimed',token:args.p_token,target_version:'8'},error:null};
        }
        if(name==='renew_ranking_refresh_work') return {data:sql('SELECT coalesce(lease_token='+literal(args.p_token)+'::uuid AND lease_expires_at>clock_timestamp(),false) FROM ranking_refresh_work_state;')==='t',error:null};
        if(name==='finish_ranking_refresh_work') {
          if(args.p_success) {completed=8;sql('UPDATE ranking_refresh_work_state SET completed_version=8;');publicationMs=+(performance.now()-started).toFixed(2);}
          sql('UPDATE ranking_refresh_work_state SET lease_token=NULL,leased_version=NULL,lease_expires_at=NULL;');
          return {data:true,error:null};
        }
        try {
          if(name.startsWith('refresh_')) {
            if(mode==='failure'||mode==='timeout') return {data:null,error:{message:mode==='timeout'?'canceling statement due to statement timeout':'injected legacy failure'}};
            if(name!=='refresh_global_rank_mv') sql('REFRESH MATERIALIZED VIEW CONCURRENTLY '+name.replace(/^refresh_/,'')+';');
            return {data:null,error:null};
          }
          const cast={p_max_items:'int',p_owner_token:'uuid',p_target_version:'bigint',p_now:'timestamptz'};
          if(name==='apply_ranking_deltas') elapsed+=batchClockStep;
          assert.ok(['get_ranking_shadow_metrics','apply_ranking_deltas','check_ranking_shadow_parity'].includes(name));
          const keys=Object.keys(args);
          for(const key of keys) assert.ok(cast[key],'known RPC argument');
          const data=JSON.parse(sql('SELECT '+name+'('+keys.map(k=>k+' => '+literal(args[k])+'::'+cast[k]).join(',')+');'));
          return {data,error:null};
        } catch(error) {return {data:null,error:{message:error.message}};}
      },
    };
    return {c,trace,captures,logs,start(){started=performance.now();},get completed(){return completed;},get publicationMs(){return publicationMs;},options:{...options,clock:()=>elapsed,logger:{info:(_m,d)=>logs.push(d)},captureExceptionFn:(e,context)=>captures.push({message:e.message,context})}};
  }
  sql('CREATE TABLE fixture_original6765 AS SELECT id,points_earned FROM race_results WHERE race_id=fid(100004);');
  const measurements=[];
  for(const mode of ['success','success','success','failure','timeout','cooldown','deferred']) {
    for(const [label,entry,flag] of [['before',frozen.entry,'on'],['after',after,'on']]) {
      sql(refresh);drain();
      const f=client({mode,flag});
      sql('UPDATE race_results SET points_earned=coalesce(points_earned,0)+1 WHERE race_id=fid(100004);');
      const opts=mode==='deferred'?{...f.options,now:new Date('2040-01-04T19:30:00Z')}:f.options;
      const started=performance.now();f.start();
      const result=mode==='success'||mode==='failure'||mode==='timeout'
        ?await entry.refreshRankingMatviewsSafe(f.c,opts):await entry.refreshRankingMatviewsGated(f.c,opts);
      const passMs=+(performance.now()-started).toFixed(2);
      const applies=f.trace.filter(c=>c.name==='apply_ranking_deltas').length;
      const remaining=Number(sql('SELECT count(*) FROM ranking_dirty_log;'));
      assert.equal(result,mode==='success'?true:mode==='cooldown'?'cooldown':mode==='deferred'?'deferred':false);
      assert.equal(f.completed,mode==='success'?8:7,'shadow does not acknowledge legacy failure/deferral');
      assert.equal(remaining,0);assert.equal(applies,1);parity(mode==='success');
      if(label==='after') assert.ok(f.trace.filter(c=>c.name==='apply_ranking_deltas').every(c=>c.args.p_owner_token===null&&c.args.p_target_version===null));
      if(mode==='success') assert.equal(f.trace.findIndex(c=>c.name==='apply_ranking_deltas')>f.trace.findIndex(c=>c.name==='finish_ranking_refresh_work'),label==='after');
      measurements.push({phase:label,mode,pass_ms:passMs,publication_ms:f.publicationMs,applies,remaining,completed:f.completed});
      drain();
      sql('UPDATE race_results r SET points_earned=b.points_earned FROM fixture_original6765 b WHERE r.id=b.id;');
      drain();sql(refresh);
    }
  }
  // OFF trace comparison uses frozen source, not the new default path.
  for(const mode of ['success','failure','cooldown','deferred']) {
    const before=client({mode}),current=client({mode});
    const opts=mode==='deferred'?{...options,now:new Date('2040-01-04T19:30:00Z')}:options;
    const invoke=(entry,f)=>mode==='success'||mode==='failure'?entry.refreshRankingMatviewsSafe(f.c,opts):entry.refreshRankingMatviewsGated(f.c,opts);
    assert.equal(await invoke(frozen.entry,before),await invoke(after,current));
    const normalized=trace=>{
      const token=trace.find(c=>c.name==='claim_ranking_refresh_work')?.args.p_token;
      return token?JSON.parse(JSON.stringify(trace).replaceAll(token,'<claim-token>')):trace;
    };
    assert.deepEqual(normalized(current.trace),normalized(before.trace),'OFF RPC arguments/order match frozen source: '+mode);
  }
  const burst=client({flag:'on',batchClockStep:5000});
  sql("INSERT INTO ranking_dirty_log(kind,race_id) SELECT 'race',id FROM races ORDER BY id LIMIT 450;");
  assert.equal(await after.refreshRankingMatviewsSafe(burst.c,burst.options),true);
  assert.equal(burst.trace.filter(c=>c.name==='apply_ranking_deltas').length,1);
  assert.equal(Number(sql('SELECT count(*) FROM ranking_dirty_log;')),250);
  assert.equal(burst.logs[0].version_drained,undefined);
  assert.equal(burst.logs[0].status,'pending');
  assert.equal(burst.completed,8,'publication is complete while shadow backlog remains');
  const recovery=client({flag:'on'});
  assert.equal(await after.refreshRankingMatviewsSafe(recovery.c,recovery.options),true);
  assert.equal(Number(sql('SELECT count(*) FROM ranking_dirty_log;')),0);
  sql("UPDATE app_config SET value='\"on\"'::jsonb WHERE key='ranking_shadow_decoupled_6765';");sql(seed);
  assert.equal(sql("SELECT value #>> '{}' FROM app_config WHERE key='ranking_shadow_decoupled_6765'"),'on','seed replay preserves existing choice');
  sql(refresh);drain();
  const report={rows:Number(sql('SELECT count(*) FROM race_results')),clock:NOW.toISOString(),frozen_sha256:frozen.sha256,frozen_shadow_sha256:frozen.shadowSha256,measurements,unleased_drain:{items:450,first_pass_batches:1,remaining_after_publication:250,recovery_batches:recovery.trace.filter(c=>c.name==='apply_ranking_deltas').length},parity:parity(true)};
  writeFileSync(join(dir,'independence-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
