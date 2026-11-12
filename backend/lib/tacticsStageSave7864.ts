// Stage-save transport only. Product/route validation remains in the owning APIs.
type DbError={code?:string;message?:string};
type Result={data:unknown;error?:DbError|null};
type Query=PromiseLike<Result>&{select(columns:string):Query;eq(column:string,value:unknown):Query;maybeSingle():PromiseLike<Result>};
type ReadClient={from(table:string):unknown};
type WriteClient={rpc(name:string,args:Record<string,unknown>):PromiseLike<Result>};
export type RoleRow7864={stage_number?:number;rider_id:string;race_role:string;effort:string};
export type Entry7864={rider_id:string;race_role:string|null};
export type StageWrite7864={stage_number:number;expected_entries:Entry7864[];expected_roles:Omit<RoleRow7864,'stage_number'>[];roles?:Omit<RoleRow7864,'stage_number'>[];order?:unknown;expected_profile?:unknown};
export type Receipt7864={applied:number[];preserved:number[];locked:number[]};

export class TacticsSaveError7864 extends Error {
 status:number;
 constructor(code:string,status=500,cause?:unknown){super(code,cause===undefined?undefined:{cause});this.status=status;}
}
const SAVE_FAILED='tactics_save_failed';
/** Server failures are observable without exposing storage details to players. */
export function tacticsSaveFailure7864(error:unknown,report:(error:unknown)=>unknown){
 const status=error instanceof TacticsSaveError7864?error.status:500;
 if(status>=500)report(error);
 const code=status>=500?SAVE_FAILED:(error as TacticsSaveError7864).message;
 return {status,body:{error:code,errors:[code]}};
}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const query=(client:ReadClient,table:string)=>client.from(table) as Query;

/** A read failure must never authorize the non-atomic compatibility writer. */
export async function loadTacticsStageCapability7864({supabase,teamId,raceId}:{supabase:ReadClient;teamId:string;raceId:string}){
 const flag=await query(supabase,'app_config').select('value').eq('key','tactics_ready_7864').maybeSingle();
 if(flag.error)throw new TacticsSaveError7864(SAVE_FAILED,500,flag.error);
 const value=object(flag.data)?flag.data.value:null;
 const stage=value===null||value===undefined||value===false||value==='off'?'off':value===true||value==='on'?'on':value==='beta'?'beta':null;
 if(!stage)throw new TacticsSaveError7864(SAVE_FAILED);
 // OFF must restore the original writers even after the migration is installed.
 if(stage==='off')return {available:false,savedStages:[] as number[],stage};
 const saved=await query(supabase,'race_tactics_stage_state').select('stage_number').eq('team_id',teamId).eq('race_id',raceId);
 if(saved.error){
  throw new TacticsSaveError7864(SAVE_FAILED,500,saved.error);
 }
 if(!Array.isArray(saved.data)||saved.data.some(row=>!object(row)||!Number.isInteger(row.stage_number)||Number(row.stage_number)<1))throw new TacticsSaveError7864(SAVE_FAILED);
 return {available:true,savedStages:saved.data.map(row=>Number(row.stage_number)),stage};
}

export function roleSnapshot7864(rows:RoleRow7864[],stage:number){
 return rows.filter(row=>row.stage_number===undefined||row.stage_number===stage).map(({rider_id,race_role,effort})=>({rider_id,race_role,effort})).sort((a,b)=>a.rider_id.localeCompare(b.rider_id,'en'));
}
export function entrySnapshot7864(baseRoleByRider:Map<string,string|null>):Entry7864[]{
 return [...baseRoleByRider].map(([rider_id,race_role])=>({rider_id,race_role})).sort((a,b)=>a.rider_id.localeCompare(b.rider_id,'en'));
}

/** Complete, disjoint receipts are required before a client baseline can advance. */
export async function writeTacticsStages7864({supabase,teamId,raceId,mode,plans,now}:{supabase:WriteClient;teamId:string;raceId:string;mode:'roles'|'orders'|'fill';plans:StageWrite7864[];now:Date|null}):Promise<Receipt7864>{
 const {data,error}=await supabase.rpc('save_race_tactics_7864',{p_team_id:teamId,p_race_id:raceId,p_mode:mode,p_plans:plans,p_now:now===null?null:now.toISOString()});
 if(error){
  const code=error.message??'';
  if(['stage_roles_conflict','stage_roles_stage_locked','team_orders_stage_locked','tactics_context_changed'].includes(code))throw new TacticsSaveError7864(code==='tactics_context_changed'?'stage_roles_conflict':code,409);
  throw new TacticsSaveError7864(SAVE_FAILED,500,error);
 }
 const requested=new Set(plans.map(p=>p.stage_number));
 if(!object(data)||!['applied','preserved','locked'].every(key=>Array.isArray(data[key])&&(data[key] as unknown[]).every(n=>Number.isInteger(n)&&requested.has(Number(n)))))throw new TacticsSaveError7864(SAVE_FAILED);
 const receipt=data as unknown as Receipt7864;
 const all=[...receipt.applied,...receipt.preserved,...receipt.locked];
 if(all.length!==requested.size||new Set(all).size!==requested.size||(mode!=='fill'&&receipt.applied.length!==requested.size))throw new TacticsSaveError7864(SAVE_FAILED);
 return receipt;
}
