import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingDateRpc } from './trainingDateRpc.js';
const args={p_team_id:'team'};
for(const name of ['register_training_date_work','commit_training_date_tick']) {
  test(`${name}: missing wrapper during deployment delegates once to existing RPC`,async()=>{
    const calls=[];
    const supabase={async rpc(n,a){calls.push([n,a]);return n.startsWith('try_')?{error:{code:'PGRST202',message:`Could not find the function public.try_${name}`}}:{data:{ok:true},error:null};}};
    assert.equal((await trainingDateRpc(supabase,name,args,true)).data.ok,true);
    assert.deepEqual(calls,[[`try_${name}`,args],[name,args]]);
  });
  for(const result of [{data:{held:true},error:null},{error:{code:'XX000',message:'failed'}},{error:{code:'PGRST202',message:'another missing function'}}]) test(`${name}: no retry for ${JSON.stringify(result)}`,async()=>{
    let calls=0;const supabase={async rpc(){calls++;return result;}};
    assert.equal(await trainingDateRpc(supabase,name,args,true),result);assert.equal(calls,1);
  });
  test(`${name}: sweep retains original RPC`,async()=>{
    const supabase={async rpc(n,a){assert.equal(n,name);assert.equal(a,args);return {data:{ok:true}};}};
    assert.equal((await trainingDateRpc(supabase,name,args,false)).data.ok,true);
  });
}
