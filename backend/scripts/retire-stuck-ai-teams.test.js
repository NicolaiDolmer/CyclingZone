import test from 'node:test';
import assert from 'node:assert/strict';

import { blockedSuffix, formatReleaseTime, planRetirements } from './retire-stuck-ai-teams.js';

function makeSupabase(state, planByPool) {
  function builder(table) {
    const filters = [];
    const rows = () => {
      let out = [...(state[table] || [])];
      for (const [col, val] of filters) out = out.filter((r) => val.includes(r[col]));
      return out;
    };
    const api = {
      select() { return api; },
      eq() { return api; },
      neq() { return api; },
      gt() { return api; },
      in(c, v) { filters.push([c, v]); return api; },
      order() { return api; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      then(resolve) { return resolve({ data: rows(), error: null }); },
    };
    return api;
  }
  return {
    from: builder,
    rpc: async (name, params) => {
      assert.equal(name, 'plan_ai_pool_retirements');
      return { data: planByPool[params.p_pool_id] ?? [], error: null };
    },
  };
}

// Pulje 13: 25 hold, alle AI-kandidater blokeret af et igangvaerende etapeloeb.
function seedBlockedPool() {
  const teams = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`, is_ai: i > 8, is_bank: false, league_division_id: 13,
  }));
  return {
    state: {
      league_divisions: [{ id: 13, tier: 4, pool_index: 0, label: 'Division 4 - F' }],
      teams,
      riders: [{ id: 'r1', team_id: 't9' }],
      race_entries: [{ race_id: 'R1', team_id: 't9', rider_id: 'r1' }],
      races: [{ id: 'R1', status: 'scheduled', stages_completed: 2 }],
      race_stage_claims: [],
      race_stage_schedule: [
        { race_id: 'R1', stage_number: 1, scheduled_at: '2026-09-12T10:00:00Z' },
        { race_id: 'R1', stage_number: 4, scheduled_at: '2026-09-14T18:48:00Z' },
      ],
    },
    planByPool: {
      13: [{ team_id: 't9', team_name: 'Drivetrain Devo', reason: 'inflight_entries',
        pending_since: '2026-09-09T18:48:00Z', blocked_since: '2026-09-09T18:48:00Z',
        riders_count: 1, offers_preserved: 0, future_entries_removed: 0 }],
    },
  };
}

test('#4959 dry-run viser hvornaar et loebs-blokeret hold bliver frit', async () => {
  const { state, planByPool } = seedBlockedPool();
  const plan = await planRetirements({ supabase: makeSupabase(state, planByPool) });
  const blocked = plan.pools[0].blocked[0];
  assert.equal(blocked.reason, 'inflight_entries');
  assert.equal(blocked.inflight_races, 1);
  assert.equal(blocked.last_race_ends_at, '2026-09-14T18:48:00.000Z');
  // 18:48 UTC er 20:48 dansk sommertid - ejeren laeser kun dansk lokaltid.
  assert.match(blockedSuffix(blocked), /last in-flight race ends 2026-09-14 20:48 CPH/);
  assert.equal(plan.total_candidates, 0);
  assert.equal(plan.total_blocked, 1);
});

test('#4959 et igangvaerende loeb uden etape-plan vises som ukendt, ikke som en dato', async () => {
  const { state, planByPool } = seedBlockedPool();
  state.race_stage_schedule = [];
  const plan = await planRetirements({ supabase: makeSupabase(state, planByPool) });
  const blocked = plan.pools[0].blocked[0];
  assert.equal(blocked.last_race_ends_at, null);
  assert.match(blockedSuffix(blocked), /last in-flight race ends: unknown/);
});

test('#4959 markedsblokeringer faar ingen loebs-dato paahaeftet', async () => {
  const { state, planByPool } = seedBlockedPool();
  planByPool[13][0].reason = 'live_transfer_offers';
  const plan = await planRetirements({ supabase: makeSupabase(state, planByPool) });
  const blocked = plan.pools[0].blocked[0];
  assert.equal(blocked.last_race_ends_at, undefined);
  assert.equal(blockedSuffix(blocked), '');
});

test('#4959 ubrugelig tidsstempel giver ingen dato', () => {
  assert.equal(formatReleaseTime(null), null);
  assert.equal(formatReleaseTime('ikke-en-dato'), null);
});

test('#4959 en ledig kandidat rapporteres stadig som kandidat (ingen dato-sti)', async () => {
  const { state, planByPool } = seedBlockedPool();
  planByPool[13] = [{ team_id: 't10', team_name: 'Tarmac Devo', reason: null,
    pending_since: '2026-09-09T18:48:00Z', blocked_since: null,
    riders_count: 20, offers_preserved: 3, future_entries_removed: 4 }];
  const plan = await planRetirements({ supabase: makeSupabase(state, planByPool) });
  assert.equal(plan.total_candidates, 1);
  assert.equal(plan.total_blocked, 0);
  assert.equal(plan.pools[0].teams_now, 25);
  assert.equal(plan.pools[0].teams_after, 24);
});
