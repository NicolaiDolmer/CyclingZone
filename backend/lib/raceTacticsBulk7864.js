// #7864: fill unplanned same-type stages; every destination owns its route.
import {getStageRolesContext,validateStageRoleOverrides} from './raceStageRolesApi.js';
import {getTeamOrdersContext,validateTeamOrder,normalizeTeamOrder,isTimeTrialProfileType,isStageLocked} from './raceTeamOrdersApi.js';
import {stagePlanRouteFromRaw,withJerseyHunt7855} from './stagePlan.ts';
import {isStagePlanEnabled,stagePlanRevisionOk} from './stagePlanApi.js';
import {jerseyHunt7855OpenForRace} from './jerseyHunt7855Flag.js';
import {evaluateFlagStage} from './featureStage.js';
import {raceAllowsCoCaptain} from './raceSelection.js';
import {fetchAllRows} from './supabasePagination.js';
import {loadTacticsStageCapability7864,writeTacticsStages7864,roleSnapshot7864,entrySnapshot7864,TacticsSaveError7864} from './tacticsStageSave7864.ts';

function invalid(code='team_orders_invalid_body',status=400){throw new TacticsSaveError7864(code,status);}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Pure boundary: validate proposed roles and the order against THIS profile. */
export function prepareFillStage7864({plan,rolesCtx,ordersCtx,profile,race,coCaptainAllowed,jerseyHunt,now}){
 const stage=plan.stage_number;
 if(!profile||isTimeTrialProfileType(profile.profile_type)||!Array.isArray(plan.overrides)
   ||plan.overrides.some(row=>!object(row)||row.stage_number!==stage))invalid();
 const roles=validateStageRoleOverrides({overrides:plan.overrides,coCaptainAllowed,raceCompleted:race.status==='completed',stageCount:rolesCtx.stage_count,
  stagesCompleted:rolesCtx.stages_completed,teamRiderIds:rolesCtx.teamRiderIds,baseRoleByRider:rolesCtx.baseRoleByRider,abandonedRiderIds:rolesCtx.abandonedRiderIds});
 if(!roles.ok)invalid(roles.errors[0]);
 const roleByRider=new Map(rolesCtx.baseRoleByRider);
 for(const row of plan.overrides)roleByRider.set(row.rider_id,row.race_role);
 const activeIds=new Set([...rolesCtx.teamRiderIds].filter(id=>!rolesCtx.abandonedRiderIds.has(id)));
 const stagePlan={route:withJerseyHunt7855(stagePlanRouteFromRaw(profile),jerseyHunt),hasRoute:true,
  roleByRider:new Map([...roleByRider].map(([id,role])=>[id,role==='luxury_helper'?'helper':role]))};
 const result=validateTeamOrder({order:plan.order,stagePlan,roleByRider,raceCompleted:ordersCtx.race_completed,stageNumber:stage,stageCount:ordersCtx.stage_count,
  stagesCompleted:ordersCtx.stages_completed,scheduledAt:ordersCtx.scheduleByStage.get(stage)??null,teamRiderIds:activeIds,profileType:profile.profile_type,now});
 if(!result.ok)invalid(result.errors[0]);
 const {distance_km,profile_type,climbs,sprints}=profile;
 return {stage_number:stage,expected_entries:entrySnapshot7864(rolesCtx.baseRoleByRider),expected_roles:roleSnapshot7864(rolesCtx.overrides,stage),
  roles:roleSnapshot7864(plan.overrides,stage),order:normalizeTeamOrder(plan.order),expected_profile:{distance_km,profile_type,climbs,sprints}};
}

async function loadFillContexts7864({supabase,race,teamId,now}){
 const [rolesCtx,ordersCtx,profiles,jerseyHunt]=await Promise.all([
  getStageRolesContext({supabase,race,teamId,now}),getTeamOrdersContext({supabase,race,teamId}),
  fetchAllRows(()=>supabase.from('race_stage_profiles').select('stage_number,distance_km,profile_type,climbs,sprints').eq('race_id',race.id).order('stage_number',{ascending:true})),
  jerseyHunt7855OpenForRace({supabase,race}),
 ]);
 return {rolesCtx,ordersCtx,profiles,jerseyHunt};
}
export async function fillRaceTactics7864({supabase,race,teamId,body,isBetaTester,now,writeNow,loadContexts=loadFillContexts7864}){
 if(!object(body)||!Number.isInteger(body.source_stage)||body.source_stage<1||body.source_stage>race.stages
   ||!Array.isArray(body.plans)||body.plans.length===0||body.plans.length>race.stages
   ||body.plans.some(plan=>!object(plan)||!Number.isInteger(plan.stage_number)||plan.stage_number<1||plan.stage_number>race.stages||plan.stage_number===body.source_stage)
   ||new Set(body.plans.map(plan=>plan.stage_number)).size!==body.plans.length)invalid();
 const capability=await loadTacticsStageCapability7864({supabase,teamId,raceId:race.id});
 if(!capability.available||!evaluateFlagStage(capability.stage,{isBetaTester})||!stagePlanRevisionOk(race)
   ||!await isStagePlanEnabled(supabase,{isBetaTester}))invalid();
 const {rolesCtx,ordersCtx,profiles,jerseyHunt}=await loadContexts({supabase,race,teamId,now});
 const byStage=new Map(profiles.map(profile=>[profile.stage_number,profile]));
 const source=byStage.get(body.source_stage);
 if(!source?.profile_type||isTimeTrialProfileType(source.profile_type)||body.plans.some(plan=>byStage.get(plan.stage_number)?.profile_type!==source.profile_type))invalid();
 const saved=new Set([...capability.savedStages,...ordersCtx.orders.map(row=>row.stage_number),...rolesCtx.overrides.map(row=>row.stage_number)]);
 const preserved=[],locked=[],plans=[];
 for(const plan of [...body.plans].sort((a,b)=>a.stage_number-b.stage_number)){
  const sn=plan.stage_number;
  if(ordersCtx.race_completed||isStageLocked({stageNumber:sn,stagesCompleted:ordersCtx.stages_completed,scheduledAt:ordersCtx.scheduleByStage.get(sn)??null,now})){
   locked.push(sn);continue;
  }
  if(saved.has(sn)){preserved.push(sn);continue;}
  plans.push(prepareFillStage7864({plan,rolesCtx,ordersCtx,profile:byStage.get(sn),race,coCaptainAllowed:raceAllowsCoCaptain(race),jerseyHunt,now}));
 }
 const receipt=plans.length?await writeTacticsStages7864({supabase,teamId,raceId:race.id,mode:'fill',plans,now:writeNow}):{applied:[],preserved:[],locked:[]};
 return {applied:receipt.applied,preserved:[...preserved,...receipt.preserved].sort((a,b)=>a-b),locked:[...locked,...receipt.locked].sort((a,b)=>a-b)};
}
