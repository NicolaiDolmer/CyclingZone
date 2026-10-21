import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBenchmarkTarget,TARGET} from './measureRankingShadow6765.mjs';
const env={CZ_TARGET_ENV:'loadtest-staging',CZ_LOADTEST_WRAPPER:'1',
  SUPABASE_URL:'https://'+TARGET+'.supabase.co',
  SUPABASE_DB_URL:'postgresql://postgres.'+TARGET+':test-only@aws-0-eu.pooler.supabase.com:5432/postgres'};
test('benchmark accepts only the approved branch through its clean wrapper',()=>{
  assert.equal(assertBenchmarkTarget(env).username,'postgres.'+TARGET);
  for(const patch of [{CZ_LOADTEST_WRAPPER:''},{CZ_TARGET_ENV:'production'},{SUPABASE_URL:'https://wrong.supabase.co'},
    {SUPABASE_DB_URL:'postgresql://postgres:unused@db.ghwvkxzhsbbltzfnuhhz.supabase.co/postgres'}])
    assert.throws(()=>assertBenchmarkTarget({...env,...patch}),/required|not the approved/);
});
