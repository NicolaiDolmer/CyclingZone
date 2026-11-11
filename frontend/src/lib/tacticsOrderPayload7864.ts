import {withStagePlanFields} from '../components/race/StagePlanModel.ts';
import type {TeamPlanOrder} from '../components/race/tacticsReady7864.ts';

/** Same allowlist for ordinary and multi-stage saves. Roles never enter an order. */
export function tacticsOrderPayload7864(rawOrder:TeamPlanOrder,stagePlan:boolean){
 const order=stagePlan?withStagePlanFields(rawOrder):rawOrder;
 return {breakaway_stance:order.breakaway_stance,riders:(order.riders??[]).map(rider=>({
  rider_id:rider.rider_id,effort:rider.effort,try_break:rider.try_break===true,leadout:rider.leadout===true,
  ...(stagePlan&&Array.isArray(rider.plan)&&rider.plan.length?{plan:rider.plan}:{}),
 }))};
}
function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,stable(v)]));
 return value;
}
export function sameStageOrder7864(left:TeamPlanOrder,right:TeamPlanOrder):boolean{
 const canonical=(order:TeamPlanOrder)=>{const p=tacticsOrderPayload7864(order,true);return JSON.stringify(stable({...p,riders:p.riders.sort((a,b)=>a.rider_id.localeCompare(b.rider_id,'en'))}));};
 return canonical(left)===canonical(right);
}
