import test from 'node:test';
import assert from 'node:assert/strict';
import { runRankingShadowPass } from './rankingShadowPass.ts';
const MORNING=Date.parse('2026-10-19T08:00:00Z');
const quiet={info() {}};
function fixture({stage='on',queue=0,flagError=false,missing=false}={}){
  const calls:Array<{name:string,args:unknown}>=[];
  const client={
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:missing?null:{value:stage},error:flagError?{message:'unavailable'}:null})})})}),
    rpc:async(name:string,args:unknown):Promise<{data:unknown;error:{code?:string;message:string}|null}>=>{
      calls.push({name,args});
      return {data:name==='get_ranking_shadow_metrics'?{queue_length:queue}
        :name==='apply_ranking_deltas'?{pending:false}:{status:'equal'},error:null};
    },
  };
  return {client,calls};
}
const options={now:MORNING,clock:()=>0,logger:quiet};
test('off/missing/invalid/read failure block apply and parity while retaining queue monitoring',async()=>{
  for(const settings of [{stage:'off'},{missing:true},{stage:'invalid'},{flagError:true}]){
    const {client,calls}=fixture(settings); await runRankingShadowPass(client,options);
    assert.deepEqual(calls.map(c=>c.name),['get_ranking_shadow_metrics']);
  }
});
test('on and beta permit engine shadow work',async()=>{
  for(const stage of ['on','beta']){
    const {client,calls}=fixture({stage});
    await runRankingShadowPass(client,options);
    assert.deepEqual(calls.map(c=>c.name),['get_ranking_shadow_metrics','apply_ranking_deltas','check_ranking_shadow_parity']);
  }
});
test('19 inclusive to 22 exclusive Copenhagen blocks parity in summer/winter, even staging override',async()=>{
  for(const instant of ['2026-07-01T17:00:00Z','2026-07-01T19:59:59Z','2026-12-01T18:00:00Z','2026-12-01T20:59:59Z']){
    const {client,calls}=fixture();
    await runRankingShadowPass(client,{...options,now:Date.parse(instant),parityEveryPass:true});
    assert.deepEqual(calls.map(c=>c.name),['get_ranking_shadow_metrics','apply_ranking_deltas'],instant);
  }
  for(const instant of ['2026-07-01T16:59:59Z','2026-07-01T20:00:00Z','2026-12-01T17:59:59Z','2026-12-01T21:00:00Z']){
    const {client,calls}=fixture();
    await runRankingShadowPass(client,{...options,now:Date.parse(instant)});
    assert.equal(calls.at(-1)?.name,'check_ranking_shadow_parity',instant);
  }
});
test('a due peak-hour check remains due and runs at 22:00',async()=>{
  const {client,calls}=fixture();
  await runRankingShadowPass(client,{...options,now:Date.parse('2026-10-19T18:00:00Z')});
  await runRankingShadowPass(client,{...options,now:Date.parse('2026-10-19T20:00:00Z')});
  assert.equal(calls.filter(c=>c.name==='check_ranking_shadow_parity').length,1);
});

test('database peak deferral remains due without reporting a mismatch',async()=>{
  const {client,calls}=fixture();const rpc=client.rpc;let deferred=true;
  client.rpc=async(name,args)=>name==='check_ranking_shadow_parity'&&deferred
    ?{data:{status:'deferred-peak'},error:null}:rpc(name,args);
  const failures:Error[]=[];
  assert.equal(await runRankingShadowPass(client,{...options,captureExceptionFn:e=>failures.push(e)}),true);
  deferred=false;
  assert.equal(await runRankingShadowPass(client,options),true);
  assert.equal(calls.filter(c=>c.name==='check_ranking_shadow_parity').length,1);
  assert.deepEqual(failures,[]);
});
test('every run logs queue size and elapsed pass time, even when disabled',async()=>{
  const {client}=fixture({stage:'off',queue:23});const logs:Array<Record<string,unknown>>=[];let tick=0;
  await runRankingShadowPass(client,{now:MORNING,clock:()=>tick++?450:100,
    logger:{info:(_message:string,details:Record<string,unknown>)=>{logs.push(details);}}});
  assert.equal(logs.length,1); assert.equal(logs[0].queue_length,23);
  assert.equal(logs[0].pass_ms,350); assert.equal(logs[0].enabled,false);
});
test('Sentry alarms strictly above 10000 items or 20 seconds, including disabled work',async()=>{
  for(const [queue,elapsed,expected] of [[10000,20000,0],[10001,0,1],[0,20001,1],[10001,20001,1]]){
    const {client}=fixture({stage:'off',queue});const errors:unknown[]=[];let tick=0;
    await runRankingShadowPass(client,{...options,clock:()=>tick++?elapsed:0,captureExceptionFn:e=>{errors.push(e);}});
    assert.equal(errors.length,expected,JSON.stringify({queue,elapsed}));
  }
});
test('disabled slow monitoring renews the legacy lease before every database read',async()=>{
  const f=fixture({stage:'off'});let elapsed=50000,expires=90000;
  const failures:Error[]=[];
  f.client.rpc=async()=>{elapsed+=50000;assert.ok(elapsed<expires,'metrics retain lease');return {data:{queue_length:0},error:null};};
  f.client.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>{
    elapsed+=50000;assert.ok(elapsed<expires,'flag read retains lease');
    return {data:{value:'off'},error:null};
  }})})});
  await runRankingShadowPass(f.client,{...options,clock:()=>elapsed,
    renewLease:async()=>{assert.ok(elapsed<expires);expires=elapsed+90000;return true;},
    captureExceptionFn:(error,context)=>{if(!context.tags.alarm) failures.push(error);},
  });
  assert.deepEqual(failures,[]);
  assert.ok(elapsed<expires,'legacy completion keeps its lease even with flag off');
});
test('apply crossing 19:00 rechecks execution time before parity',async()=>{
  const f=fixture();let elapsed=0;
  const rpc=f.client.rpc;
  f.client.rpc=async(name,args)=>{if(name==='apply_ranking_deltas') elapsed+=2000;return rpc(name,args);};
  await runRankingShadowPass(f.client,{...options,now:Date.parse('2026-10-19T16:59:59Z'),clock:()=>elapsed});
  assert.equal(f.calls.filter(c=>c.name==='check_ranking_shadow_parity').length,0);
});
