import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateApprovedFile,parseApplyArgs,runCompensation} from './apply6061Compensation.mjs';
import {SOURCE_HASH_TABLES} from './compensation6061Source.mjs';
const payload=()=>({issue:6061,policy:'current_plans_current_engine',through:'2026-10-02',source_scope:{rider_ids:['r'],team_ids:['t'],season_ids:['s']},
 source_hashes:Object.fromEntries(SOURCE_HASH_TABLES.map(t=>[t,'a'.repeat(64)])),summary:{riders:1,rider_days:1},plans:[{rider_id:'r',team_id:'t',season_id:'s',days:[{}]}]});
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const raw=JSON.stringify(payload());const hash=sha(raw);
test('exact file bytes and a closed cutoff are required',()=>{
 assert.equal(validateApprovedFile(raw,hash,'2026-10-03T13:00:00Z').summary.rider_days,1);
 assert.throws(()=>validateApprovedFile(raw+' ',hash,'2026-10-03T13:00:00Z'),/hash/);
 assert.throws(()=>validateApprovedFile(raw,hash,'2026-10-02T13:00:00Z'),/closed/);
});
test('the old full-row plan file and oversized payloads are refused before any network',()=>{
 const legacy=JSON.stringify({...payload(),source_checks:[{table:'users',rows:[]}]});
 assert.throws(()=>validateApprovedFile(legacy,sha(legacy),'2026-10-03T13:00:00Z'),/Slim/);
 const big=raw+' '.repeat(2*1024*1024);assert.throws(()=>validateApprovedFile(big,sha(big),'2026-10-03T13:00:00Z'),/Slim/);
});
test('complete per-table hashes and a covering scope are required',()=>{
 const partial=payload();delete partial.source_hashes.users;const p=JSON.stringify(partial);
 assert.throws(()=>validateApprovedFile(p,sha(p),'2026-10-03T13:00:00Z'),/source hashes/);
 const foreign=payload();foreign.plans[0].team_id='x';const f=JSON.stringify(foreign);
 assert.throws(()=>validateApprovedFile(f,sha(f),'2026-10-03T13:00:00Z'),/outside source scope/);
 const noScope=payload();delete noScope.source_scope;const n=JSON.stringify(noScope);
 assert.throws(()=>validateApprovedFile(n,sha(n),'2026-10-03T13:00:00Z'),/source scope/);
});
test('apply requires a separate explicit production authorization',()=>{
 assert.equal(parseApplyArgs(['--plan=p','--approved-hash='+hash]).apply,false);
 assert.throws(()=>parseApplyArgs(['--plan=p','--approved-hash='+hash,'--apply']),/owner-go/);
 assert.throws(()=>parseApplyArgs(['--plan=p','--approved-hash='+hash,'--surprise']),/Unknown/);
});
test('default run cannot invoke a mutation and returns only anonymous counts',async()=>{
 const db={rpc(){throw new Error('write attempted');}};
 assert.deepEqual(await runCompensation({supabase:db,raw,hash,now:'2026-10-03T13:00:00Z',apply:false}),{dry_run:true,riders:1,rider_days:1,payload_bytes:Buffer.byteLength(raw),approved_hash:hash});
});
test('authorized apply passes unchanged bytes, hash and injected clock to the atomic RPC',async()=>{
 let seen;const db={rpc:async(name,args)=>{seen={name,args};return {data:{rider_days:1},error:null};}};
 const result=await runCompensation({supabase:db,raw,hash,now:'2026-10-03T13:00:00Z',apply:true,ownerGo:true});
 assert.equal(result.rider_days,1);assert.equal(seen.name,'apply_training_compensation_6061');
 assert.equal(seen.args.p_plan_text,raw);assert.equal(seen.args.p_approved_hash,hash);
});
test('RPC failure surfaces the writer guard text but never ids or payload values',async()=>{
 const fail=message=>runCompensation({supabase:{rpc:async()=>({error:{message}})},raw,hash,now:'2026-10-03T13:00:00Z',apply:true,ownerGo:true});
 await assert.rejects(fail('Compensation source changed (users); repeat dry-run'),/Atomic compensation failed \(Compensation source changed \(users\)/);
 await assert.rejects(fail('invalid input syntax for type uuid: "00000000-0000-0000-0000-000000000001"'),err=>/Atomic compensation failed/.test(err.message)&&!/0000/.test(err.message));
});
