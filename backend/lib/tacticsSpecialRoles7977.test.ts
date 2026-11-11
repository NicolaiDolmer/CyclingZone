import test from 'node:test';
import assert from 'node:assert/strict';
import { raceAllowsCoCaptain } from './raceSelection.js';
import { validateStageRoleOverrides } from './raceStageRolesApi.js';

const ids=Array.from({length:8},(_,i)=>`r${i+1}`);
const baseRoleByRider=new Map(ids.map((id,i)=>[id,i===0?'captain':'helper']));
const overrides=[
  {stage_number:2,rider_id:'r4',race_role:'co_captain',effort:'normal'},
  {stage_number:2,rider_id:'r5',race_role:'luxury_helper',effort:'normal'},
];
test('#7977 shared lineup capability and actual stage-role validator agree without preselected special roles',()=>{
  for(const revision of ['s5_profiles_v3','orders_gc_v1','unknown']){
    const allowed=raceAllowsCoCaptain({engine_rules_revision:revision,stages_completed:1});
    const result=validateStageRoleOverrides({overrides,coCaptainAllowed:allowed,raceCompleted:false,stageCount:3,stagesCompleted:1,teamRiderIds:new Set(ids),baseRoleByRider,abandonedRiderIds:new Set()});
    assert.equal(allowed,revision==='s5_profiles_v3');
    assert.equal(result.ok,allowed);
    if(!allowed)assert.ok(result.errors.includes('stage_roles_invalid_role'));
  }
});
