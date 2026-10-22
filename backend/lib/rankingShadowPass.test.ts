import test from 'node:test';
import assert from 'node:assert/strict';
import { runRankingShadowPass as rawRun, SHADOW_DRAIN_MAX_BATCHES, SHADOW_DRAIN_BUDGET_MS, SHADOW_QUEUE_STALL_ALARM_S } from './rankingShadowPass.ts';
type Client=Parameters<typeof rawRun>[0];
type Options=Omit<Parameters<typeof rawRun>[1],'clock'>&{clock?:()=>number};
const adapters=new WeakMap<Client,Client>();
function runRankingShadowPass(client:Client,options:Options){
  let adapter=adapters.get(client);
  if(!adapter){
    adapter={...client,
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:'on'},error:null})})})}),
      rpc:(name,args)=>name==='get_ranking_shadow_metrics'
        ?Promise.resolve({data:{queue_length:0},error:null}):client.rpc(name,args),
    };
    adapters.set(client,adapter);
  }
  return rawRun(adapter,{clock:()=>0,logger:{info(){}},...options});
}

test('shadow pass forwards lease, checks parity and throttles daily checks with an explicit clock',async()=>{
  const calls:Array<{name:string,args:unknown}>=[];
  const client={rpc:async(name:string,args:unknown)=>{
    calls.push({name,args});
    return {data:name==='apply_ranking_deltas'?{pending:false}:{status:'equal'},error:null};
  }};
  await runRankingShadowPass(client,{ownerToken:'token',targetVersion:7,now:1000});
  await runRankingShadowPass(client,{now:2000});
  assert.deepEqual(calls.map(c=>c.name),['apply_ranking_deltas','check_ranking_shadow_parity','apply_ranking_deltas']);
  assert.deepEqual(calls[0].args,{p_max_items:200,p_owner_token:'token',p_target_version:7});
  await runRankingShadowPass(client,{now:1000+86400000});
  assert.equal(calls.at(-1)?.name,'check_ranking_shadow_parity');
});
test('backfill defers parity, and missing additive schema is safe during rolling deployment',async()=>{
  let count=0;
  const pending={rpc:async(name:string)=>{count++;return {data:name==='apply_ranking_deltas'?{pending:true}:{status:'equal'},error:null};}};
  await runRankingShadowPass(pending,{now:0}); assert.equal(count,SHADOW_DRAIN_MAX_BATCHES,'a burst drains up to the batch cap, never parity');
  count=0;
  const unknown={rpc:async()=>{count++;return {data:null,error:null};}};
  assert.equal(await runRankingShadowPass(unknown,{now:0}),true); assert.equal(count,1,'an unexplained result is not retried in the same pass');
  const missing={rpc:async()=>({data:null,error:{code:'PGRST202',message:'not yet installed'}})};
  assert.equal(await runRankingShadowPass(missing,{now:0}),false);
});
test('slow successful shadow calls renew between RPCs and before legacy acknowledgement',async()=>{
  let now=50000,expires=90000;
  const steps:string[]=[];
  const client={rpc:async(name:string)=>{
    steps.push(name); now+=25000;
    assert.ok(now<expires,'each shadow RPC stays inside its renewed lease');
    return {data:name==='apply_ranking_deltas'?{pending:false}:{status:'equal'},error:null};
  }};
  const renewLease=async()=>{steps.push('renew');assert.ok(now<expires);expires=now+90000;return true;};
  assert.equal(await runRankingShadowPass(client,{now:0,renewLease}),true);
  assert.deepEqual(steps,['renew','renew','renew','apply_ranking_deltas','renew','check_ranking_shadow_parity','renew']);
  assert.ok(now<expires,'legacy completion still owns a live lease');
});
test('parity mismatch and processor failure report to Sentry without failing legacy publication',async()=>{
  const errors:unknown[]=[];
  const captureExceptionFn=(e:unknown)=>{errors.push(e);};
  const mismatch={rpc:async(name:string)=>({data:name==='apply_ranking_deltas'?{pending:false}:{status:'different',differences:{rider_rankings_mv:1}},error:null})};
  assert.equal(await runRankingShadowPass(mismatch,{now:0,captureExceptionFn}),false);
  const failed={rpc:async()=>({data:null,error:{code:'57014',message:'timeout'}})};
  assert.equal(await runRankingShadowPass(failed,{now:0,captureExceptionFn}),false);
  assert.equal(errors.length,2);
});
test('completed mismatches obey the daily cadence while staging can check every pass',async()=>{
  const calls:string[]=[]; const errors:unknown[]=[];
  const client={rpc:async(name:string)=>{
    calls.push(name);
    return {data:name==='apply_ranking_deltas'?{pending:false}:{status:'different'},error:null};
  }};
  const captureExceptionFn=(e:unknown)=>{errors.push(e);};
  assert.equal(await runRankingShadowPass(client,{now:0,captureExceptionFn}),false);
  await runRankingShadowPass(client,{now:60000,captureExceptionFn});
  assert.equal(calls.filter(n=>n==='check_ranking_shadow_parity').length,1);
  assert.equal(errors.length,1,'persistent drift emits one production alert per daily check');
  await runRankingShadowPass(client,{now:120000,captureExceptionFn,parityEveryPass:true});
  assert.equal(calls.filter(n=>n==='check_ranking_shadow_parity').length,2);
  await runRankingShadowPass(client,{now:120000+86400000,captureExceptionFn});
  assert.equal(calls.filter(n=>n==='check_ranking_shadow_parity').length,3);
});
test('#6765 M1.5: a multi-batch burst drains in one pass, renewing the lease between batches',async()=>{
  const steps:string[]=[];let left=3;
  const client={rpc:async(name:string)=>{
    steps.push(name);
    return {data:name==='apply_ranking_deltas'?{pending:--left>0}:{status:'equal'},error:null};
  }};
  const renewLease=async()=>{steps.push('renew');return true;};
  assert.equal(await runRankingShadowPass(client,{now:5*86400000,renewLease}),true);
  assert.deepEqual(steps,['renew','renew','renew','apply_ranking_deltas','renew','apply_ranking_deltas','renew',
    'apply_ranking_deltas','renew','check_ranking_shadow_parity','renew']);
});
test('#6765 M1.5: a lost lease between batches stops the drain and reports',async()=>{
  const errors:Error[]=[];let applies=0,renewals=0;
  const client={rpc:async(name:string)=>{if(name==='apply_ranking_deltas')applies++;return {data:{pending:true},error:null};}};
  const renewLease=async()=>++renewals<=3;
  assert.equal(await runRankingShadowPass(client,{now:0,renewLease,captureExceptionFn:e=>{errors.push(e);}}),false);
  assert.equal(applies,1);
  assert.match(errors[0].message,/between shadow batches/);
});
test('#6765 M1.5: the drain stops before a batch would cross the time budget',async()=>{
  let elapsed=0,applies=0;const logs:Array<Record<string,unknown>>=[];
  const client={rpc:async(name:string)=>{
    if(name==='apply_ranking_deltas'){applies++;elapsed+=3000;}
    return {data:{pending:true},error:null};
  }};
  assert.equal(await runRankingShadowPass(client,{now:0,clock:()=>elapsed,logger:{info:(_m,d)=>{logs.push(d);}}}),true);
  // 3 s batches: after two (6 s) a third would end at 9 s, past the 8 s budget.
  assert.equal(SHADOW_DRAIN_BUDGET_MS,8000);
  assert.equal(applies,2);
  assert.equal(logs[0].status,'pending');assert.equal(logs[0].batches,2);
});
test('#6765 M1.5: queue age is optional, validated, and alarms only when undrained and enabled',async()=>{
  const MORNING=Date.parse('2026-10-19T08:00:00Z');
  const run=async(age:unknown,{stage='on',pending=true,client:shared,now=MORNING}:{stage?:string;pending?:boolean;client?:object;now?:number}={})=>{
    const alarms:string[]=[];const errors:string[]=[];
    const client=Object.assign(shared??{},{
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:stage},error:null})})})}),
      rpc:async(name:string)=>({data:name==='get_ranking_shadow_metrics'?{queue_length:1,...(age===undefined?{}:{oldest_age_s:age})}
        :name==='apply_ranking_deltas'?{pending}:{status:'equal'},error:null}),
    });
    await rawRun(client,{now,clock:()=>0,logger:{info(){}},
      captureExceptionFn:(e,c)=>{(c.tags.alarm?alarms:errors).push(c.tags.alarm??e.message);}});
    return {alarms,errors};
  };
  const STALE=SHADOW_QUEUE_STALL_ALARM_S+1;
  assert.deepEqual(await run(undefined),{alarms:[],errors:[]},'pre-migration metrics stay valid');
  assert.deepEqual(await run(null),{alarms:[],errors:[]});
  assert.deepEqual(await run(SHADOW_QUEUE_STALL_ALARM_S),{alarms:[],errors:[]});
  assert.deepEqual(await run(STALE),{alarms:['queue-stall'],errors:[]});
  assert.deepEqual(await run(STALE,{pending:false}),{alarms:[],errors:[]},'a pass that drained the queue is not stalled');
  assert.deepEqual(await run(STALE,{stage:'off'}),{alarms:[],errors:[]},'off keeps one aged repair marker by design');
  for(const bad of [-1,1.5,'60']) assert.deepEqual(await run(bad),{alarms:[],errors:['Invalid ranking shadow queue age metric']},String(bad));
  const client={};
  assert.deepEqual((await run(STALE,{client})).alarms,['queue-stall']);
  assert.deepEqual((await run(STALE,{client,now:MORNING+60_000})).alarms,[],'clean ticks do not repeat the alarm');
  assert.deepEqual((await run(STALE,{client,now:MORNING+3_600_000})).alarms,['queue-stall'],'repeats hourly while stalled');
});
