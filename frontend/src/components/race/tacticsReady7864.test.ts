import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTeamPlan, teamPlanTarget, taskCostKey, applyTeamPlanRoles, TASK_COST_EXCEPTIONS, type TeamPlanRider, type TeamPlanKind } from './tacticsReady7864.ts';
import { STAGE_PLAN_TASKS as BACKEND_TASKS, TASK_EFFORT as BACKEND_TASK_EFFORT } from '../../../../backend/lib/stagePlan.ts';
import { suggestStagePlan, validateStagePlanLegs, type StagePlanRoute, type StagePlanRole } from './StagePlanModel.ts';
import { buildGroupTeamContexts } from '../../../../backend/lib/engine/v4/mechanics/teamPlay.ts';
import type { Entrant, RaceGroup, RiderState } from '../../../../backend/lib/engine/v4/types.ts';

const route: StagePlanRoute = { distance_km: 150, profile_type: 'mountain', summit_finish: true, climbs: [{index:0,km:90,name:'Climb',category:'1'}] };
const riders: TeamPlanRider[] = [
  {rider_id:'a',name:'Captain',role:'captain',routeMatch:70},
  {rider_id:'b',name:'Sprinter',role:'sprint_captain',routeMatch:40},
  {rider_id:'c',name:'Best fit',role:'helper',routeMatch:90},
  {rider_id:'d',name:'Hunter',role:'hunter',routeMatch:80},
  {rider_id:'e',name:'Free',role:'free_role',routeMatch:60},
  {rider_id:'out',name:'Abandoned',role:'helper',routeMatch:99,abandoned:true},
];
const order = {breakaway_stance:'neutral',riders:riders.map(r=>({rider_id:r.rider_id,effort:'normal',plan:null}))};
test('all five presets use valid existing tasks and preserve abandoned riders and input',()=>{
  const original=JSON.stringify({riders,order});
  for(const kind of ['gc','stage','sprint','break','save'] as TeamPlanKind[]){
    const result=buildTeamPlan(kind,{riders,route,order});assert.ok(result,kind);
    for(const row of result.order.riders){
      if(row.rider_id==='out'){assert.deepEqual(row,order.riders.at(-1));continue;}
      assert.equal(validateStagePlanLegs(row.plan,result.roles[row.rider_id] as StagePlanRole,route),null,kind+':'+row.rider_id);
    }
  }
  assert.equal(JSON.stringify({riders,order}),original);
});
test('stage win promotes the highest known fit, with stable tie and no fabricated score',()=>{
  assert.equal(teamPlanTarget('stage',riders)?.rider_id,'c');
  const result=buildTeamPlan('stage',{riders,route,order});assert.ok(result);
  assert.ok(result.roleChanges.some(change=>change.riderId==='b'&&change.role==='helper'));
  assert.ok(result.roleChanges.some(change=>change.riderId==='c'&&change.role==='captain'));
  assert.equal(result.roles.a,'helper');assert.equal(result.roles.c,'captain');
  const tie=riders.map(r=>({...r,routeMatch:80,abandoned:false}));
  assert.equal(teamPlanTarget('stage',tie)?.rider_id,'a');
  assert.equal(teamPlanTarget('stage',[{rider_id:'unknown',role:'captain',routeMatch:null}]),null);
});
test('stage win uses the existing named decisive point rather than always waiting for the final km',()=>{
  const result=buildTeamPlan('stage',{riders,route,order});assert.ok(result);
  const attack=result.order.riders.find(r=>r.rider_id===result.target?.rider_id)?.plan?.find(leg=>leg.task==='attack');
  assert.deepEqual(attack?.from,{at:'kom',kom_index:0});
  const flat=buildTeamPlan('stage',{riders,route:{...route,profile_type:'flat',summit_finish:false,climbs:[]},order});assert.ok(flat);
  assert.deepEqual(flat.order.riders.find(r=>r.rider_id===flat.target?.rider_id)?.plan?.find(leg=>leg.task==='attack')?.from,{at:'final_km'});
});
test('captain assignment changes only the current stage and preserves effort',()=>{
  const matrix={1:{a:{race_role:'captain',effort:'protect'},c:{race_role:'helper',effort:'save'}},2:{a:{race_role:'captain',effort:'normal'},c:{race_role:'helper',effort:'normal'}}};
  const next=applyTeamPlanRoles(matrix,1,[{riderId:'c',role:'captain'}]);
  assert.equal(next[1].a.race_role,'helper');assert.equal(next[1].c.race_role,'captain');
  assert.equal(next[1].a.effort,'protect');assert.equal(next[1].c.effort,'save');
  assert.deepEqual(next[2],matrix[2]);assert.equal(matrix[1].a.race_role,'captain');
});
test('captain replacement never edits the abandoned rider cell',()=>{
  const matrix={1:{out:{race_role:'captain',effort:'normal'},c:{race_role:'helper',effort:'save'}}};
  const next=applyTeamPlanRoles(matrix,1,[{riderId:'c',role:'captain'}],['c']);
  assert.deepEqual(next[1].out,matrix[1].out);
  assert.equal(next[1].c.race_role,'captain');
});
test('break sends exactly two non-leaders; sprint never assigns the sprinter to his own train',()=>{
  const br=buildTeamPlan('break',{riders,route,order});assert.ok(br);
  assert.equal(br.order.breakaway_stance,'let_go');
  assert.deepEqual(br.order.riders.filter(r=>r.plan?.[0]?.task==='breakaway').map(r=>r.rider_id),['c','d']);
  const sp=buildTeamPlan('sprint',{riders,route,order});assert.ok(sp);
  assert.ok(sp.order.riders.find(r=>r.rider_id==='c')?.plan?.some(l=>l.task==='sprint_train'));
  assert.equal(sp.order.riders.find(r=>r.rider_id==='c')?.leadout,true,'summary uses the same projected fields as save');
  assert.equal(br.order.riders.find(r=>r.rider_id==='c')?.try_break,true);
  assert.ok(!sp.order.riders.find(r=>r.rider_id==='b')?.plan?.some(l=>l.task==='sprint_train'));
});
test('locked, invalid-route, time-trial or missing-target choices do not mutate drafts',()=>{
  assert.equal(buildTeamPlan('gc',{riders,route,order,locked:true}),null);
  assert.equal(buildTeamPlan('gc',{riders,route:{...route,profile_type:'itt'},order}),null);
  assert.equal(buildTeamPlan('save',{riders,route:{...route,distance_km:0},order}),null);
  assert.equal(buildTeamPlan('gc',{riders:riders.filter(r=>r.role!=='captain'),route,order}),null);
  assert.equal(buildTeamPlan('sprint',{riders:riders.filter(r=>r.role!=='sprint_captain'),route,order}),null);
  assert.equal(buildTeamPlan('break',{riders:riders.slice(0,3),route,order}),null);
});
test('cost labels cover every existing task without numerical engine values',()=>{
  assert.equal(taskCostKey('stay_sheltered'),'stagePlanReady.price.easy');
  assert.equal(taskCostKey('follow_moves'),'stagePlanReady.price.hard','same effort step as tempo');
  assert.equal(taskCostKey('breakaway'),'stagePlanReady.price.hard');
  assert.equal(taskCostKey('sprint_train'),'stagePlanReady.price.medium','same effort step as shelter_leader');
  assert.equal(taskCostKey('attack'),'stagePlanReady.price.veryHard');
  assert.equal(taskCostKey('hunt_kom'),'stagePlanReady.price.hard');
});
test('price words follow the engine effort step (backend TASK_EFFORT), with breakaway as the only named exception',()=>{
  const expected:Record<string,string>={grupetto:'easy',save:'easy',normal:'medium',protect:'hard',all_out:'veryHard'};
  assert.deepEqual(Object.keys(TASK_COST_EXCEPTIONS),['breakaway'],'a new exception needs an explicit decision');
  for(const task of BACKEND_TASKS){
    const word=expected[BACKEND_TASK_EFFORT[task]];
    assert.ok(word,`unknown effort step for ${task}`);
    if(task==='breakaway'){
      assert.equal(BACKEND_TASK_EFFORT[task],'normal','exception only makes sense while breakaway sits on the normal step');
      assert.equal(taskCostKey(task),'stagePlanReady.price.hard');
      continue;
    }
    assert.equal(taskCostKey(task),`stagePlanReady.price.${word}`,task);
  }
});
test('team plan texts are translated in es/fr/nl and every language has the plural copy key',()=>{
  const read=(lng:string)=>JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/races.json`,import.meta.url),'utf8'));
  const flat=(obj:unknown,prefix=''):Record<string,string>=>Object.entries(obj as Record<string,unknown>).reduce<Record<string,string>>((acc,[k,v])=>typeof v==='string'?{...acc,[prefix+k]:v}:{...acc,...flat(v,prefix+k+'.')},{});
  const en=flat(read('en').stagePlanReady);
  assert.ok(Object.keys(en).length>0);
  assert.match(en['sprint.description'],/10 km/,'the train runs the final 10 km');
  // #7864: card texts only promise what the plans do.
  assert.doesNotMatch(en['gc.description'],/^Everyone/,'a shared captain and a free role do not ride for the GC leader');
  assert.doesNotMatch(en['save.description'],/tonight/i,'lowest fatigue is only true among the five plans');
  assert.match(read('da').intention.copyToStages,/etaperne/,'Danish plural on the copy button');
  for(const lng of ['en','da','es','fr','nl']){
    const data=read(lng);
    assert.deepEqual(Object.keys(flat(data.stagePlanReady)).sort(),Object.keys(en).sort(),lng);
    assert.match(data.intention.copyToStages,/\{\{?numbers\}?\}/,lng);
    if(lng==='en'||lng==='da') continue;
    // Name placeholders like "{name}" are identical across languages by design.
    for(const [key,value] of Object.entries(flat(data.stagePlanReady))) if(!/^\{+\w+\}+$/.test(value)) assert.notEqual(value,en[key],`${lng}: stagePlanReady.${key} is still English`);
  }
});
test('GC and Stage win protect their named target even with a sprint captain on flat stages',()=>{
  const flat={...route,profile_type:'flat',summit_finish:false,climbs:[]};
  for(const kind of ['gc','stage'] as const){
    const plan=buildTeamPlan(kind,{riders,route:flat,order});assert.ok(plan?.target);
    // The engine context reads only roles/team and racing status from these doubles.
    const entrants=Object.fromEntries(riders.map(r=>[r.rider_id,{rider_id:r.rider_id,team_id:'team',role:plan.roles[r.rider_id]}])) as Record<string,Entrant>;
    const states=Object.fromEntries(riders.map(r=>[r.rider_id,{status:r.abandoned?'abandoned':'racing'}])) as Record<string,RiderState>;
    const group={id:'field',kind:'peloton',rider_ids:riders.map(r=>r.rider_id),gap_seconds:0} as RaceGroup;
    assert.equal(buildGroupTeamContexts(group,entrants,states,'flat',true)[0].leaderId,plan.target.rider_id,kind);
  }
});
const coRiders: TeamPlanRider[] = [
  {rider_id:'cap',name:'Captain',role:'captain',routeMatch:90},
  {rider_id:'co',name:'Co-captain',role:'co_captain',routeMatch:80},
  {rider_id:'free',name:'Free',role:'free_role',routeMatch:70},
  {rider_id:'h1',name:'Helper',role:'helper',routeMatch:60},
  {rider_id:'h2',name:'Hunter',role:'hunter',routeMatch:50},
];
const coOrder = {breakaway_stance:'neutral',riders:coRiders.map(r=>({rider_id:r.rider_id,plan:null}))};
const coRoutes: Record<string,StagePlanRoute> = {
  flat: {distance_km:180,profile_type:'flat',summit_finish:false,climbs:[]},
  hilly: {distance_km:170,profile_type:'hilly',summit_finish:false,climbs:[{index:0,km:80,name:'A',category:'3'},{index:1,km:140,name:'B',category:'2'},{index:2,km:158,name:'C',category:'3'}]},
  mountain: {distance_km:160,profile_type:'high_mountain',summit_finish:true,climbs:[{index:0,km:70,name:'A',category:'1'},{index:1,km:125,name:'B',category:'HC'},{index:2,km:160,name:'C',category:'1'}]},
};
const planOf = (result: NonNullable<ReturnType<typeof buildTeamPlan>>, id: string) => result.order.riders.find(r=>r.rider_id===id)?.plan;
const quietRideIn = (plan: unknown) => JSON.stringify(plan) === JSON.stringify([{task:'stay_sheltered'},{task:'ride_in',from:{at:'final_km'}}]);
for (const [name, r] of Object.entries(coRoutes)) {
  test(`${name}: a co-captain rides the captain's plan and a free role his own suggestion in GC and Stage win`,()=>{
    for (const kind of ['gc','stage'] as const) {
      const result = buildTeamPlan(kind,{riders:coRiders,route:r,order:coOrder}); assert.ok(result,kind);
      assert.equal(result.target?.rider_id,'cap',kind);
      assert.equal(result.roles.co,'co_captain',kind);assert.equal(result.roles.free,'free_role',kind);
      const captainSuggestion = suggestStagePlan({role:'captain',route:r,teamHasSprintCaptain:false});
      assert.deepEqual(planOf(result,'co'),captainSuggestion,`${kind}: co-captain gets the captain's suggested plan`);
      if (kind === 'gc') assert.deepEqual(planOf(result,'co'),planOf(result,'cap'),'GC: same plan as the GC leader');
      assert.deepEqual(planOf(result,'free'),suggestStagePlan({role:'free_role',route:r,teamHasSprintCaptain:false}),`${kind}: free role suggestion`);
      assert.ok(!quietRideIn(planOf(result,'co')),`${kind}: co-captain is not told to ride in`);
      assert.ok(!quietRideIn(planOf(result,'free')),`${kind}: free role is not told to ride in`);
      assert.ok(!planOf(result,'co')?.some(l=>l.task==='attack'),`${kind}: the assistant never suggests an attack to the co-captain`);
    }
  });
  test(`${name}: all five plans for a team with captain, co-captain and free role validate against the role rules`,()=>{
    for (const kind of ['gc','stage','sprint','break','save'] as TeamPlanKind[]) {
      const withSprinter = kind === 'sprint' ? coRiders.map(x=>x.rider_id==='h1'?{...x,role:'sprint_captain'}:x) : coRiders;
      const result = buildTeamPlan(kind,{riders:withSprinter,route:r,order:coOrder}); assert.ok(result,kind);
      for (const row of result.order.riders) assert.equal(validateStagePlanLegs(row.plan,result.roles[row.rider_id] as StagePlanRole,r),null,`${kind}:${row.rider_id}`);
    }
  });
}
test('a co-captain who is the best fit for the stage becomes its captain; the old captain helps',()=>{
  const swapped = coRiders.map(x=>x.rider_id==='co'?{...x,routeMatch:99}:x);
  const result = buildTeamPlan('stage',{riders:swapped,route:coRoutes.hilly,order:coOrder}); assert.ok(result);
  assert.equal(result.target?.rider_id,'co');assert.equal(result.roles.co,'captain');assert.equal(result.roles.cap,'helper');
  assert.ok(planOf(result,'co')?.some(l=>l.task==='attack'));
  assert.equal(planOf(result,'cap')?.[0]?.task,'shelter_leader');
});
test('switching presets can restore the nominated sprinter after GC temporarily changes his role',()=>{
  const sourceRoles=Object.fromEntries(riders.map(r=>[r.rider_id,r.role]));
  const changed=riders.map(r=>({...r,role:r.rider_id==='b'?'helper':r.role}));
  const sprint=buildTeamPlan('sprint',{riders:changed,route,order,sourceRoles});
  assert.ok(sprint);assert.equal(sprint.target?.rider_id,'b');
  assert.ok(sprint.roleChanges.some(change=>change.riderId==='b'&&change.role==='sprint_captain'));
});
