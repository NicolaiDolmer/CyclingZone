import {buildTeamPlan,teamPlanRouteFromProfile,type TeamPlanKind,type TeamPlanOrder,type TeamPlanRider,type TeamPlanResult} from './tacticsReady7864.ts';
import {isTimeTrialProfile} from './StagePlanModel.ts';
import type {RolesBody} from '../../lib/tacticsSaveFlow.ts';

export type FillReceipt7864={applied:number[];preserved:number[];locked:number[]};
export type MultiStageDraft7864={stage:number;plan:TeamPlanResult};
type Stage={stage_number:number;locked:boolean};
type ReadbackRider={rider_id:string;abandoned?:boolean;race_role?:string|null}&Record<string,unknown>;
type ReadbackRole={stage_number:number;rider_id:string;race_role:string;effort:string};
export type StageRolesReadback7864=RolesBody&{riders:ReadbackRider[];overrides:ReadbackRole[];stages_completed:number};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);

export function readStageRoles7864(value:unknown):StageRolesReadback7864|null{
 if(!record(value)||!Array.isArray(value.riders)||!Array.isArray(value.overrides)||!Number.isInteger(value.stages_completed)||Number(value.stages_completed)<0)return null;
 if(value.riders.some(r=>!record(r)||typeof r.rider_id!=='string'||(r.abandoned!==undefined&&typeof r.abandoned!=='boolean')||(r.race_role!==undefined&&r.race_role!==null&&typeof r.race_role!=='string'))
  ||value.overrides.some(r=>!record(r)||!Number.isInteger(r.stage_number)||Number(r.stage_number)<1||typeof r.rider_id!=='string'||typeof r.race_role!=='string'||typeof r.effort!=='string'))return null;
 if(value.stage_versions!==undefined&&(!record(value.stage_versions)||Object.values(value.stage_versions).some(v=>typeof v!=='string')))return null;
 return value as StageRolesReadback7864;
}
export function stageFillError7864(value:unknown):string{return record(value)&&typeof value.error==='string'?value.error:'generic';}

/** Generate independent drafts; saved/manual stages and missing evidence win. */
export function multiStagePlans7864({sourceStage,kind,stages,profiles,orders,ridersFor,savedStages,manualDraftStages}:{sourceStage:number;kind:TeamPlanKind;stages:Stage[];
 profiles:Record<number,Record<string,unknown>>;orders:Record<number,TeamPlanOrder>;ridersFor:(stage:number)=>TeamPlanRider[];savedStages:Set<number>;manualDraftStages:Set<number>}):MultiStageDraft7864[]{
 const source=profiles[sourceStage]?.profile_type;
 if(typeof source!=='string'||!source||isTimeTrialProfile(source)||stages.find(s=>s.stage_number===sourceStage)?.locked)return [];
 const results:MultiStageDraft7864[]=[];
 for(const stage of [...stages].sort((a,b)=>a.stage_number-b.stage_number)){
  const sn=stage.stage_number;
  if(sn===sourceStage||stage.locked||savedStages.has(sn)||manualDraftStages.has(sn)||profiles[sn]?.profile_type!==source||!orders[sn])continue;
  const riders=ridersFor(sn);
  const active=new Set(riders.filter(r=>!r.abandoned).map(r=>r.rider_id));
  const order={...orders[sn],riders:(orders[sn].riders??[]).filter(row=>active.has(row.rider_id))};
  const plan=buildTeamPlan(kind,{riders,route:teamPlanRouteFromProfile(profiles[sn]),order});
  if(plan)results.push({stage:sn,plan});
 }
 return results;
}

export function readFillReceipt7864(value:unknown,stages:number[]):FillReceipt7864|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const raw=value as Record<string,unknown>,requested=new Set(stages);
 if(!['applied','preserved','locked'].every(k=>Array.isArray(raw[k])&&(raw[k] as unknown[]).every(n=>Number.isInteger(n)&&requested.has(Number(n)))))return null;
 const receipt=raw as unknown as FillReceipt7864;
 const all=[...receipt.applied,...receipt.preserved,...receipt.locked];
 return all.length===requested.size&&new Set(all).size===requested.size?receipt:null;
}

/** A fresh foreign readback must never inherit our baseline or its new version. */
export function confirmedFillStages7864({stages,receipt,readbackAvailable,rolesMatch,ordersMatch}:{stages:number[];receipt:FillReceipt7864|null;readbackAvailable:boolean;rolesMatch:(stage:number)=>boolean;ordersMatch:(stage:number)=>boolean}):number[]{
 return stages.filter(sn=>!receipt?.locked.includes(sn)&&(readbackAvailable?rolesMatch(sn)&&ordersMatch(sn):receipt?.applied.includes(sn)===true));
}

/** One write and one readback; ambiguous responses never cause blind overwrites. */
export async function runStageFill7864<T>({stages,write,read,rolesMatch,ordersMatch}:{stages:number[];write:()=>Promise<unknown>;read:()=>Promise<T|null>;rolesMatch:(snapshot:T,stage:number)=>boolean;ordersMatch:(snapshot:T,stage:number)=>boolean}){
 let receipt:FillReceipt7864|null=null,readback:T|null=null,errorKey:string|null=null;
 try{receipt=readFillReceipt7864(await write(),stages);if(!receipt)errorKey='generic';}catch(error){errorKey=error instanceof Error?error.message:'generic';}
 try{readback=await read();}catch{readback=null;}
 const confirmed=confirmedFillStages7864({stages,receipt,readbackAvailable:readback!==null,
  rolesMatch:sn=>readback!==null&&rolesMatch(readback,sn),ordersMatch:sn=>readback!==null&&ordersMatch(readback,sn)});
 const pending=stages.filter(sn=>!confirmed.includes(sn));
 if(pending.length&&receipt&&(receipt.preserved.length||receipt.locked.length||readback!==null))errorKey='stage_roles_conflict';
 return {receipt,readback,confirmed,pending,errorKey:pending.length?errorKey??'generic':null};
}
