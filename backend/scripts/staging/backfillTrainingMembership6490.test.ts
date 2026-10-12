import test from 'node:test';
import assert from 'node:assert/strict';
import {runMembershipBackfill} from './backfillTrainingMembership6490.mjs';
import {STAGING_REF,PROD_REF} from './assertLoadtestIsolation.mjs';
const argv=['--batch-size','2','--pause-ms','0','--max-batches','2','--out','report.json'];
const env={SUPABASE_URL:`https://${STAGING_REF}.supabase.co`,SUPABASE_SERVICE_KEY:'fixture',
  SUPABASE_DB_URL:`postgresql://postgres:fixture@db.${STAGING_REF}.supabase.co:5432/postgres`,
  CZ_TARGET_ENV:'loadtest-staging',CZ_LOADTEST_WRAPPER:'1'};
test('membership runner rejects unsafe targets before any connection',async()=>{
  for(const change of [{CZ_LOADTEST_WRAPPER:''},{SUPABASE_URL:`https://${PROD_REF}.supabase.co`},
    {SUPABASE_DB_URL:env.SUPABASE_DB_URL+'?host=wrong'},{DISCORD_WEBHOOK_URL:'forbidden'}]){
    let calls=0;const result=await runMembershipBackfill(argv,{...env,...change},{isolation:async()=>{calls++;return{};},sql:async()=>{calls++;}});
    assert.equal(result.status,'BLOCKED');assert.equal(calls,0);
  }
});
test('membership READY uses only its pinned functions and full pair-parity fields',async()=>{
  for(const p of [{unindexed:0,missing_refs:0,extra_refs:0},{unindexed:0,missing_refs:1,extra_refs:1},
    {unindexed:0,missing_keys:0,extra_keys:0,wrong_counts:0}]){
    const queries:string[]=[];
    const result=await runMembershipBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async(q:string)=>{
      queries.push(q);if(q.includes('backfill_batch(2)'))return{processed:1,remaining:0};
      return q.includes('row_to_json(p)')?p:{ready:true};
    }});
    assert.equal(result.status,'missing_refs' in p&&p.missing_refs===0?'READY':'FAIL');
    assert.ok(queries.every(q=>!q.includes('training_seen_')));assert.match(queries[0],/training_membership_assert_contract/);
  }
});
test('locked-only batch remains blocked and transport failures reveal no data',async()=>{
  const result=await runMembershipBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),pause:async()=>{},
    sql:async(q:string)=>q.includes('backfill_batch(2)')?{processed:0,remaining:1}:{ready:true}});
  assert.equal(result.code,'BATCH_BUDGET_EXHAUSTED');
  const failed=await runMembershipBackfill(argv,env,{isolation:async()=>({status:'ISOLATED'}),sql:async()=>{throw new Error('private payload');}});
  assert.equal(failed.status,'BLOCKED');assert.doesNotMatch(JSON.stringify(failed),/private/);
});
