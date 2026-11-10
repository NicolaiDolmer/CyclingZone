import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamPlan, teamPlanTarget, taskCostKey, applyTeamPlanRoles, type TeamPlanRider, type TeamPlanKind } from './tacticsReady7864.ts';
import { validateStagePlanLegs, type StagePlanRoute, type StagePlanRole } from './StagePlanModel.ts';
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
  assert.equal(taskCostKey('follow_moves'),'stagePlanReady.price.medium');
  assert.equal(taskCostKey('breakaway'),'stagePlanReady.price.hard');
  assert.equal(taskCostKey('sprint_train'),'stagePlanReady.price.hard');
  assert.equal(taskCostKey('attack'),'stagePlanReady.price.veryHard');
  assert.equal(taskCostKey('hunt_kom'),'stagePlanReady.price.hard');
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
test('switching presets can restore the nominated sprinter after GC temporarily changes his role',()=>{
  const sourceRoles=Object.fromEntries(riders.map(r=>[r.rider_id,r.role]));
  const changed=riders.map(r=>({...r,role:r.rider_id==='b'?'helper':r.role}));
  const sprint=buildTeamPlan('sprint',{riders:changed,route,order,sourceRoles});
  assert.ok(sprint);assert.equal(sprint.target?.rider_id,'b');
  assert.ok(sprint.roleChanges.some(change=>change.riderId==='b'&&change.role==='sprint_captain'));
});
