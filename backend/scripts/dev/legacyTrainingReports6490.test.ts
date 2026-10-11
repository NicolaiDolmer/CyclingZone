import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import * as recovery from './prepare6061TrainingRecovery.mjs';

test('one paginated scan preserves per-input report order, duplicates and previous owners',async()=>{
  assert.equal(typeof recovery.loadLegacyTrainingReports,'function');
  const rows=Array.from({length:1002},(_,i)=>({id:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,
    team_id:'previous-owner',tick_date:'2026-10-01',report:{riders:[{rider_id:i>=1000?'rider':'irrelevant'}]}}));
  rows[1001].report.riders.push({rider_id:'rider'},{rider_id:'RIDER'});
  let calls=0;
  const client=createClient('https://synthetic.supabase.co','fixture',{global:{fetch:async input=>{
    calls++;const url=new URL(String(input));
    if(url.searchParams.has('report->riders'))throw new Error('legacy GIN query forbidden in this fixture');
    const after=url.searchParams.get('id')?.slice(3);
    const data=rows.filter(row=>!after||row.id>after).slice(0,Number(url.searchParams.get('limit')??1000));
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  }}});
  const result=await recovery.loadLegacyTrainingReports(client,['rider','RIDER','rider']);
  assert.deepEqual(result.map(row=>row.id),[rows[1000].id,rows[1001].id,rows[1001].id,rows[1000].id,rows[1001].id]);
  assert.equal(calls,2);
  assert.deepEqual(await recovery.loadLegacyTrainingReports(client,[]),[]);assert.equal(calls,2);
});

test('failed later page rejects the inventory instead of returning partial evidence',async()=>{
  assert.equal(typeof recovery.loadLegacyTrainingReports,'function');let calls=0;
  const client=createClient('https://synthetic.supabase.co','fixture',{global:{fetch:async()=>{
    if(++calls>1)return new Response(JSON.stringify({code:'42501',message:'Fixture denied'}),{status:403,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(Array.from({length:1000},(_,i)=>({id:String(i).padStart(5,'0'),report:{riders:[{rider_id:'rider'}]}}))),{headers:{'content-type':'application/json'}});
  }}});
  await assert.rejects(recovery.loadLegacyTrainingReports(client,['rider']),/Fixture denied/);
});
