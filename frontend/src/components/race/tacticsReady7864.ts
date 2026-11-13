import { isTimeTrialProfile, legacyOrderFromPlan, planRole, setRiderPlan, stagePlanRouteFromRaw, suggestStagePlan, validateStagePlanLegs, STAGE_PLAN_FINAL_KM, TASK_EFFORT, type StagePlanEffort, type StagePlanLeg, type StagePlanRole, type StagePlanRoute, type StagePlanTask } from './StagePlanModel.ts';
import { applyRoleForRest } from '../../lib/stageRoleMatrixLogic.js';
import { waypointsFor } from '../../lib/stageRouteProfile.js';
export type TeamPlanKind = 'gc' | 'stage' | 'sprint' | 'break' | 'save';
export type TeamPlanRider = { rider_id: string; name?: string | null; role: unknown; baseRole?: unknown; routeMatch: number | null; abandoned?: boolean };
export type TeamPlanRow = { rider_id: string; plan?: StagePlanLeg[] | null } & Record<string, unknown>;
export type TeamPlanOrder = { riders?: TeamPlanRow[] } & Record<string, unknown>;
type TacticsRole = StagePlanRole | 'luxury_helper';
export type TeamPlanRoleChange = { riderId: string; role: TacticsRole };
export type TeamPlanResult = { kind: TeamPlanKind; target: TeamPlanRider | null; order: TeamPlanOrder & { riders: TeamPlanRow[] }; roles: Record<string, StagePlanRole>; roleChanges: TeamPlanRoleChange[]; editableRiderIds: string[]; sourceRoles: Record<string,TacticsRole> };
export type TeamPlanChoice = {raceId:string;stage:number;kind:TeamPlanKind;fingerprint:string;sourceRoles:Record<string,TacticsRole>};
export const TEAM_PLAN_KINDS: readonly TeamPlanKind[] = ['gc', 'stage', 'sprint', 'break', 'save'];
export const TACTICS_READY_FLAG = 'tactics_ready_7864';

/** Same route projection previously local to StagePlanBoard. */
export function teamPlanRouteFromProfile(profile: Record<string,unknown> | null | undefined): StagePlanRoute {
  if (!profile) return stagePlanRouteFromRaw(null);
  if (Array.isArray(profile.climbs)) return stagePlanRouteFromRaw(profile);
  const climbs: unknown[] = [];
  for (const w of (waypointsFor(profile) as Array<Record<string,unknown>>).filter(p=>p.kind==='kom')) {
    climbs[w.index as number]={name:w.name,crest_km:w.km,category:w.category,summit_finish:w.summit_finish};
  }
  return stagePlanRouteFromRaw({distance_km:profile.distance_km,profile_type:profile.profile_type,climbs});
}

const leaders = new Set<StagePlanRole>(['captain', 'co_captain', 'sprint_captain']);
const supports = new Set<StagePlanRole>(['helper', 'hunter']);
const tacticsRole = (role:unknown):TacticsRole => role === 'luxury_helper' ? role : planRole(role);
const knownFit = (r: TeamPlanRider) => typeof r.routeMatch === 'number' && Number.isFinite(r.routeMatch);
function byFit(a: TeamPlanRider, b: TeamPlanRider): number {
  if (knownFit(a) && knownFit(b) && a.routeMatch !== b.routeMatch) return b.routeMatch! - a.routeMatch!;
  if (knownFit(a) !== knownFit(b)) return knownFit(a) ? -1 : 1;
  return a.rider_id.localeCompare(b.rider_id, 'en');
}
export function teamPlanTarget(kind: TeamPlanKind, riders: TeamPlanRider[]): TeamPlanRider | null {
  const available = riders.filter(r => !r.abandoned);
  if (kind === 'stage') return available.filter(knownFit).sort(byFit)[0] ?? null;
  const byId=[...available].sort((a,b)=>a.rider_id.localeCompare(b.rider_id,'en'));
  if (kind === 'sprint') return byId.find(r => planRole(r.role) === 'sprint_captain') ?? byId.find(r=>r.baseRole==='sprint_captain') ?? null;
  if (kind === 'gc') return byId.find(r => planRole(r.role) === 'captain') ?? byId.find(r => planRole(r.role) === 'co_captain') ?? byId.find(r=>r.baseRole==='captain') ?? null;
  return null;
}

