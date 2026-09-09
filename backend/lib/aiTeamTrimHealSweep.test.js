import test from 'node:test';
import assert from 'node:assert/strict';
import { runAiTeamTrimHealSweep, STALE_BACKSTOP_HOURS } from './aiTeamTrimHealSweep.js';
import { runAiPoolRetirementSweep } from './aiPoolRetirement.js';

const now = new Date('2026-09-09T12:00:00Z');
function client(plans, failures = [], failedTeams = []) {
  const calls=[];
  return { calls,
    from() { return { select() { return this; }, order() { return this; },
      async range() { return { data: Object.keys(plans).map(id=>({id:Number(id)})), error:null }; },
    }; },
    async rpc(name,args) {
      calls.push({name,args});
      if (failedTeams.includes(args.p_team_id)) return {error:{message:'injected retirement failure'}};
      if (failures.includes(args.p_pool_id)) return {error:{message:'injected DB failure'}};
      return {data:name==='plan_ai_pool_retirements' ? plans[args.p_pool_id] :
        name==='retire_ai_pool_team' ? {retired:true,ridersRetired:1} : {reserved:1,cleared:0},error:null};
    },
  };
}
const candidate = overrides => ({team_id:'ai1',reason:'inflight_entries',
  pending_since:'2026-08-01T00:00:00Z',blocked_since:'2026-09-09T11:00:00Z',...overrides});
async function sweep(supabase, extra={}) {
  return runAiPoolRetirementSweep({supabase,now,backstopHours:STALE_BACKSTOP_HOURS,
    getStalledIds:async()=>[],...extra});
}

test('a superseded blocker does not age a currently legitimate wait (#4828)',async()=>{
  const result=await sweep(client({13:[candidate({})]}));
  assert.equal(result.stale.length,0);
  assert.equal(result.healed,0);
});
test('unchanged blocker beyond the backstop is reported, never forced',async()=>{
  const sb=client({13:[candidate({blocked_since:'2026-09-01T00:00:00Z'})]});
  const result=await sweep(sb);
  assert.equal(result.stale[0].reason,'pending_exceeds_backstop');
  assert.ok(!sb.calls.some(c=>c.name==='retire_ai_pool_team'));
});
test('stalled race is reported immediately, even with a recent blocker clock (#2434)',async()=>{
  const result=await sweep(client({13:[candidate({})]}),{
    getStalledIds:async()=>['race1'],teamBlockingRaceIds:async()=>['race1'],
  });
  assert.equal(result.stale[0].reason,'blocking_race_stalled');
});
test('pool failure cannot stop reconciliation of later pools',async()=>{
  const result=await sweep(client({13:[candidate({})],14:[candidate({reason:null})]},[13]));
  assert.equal(result.failed,1);
  assert.equal(result.healed,1);
});
test('unavailable flag pauses the sweep before any planning or mutation',async()=>{
  const sb=client({13:[candidate({reason:null})]});
  const result=await runAiTeamTrimHealSweep({supabase:sb,now,isRetireEnabled:async()=>false});
  assert.equal(result.paused,true);
  assert.deepEqual(sb.calls,[]);
});

test('persistent retirement errors use the stale alert, preserving per-team isolation (#4594)',async()=>{
  const result=await sweep(client({13:[candidate({reason:null,blocked_since:'2026-09-01T00:00:00Z'}),
    candidate({team_id:'ai2',reason:null})]},[],['ai1']));
  assert.equal(result.stale[0].reason,'error_exceeds_backstop');
  assert.equal(result.healed,1);
  assert.equal(result.failed,0);
});
