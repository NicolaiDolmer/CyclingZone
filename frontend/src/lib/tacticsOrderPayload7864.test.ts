import test from 'node:test';
import assert from 'node:assert/strict';
import {tacticsOrderPayload7864,sameStageOrder7864} from './tacticsOrderPayload7864.ts';
import type {TeamPlanOrder} from '../components/race/tacticsReady7864.ts';

test('ordinary and stage-plan payloads share a strict field allowlist and preserve semantics',()=>{
 const raw:TeamPlanOrder={breakaway_stance:'chase',privateValue:'never sent',riders:[{rider_id:'a',race_role:'captain',effort:'save',try_break:true,leadout:false,plan:[{task:'stay_sheltered'},{task:'ride_for_result',from:{at:'final_km'}}]}]};
 const plain=tacticsOrderPayload7864(raw,false);
 assert.deepEqual(plain,{breakaway_stance:'chase',riders:[{rider_id:'a',effort:'save',try_break:true,leadout:false}]});
 const planned=tacticsOrderPayload7864(raw,true);
 assert.deepEqual(Object.keys(planned.riders[0]).sort(),['effort','leadout','plan','rider_id','try_break']);
 assert.equal(planned.riders[0].try_break,false);
 assert.equal(raw.riders?.[0].try_break,true,'input is unchanged');
});
test('readback equality ignores object/row order and extra display fields but catches real order changes',()=>{
 const a:TeamPlanOrder={breakaway_stance:'neutral',riders:[{rider_id:'a',effort:'normal'},{rider_id:'b',effort:'save'}]};
 const b:TeamPlanOrder={riders:[{effort:'save',rider_id:'b',name:'display'},{effort:'normal',rider_id:'a'}],breakaway_stance:'neutral',updated_at:'timestamp'};
 assert.equal(sameStageOrder7864(a,b),true);
 assert.equal(sameStageOrder7864(a,{...b,breakaway_stance:'chase'}),false);
 assert.equal(sameStageOrder7864(a,{...b,riders:[{rider_id:'a',effort:'save'},{rider_id:'b',effort:'save'}]}),false);
});
