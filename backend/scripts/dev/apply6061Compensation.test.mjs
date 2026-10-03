import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateApprovedFile,parseApplyArgs,runCompensation} from './apply6061Compensation.mjs';
const raw=JSON.stringify({issue:6061,policy:'current_plans_current_engine',through:'2026-10-02',summary:{riders:1,rider_days:1},plans:[{rider_id:'r',days:[{}]}]});
const hash=createHash('sha256').update(raw).digest('hex');
test('exact file bytes and a closed cutoff are required',()=>{
 assert.equal(validateApprovedFile(raw,hash,'2026-10-03T13:00:00Z').summary.rider_days,1);
 assert.throws(()=>validateApprovedFile(raw+' ',hash,'2026-10-03T13:00:00Z'),/hash/);
 assert.throws(()=>validateApprovedFile(raw,hash,'2026-10-02T13:00:00Z'),/closed/);
});
test('apply requires a separate explicit production authorization',()=>{
 assert.equal(parseApplyArgs(['--plan=p','--approved-hash='+hash]).apply,false);
 assert.throws(()=>parseApplyArgs(['--plan=p','--approved-hash='+hash,'--apply']),/owner-go/);
 assert.throws(()=>parseApplyArgs(['--plan=p','--approved-hash='+hash,'--surprise']),/Unknown/);
});
test('default run cannot invoke a mutation and returns only anonymous counts',async()=>{
 const db={rpc(){throw new Error('write attempted');}};
 assert.deepEqual(await runCompensation({supabase:db,raw,hash,now:'2026-10-03T13:00:00Z',apply:false}),{dry_run:true,riders:1,rider_days:1,approved_hash:hash});
});
test('authorized apply passes unchanged bytes, hash and injected clock to the atomic RPC',async()=>{
 let seen;const db={rpc:async(name,args)=>{seen={name,args};return {data:{rider_days:1},error:null};}};
 const result=await runCompensation({supabase:db,raw,hash,now:'2026-10-03T13:00:00Z',apply:true,ownerGo:true});
 assert.equal(result.rider_days,1);assert.equal(seen.name,'apply_training_compensation_6061');
 assert.equal(seen.args.p_plan_text,raw);assert.equal(seen.args.p_approved_hash,hash);
});
test('RPC failure is surfaced without emitting private payload',async()=>{
 await assert.rejects(runCompensation({supabase:{rpc:async()=>({error:{message:'conflict'}})},raw,hash,now:'2026-10-03T13:00:00Z',apply:true,ownerGo:true}),/Atomic compensation failed/);
});