/** Only existing role/task contracts. This chooses drafts, never writes them. */
export function buildTeamPlan(kind: TeamPlanKind, { riders, route, order, locked = false, sourceRoles: priorRoles }: { riders: TeamPlanRider[]; route: StagePlanRoute; order: TeamPlanOrder; locked?: boolean; sourceRoles?: Record<string,unknown> }): TeamPlanResult | null {
  if (locked || !TEAM_PLAN_KINDS.includes(kind) || !Number.isFinite(route.distance_km) || route.distance_km <= STAGE_PLAN_FINAL_KM || !route.profile_type || isTimeTrialProfile(route.profile_type)) return null;
  const available = riders.filter(r => !r.abandoned);
  if (!available.length || new Set(riders.map(r=>r.rider_id)).size !== riders.length) return null;
  const sourceRoles = Object.fromEntries(riders.map(r=>[r.rider_id,tacticsRole(priorRoles?.[r.rider_id]??r.role)]));
  const reference = available.map(r=>({...r,role:sourceRoles[r.rider_id]}));
  const target = teamPlanTarget(kind, reference);
  if (['gc', 'stage', 'sprint'].includes(kind) && !target) return null;
  const breakRiders = reference.filter(r => !leaders.has(planRole(r.role))).sort(byFit).slice(0, 2);
  if (kind === 'break' && breakRiders.length !== 2) return null;
  const desiredRoles = {...sourceRoles};
  if (kind === 'stage' && target) {
    for (const r of available) if (desiredRoles[r.rider_id] === 'captain') desiredRoles[r.rider_id] = 'helper';
    desiredRoles[target.rider_id] = 'captain';
  }
  if (kind === 'gc' && target && !['captain','co_captain'].includes(desiredRoles[target.rider_id])) desiredRoles[target.rider_id]='captain';
  if (kind === 'sprint' && target) desiredRoles[target.rider_id]='sprint_captain';
  // Flat-stage teamPlay otherwise protects the sprinter instead of the named leader.
  if (kind === 'gc' || kind === 'stage') for (const r of available) if (r.rider_id!==target?.rider_id && desiredRoles[r.rider_id]==='sprint_captain') desiredRoles[r.rider_id]='helper';
  const roles = Object.fromEntries(riders.map(r=>[r.rider_id,planRole(desiredRoles[r.rider_id])]));
  const roleChanges:TeamPlanRoleChange[] = available.filter(r=>tacticsRole(r.role)!==desiredRoles[r.rider_id]).map(r=>({riderId:r.rider_id,role:desiredRoles[r.rider_id]}));
  const final = (task: StagePlanTask): StagePlanLeg[] => [{task:'stay_sheltered'}, {task,from:{at:'final_km'}}];
  const save = () => final('ride_in');
  const storedIds = new Set((order.riders ?? []).map(r=>r.rider_id));
  let next: TeamPlanOrder & {riders:TeamPlanRow[]} = {
    ...order,
    breakaway_stance: kind === 'gc' ? 'neutral' : ['stage','sprint'].includes(kind) ? 'chase' : 'let_go',
    riders: [...(order.riders ?? []), ...available.filter(r=>!storedIds.has(r.rider_id)).map(r=>({rider_id:r.rider_id}))],
  };
  for (const rider of available) {
    const role = roles[rider.rider_id];
    let plan = save();
    if (kind === 'break' && breakRiders.some(r=>r.rider_id===rider.rider_id)) {
      plan = [{task:'breakaway'},{task:'ride_in',from:{at:'dropped'}}];
    } else if (kind === 'sprint') {
      if (rider.rider_id === target?.rider_id) plan = final('ride_for_result');
      else if (supports.has(role)) plan = final('sprint_train');
    } else if (kind === 'gc' || kind === 'stage') {
      if (rider.rider_id === target?.rider_id) {
        const suggested = suggestStagePlan({role,route,teamHasSprintCaptain:false});
        const decisive = suggested?.find(leg => leg.from && ['follow_moves','ride_for_result'].includes(leg.task))?.from;
        plan = kind === 'stage'
          ? [{task:'stay_sheltered'},{task:'attack',from:decisive ?? {at:'final_km'}}]
          : suggested ?? save();
      } else if (supports.has(role)) {
        plan = suggestStagePlan({role:'helper',route,teamHasSprintCaptain:false,luxuryHelper:desiredRoles[rider.rider_id]==='luxury_helper'}) ?? [{task:'shelter_leader'}];
      } else {
        // Same rule as the suggestion engine: a co-captain rides the captain's suggested
        // plan, and a free role rides his own role suggestion. Nobody outside the helpers
        // is quietly told to ride in (#7864).
        plan = suggestStagePlan({role,route,teamHasSprintCaptain:false}) ?? save();
      }
    }
    if (validateStagePlanLegs(plan,role,route) !== null) return null;
    next = setRiderPlan(next,rider.rider_id,plan);
    next = {...next,riders:next.riders.map(row=>row.rider_id===rider.rider_id?{...row,...legacyOrderFromPlan(plan)}:row)};
  }
  return {kind,target,order:next,roles,roleChanges,editableRiderIds:available.map(r=>r.rider_id),sourceRoles};
}

