import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, runBackfill } from './backfillTrainingSeen6490.mjs';
import { STAGING_REF, PROD_REF } from './assertLoadtestIsolation.mjs';

const argv = ['--batch-size','2','--pause-ms','0','--max-batches','3','--out','report.json'];
const env = {
  SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, SUPABASE_SERVICE_KEY: 'fixture-key',
  SUPABASE_DB_URL: `postgresql://postgres:fixture-password@db.${STAGING_REF}.supabase.co:5432/postgres`,
  CZ_TARGET_ENV: 'loadtest-staging', CZ_LOADTEST_WRAPPER: '1',
};
const clean = { unindexed: 0, missing_keys: 0, extra_keys: 0, wrong_counts: 0 };

test('CLI requires explicit bounded inputs and rejects duplicates or unknown flags', () => {
  assert.deepEqual(parseArgs(argv), { batchSize: 2, pauseMs: 0, maxBatches: 3, out: 'report.json' });
  for (const bad of [[], [...argv,'--prod'], [...argv,'--batch-size','1'], argv.map(v=>v==='2'?'1001':v),
    argv.map(v=>v==='0'?'-1':v), argv.slice(0,-2)]) assert.throws(()=>parseArgs(bad), /USAGE/);
});

test('unsafe configuration never reaches network or SQL', async () => {
  for (const bad of [
    { ...env, CZ_LOADTEST_WRAPPER: undefined }, { ...env, SUPABASE_URL: `https://${PROD_REF}.supabase.co` },
    { ...env, SUPABASE_DB_URL: 'postgresql://postgres:secret@evil.example/postgres' },
    { ...env, SUPABASE_DB_URL: env.SUPABASE_DB_URL+'?host=evil.example' },
    { ...env, SUPABASE_DB_URL: env.SUPABASE_DB_URL.replace(/\/postgres$/,'/wrong') },
    { ...env, DISCORD_WEBHOOK_URL: 'must-not-send' },
  ]) {
    let calls=0;
    const result=await runBackfill(argv,bad,{isolation:async()=>{calls++;return {status:'ISOLATED'};},sql:async()=>{calls++;return {};} });
    assert.equal(result.status,'BLOCKED'); assert.equal(calls,0);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('isolation and schema failures block before any backfill write', async () => {
  let writes=0;
  const result=await runBackfill(argv,env,{isolation:async()=>({status:'BLOCKED'}),sql:async()=>{writes++;return {};}});
  assert.equal(result.status,'BLOCKED'); assert.equal(writes,0);
  const missing=await runBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(query:string)=>{
    if(query.includes('backfill_batch(2)')) writes++;
    return {ready:false};
  }});
  assert.equal(missing.status,'BLOCKED'); assert.equal(writes,0);
});

test('zero processed with locked rows never becomes READY at the batch budget', async () => {
  const result=await runBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(query:string)=>
    query.includes('backfill_batch(2)')?{processed:0,remaining:1}:{ready:true},pause:async()=>{}});
  assert.equal(result.status,'BLOCKED'); assert.equal(result.code,'BATCH_BUDGET_EXHAUSTED');
  assert.equal(result.remaining,1); assert.equal(result.batches,3);
});

test('READY requires terminal counts and a full parity check', async () => {
  let batches=0;
  const result=await runBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(query:string)=>{
    if(query.includes('backfill_batch(2)'))return ++batches===1?{processed:2,remaining:1}:{processed:1,remaining:0};
    if(query.includes('FROM public.training_seen_parity()'))return clean;
    return {ready:true};
  },pause:async()=>{}});
  assert.equal(result.status,'READY'); assert.equal(result.processed,3);
  assert.deepEqual(result.parity,clean);
  const bad=await runBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(query:string)=>{
    if(query.includes('backfill_batch(2)'))return {processed:1,remaining:0};
    if(query.includes('FROM public.training_seen_parity()'))return {...clean,missing_keys:1};
    return {ready:true};
  }});
  assert.equal(bad.status,'FAIL');
});

test('unexpected SQL errors and malformed counters are bounded and redact payloads', async () => {
  for(const value of [{processed:-1,remaining:0},{processed:1,remaining:0.5},null]){
    const result=await runBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(query:string)=>{
      if(query.includes('backfill_batch(2)')){ if(value===null)throw new Error('secret rider contents'); return value; }
      return {ready:true};
    }});
    assert.equal(result.status,'FAIL'); assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
