import test from 'node:test';
import assert from 'node:assert/strict';
import { tacticsRoleAvailability } from './tacticsRoleAvailability.ts';

test('server-approved roles can be selected before any rider has either role',()=>{
  assert.deepEqual(tacticsRoleAvailability({special_roles_allowed:true},[{race_role:'captain'},{race_role:'helper'}]),{coCaptainOn:true,luxuryHelperOn:true});
});
test('an explicit server refusal overrides existing special roles in the roster',()=>{
  assert.deepEqual(tacticsRoleAvailability({special_roles_allowed:false},[{race_role:'co_captain'},{race_role:'luxury_helper'}]),{coCaptainOn:false,luxuryHelperOn:false});
});
test('unknown capability values fail closed',()=>{
  for(const value of ['on','true',1,null,{},[]])assert.deepEqual(tacticsRoleAvailability({special_roles_allowed:value},[{race_role:'co_captain'},{race_role:'luxury_helper'}]),{coCaptainOn:false,luxuryHelperOn:false});
});
test('older API responses retain the previous per-role roster fallback',()=>{
  assert.deepEqual(tacticsRoleAvailability({},[{race_role:'co_captain'}]),{coCaptainOn:true,luxuryHelperOn:false});
  assert.deepEqual(tacticsRoleAvailability({},[{race_role:'luxury_helper'}]),{coCaptainOn:false,luxuryHelperOn:true});
  assert.deepEqual(tacticsRoleAvailability(null,[{race_role:'captain'}]),{coCaptainOn:false,luxuryHelperOn:false});
});
