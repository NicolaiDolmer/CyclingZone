import test from 'node:test';
import assert from 'node:assert/strict';
import { runRankingShadowPass as rawRun } from './rankingShadowPass.ts';
type Client=Parameters<typeof rawRun>[0];
type Options=Omit<Parameters<typeof rawRun>[1],'clock'>;
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
  const pending={rpc:async()=>{count++;return {data:{pending:true},error:null};}};
  await runRankingShadowPass(pending,{now:0}); assert.equal(count,1);
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