export type TaskCostWord = 'easy' | 'medium' | 'hard' | 'veryHard';
/** Qualitative price word per engine effort step, never a numerical fatigue prediction. */
export const EFFORT_COST_WORD: Readonly<Record<StagePlanEffort, TaskCostWord>> = Object.freeze({
  grupetto:'easy', save:'easy', normal:'medium', protect:'hard', all_out:'veryHard',
});
/**
 * The one named exception to "the word follows TASK_EFFORT": a breakaway runs on the
 * normal effort step, but the engine's condition model adds extra work for time spent
 * in a front group and for being caught (backend/lib/conditionModelV2.js). The legs
 * pay more than the step alone says, so the word stays Hard (owner choice A, #7864).
 */
export const TASK_COST_EXCEPTIONS: Readonly<Partial<Record<StagePlanTask, TaskCostWord>>> = Object.freeze({ breakaway:'hard' });
export function taskCostWord(task: StagePlanTask): TaskCostWord { return TASK_COST_EXCEPTIONS[task] ?? EFFORT_COST_WORD[TASK_EFFORT[task]]; }
export function taskCostKey(task: StagePlanTask): string { return `stagePlanReady.price.${taskCostWord(task)}`; }
type Matrix = Record<number, Record<string, {race_role:string;effort:string}>>;
export function applyTeamPlanRoles<T extends Matrix>(matrix: T, stage: number, changes: TeamPlanRoleChange[], editableIds?: string[]): T {
  const ordered=[...changes].sort((a,b)=>Number(leaders.has(planRole(a.role)))-Number(leaders.has(planRole(b.role))));
  const next = ordered.reduce((acc,change)=>applyRoleForRest({matrix:acc,riderId:change.riderId,role:change.role,stages:[stage]}) as T,matrix);
  if (!editableIds || next === matrix || !matrix[stage]) return next;
  const editable = new Set(editableIds);
  return {...next,[stage]:Object.fromEntries(Object.entries(next[stage]).map(([id,cell])=>[id,editable.has(id)?cell:matrix[stage][id]]))};
}

export function teamPlanFingerprint(order: TeamPlanOrder, roles: Record<string, StagePlanRole>): string {
  return JSON.stringify([order.breakaway_stance,(order.riders??[]).map(r=>[r.rider_id,roles[r.rider_id],r.plan??null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'en'))]);
}
