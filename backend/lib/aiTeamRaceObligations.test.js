import test from 'node:test';
import assert from 'node:assert/strict';

import { inflightReleaseByTeam } from './aiTeamRaceObligations.js';

// Minimal PostgREST-mock: thenable builder over et state-objekt, med .range() saa
// fetchAllRows kan paginere. Kun de filtre modulet faktisk bruger er implementeret.
function makeSupabase(state) {
  const queries = [];
  function builder(table) {
    const filters = [];
    const rows = () => {
      let out = [...(state[table] || [])];
      for (const [op, col, val] of filters) {
        if (op === 'eq') out = out.filter((r) => r[col] === val);
        if (op === 'neq') out = out.filter((r) => r[col] !== val);
        if (op === 'gt') out = out.filter((r) => (r[col] ?? 0) > val);
        if (op === 'in') out = out.filter((r) => val.includes(r[col]));
      }
      return out;
    };
    const api = {
      select() { return api; },
      eq(c, v) { filters.push(['eq', c, v]); return api; },
      neq(c, v) { filters.push(['neq', c, v]); return api; },
      gt(c, v) { filters.push(['gt', c, v]); return api; },
      in(c, v) { queries.push({ table, column: c, ids: v }); filters.push(['in', c, v]); return api; },
      order() { return api; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      then(resolve) { return resolve({ data: rows(), error: null }); },
    };
    return api;
  }
  return { from: builder, __queries: queries };
}

const stage = (raceId, n, at) => ({ race_id: raceId, stage_number: n, scheduled_at: at });

// Et hold der koerer et etapeloeb: loebet er startet (stages_completed > 0) og har
// tre etaper i kalenderen. Frigivelsen er den SIDSTE planlagte etape.
function seedRunningStageRace() {
  return {
    teams: [{ id: 'ai1' }],
    riders: [{ id: 'ai1-r1', team_id: 'ai1' }, { id: 'ai1-r2', team_id: 'ai1' }],
    race_entries: [
      { race_id: 'R1', team_id: 'ai1', rider_id: 'ai1-r1' },
      { race_id: 'R1', team_id: 'ai1', rider_id: 'ai1-r2' },
    ],
    races: [{ id: 'R1', status: 'scheduled', stages_completed: 1 }],
    race_stage_claims: [],
    race_stage_schedule: [
      stage('R1', 1, '2026-09-12T10:00:00Z'),
      stage('R1', 2, '2026-09-13T10:00:00Z'),
      stage('R1', 3, '2026-09-14T18:48:00Z'),
    ],
  };
}

test('#4959 blokeret hold: frigivelsen er sidste planlagte etape i det igangvaerende loeb', async () => {
  const state = seedRunningStageRace();
  const release = await inflightReleaseByTeam(makeSupabase(state), ['ai1']);
  assert.deepEqual(release.get('ai1').raceIds, ['R1']);
  assert.equal(release.get('ai1').lastStageAt, '2026-09-14T18:48:00.000Z');
  assert.deepEqual(release.get('ai1').unscheduledRaceIds, []);
});

test('#4959 afsluttede og endnu ikke startede loeb holder ikke holdet aabent', async () => {
  const state = seedRunningStageRace();
  state.races.push(
    { id: 'R2', status: 'completed', stages_completed: 4 },
    { id: 'R3', status: 'scheduled', stages_completed: 0 },
  );
  state.race_entries.push(
    { race_id: 'R2', team_id: 'ai1', rider_id: 'ai1-r1' },
    { race_id: 'R3', team_id: 'ai1', rider_id: 'ai1-r1' },
  );
  state.race_stage_schedule.push(
    stage('R2', 1, '2026-09-01T10:00:00Z'),
    stage('R3', 1, '2026-09-20T10:00:00Z'), // senere end R1, men loebet er ikke i gang
  );
  const release = await inflightReleaseByTeam(makeSupabase(state), ['ai1']);
  assert.deepEqual(release.get('ai1').raceIds, ['R1']);
  assert.equal(release.get('ai1').lastStageAt, '2026-09-14T18:48:00.000Z');
});

// Samme diskriminator som ai_team_retirement_reason: en etape-claim goer et loeb
// igangvaerende, ogsaa foer den foerste etape er talt med i stages_completed.
test('#4959 et claimet loeb taeller som igangvaerende', async () => {
  const state = seedRunningStageRace();
  state.races = [{ id: 'R1', status: 'scheduled', stages_completed: 0 }];
  state.race_stage_claims = [{ race_id: 'R1', stage_index: 0 }];
  const release = await inflightReleaseByTeam(makeSupabase(state), ['ai1']);
  assert.deepEqual(release.get('ai1').raceIds, ['R1']);
  assert.equal(release.get('ai1').lastStageAt, '2026-09-14T18:48:00.000Z');
});

// En entry-raekke kan baere et andet team_id end rytterens nuvaerende hold; det er
// rytteren der binder, praecis som SQL'ens rider_id-gren.
test('#4959 en rytters entry binder hans hold selv om entry-raekken staar paa et andet hold', async () => {
  const state = seedRunningStageRace();
  state.race_entries = [{ race_id: 'R1', team_id: 'other', rider_id: 'ai1-r1' }];
  const release = await inflightReleaseByTeam(makeSupabase(state), ['ai1']);
  assert.deepEqual(release.get('ai1').raceIds, ['R1']);
});

test('#4959 et igangvaerende loeb uden etape-plan giver ukendt frigivelse, ikke en for tidlig dato', async () => {
  const state = seedRunningStageRace();
  state.races.push({ id: 'R4', status: 'scheduled', stages_completed: 2 });
  state.race_entries.push({ race_id: 'R4', team_id: 'ai1', rider_id: 'ai1-r1' });
  const release = await inflightReleaseByTeam(makeSupabase(state), ['ai1']);
  assert.deepEqual(release.get('ai1').raceIds, ['R1', 'R4']);
  assert.deepEqual(release.get('ai1').unscheduledRaceIds, ['R4']);
});

test('#4959 ublokerede hold og tom holdliste laver ingen opslag', async () => {
  const supabase = makeSupabase(seedRunningStageRace());
  assert.equal((await inflightReleaseByTeam(supabase, [])).size, 0);
  assert.equal(supabase.__queries.length, 0);
  const noRaces = makeSupabase({ teams: [{ id: 'ai2' }], riders: [], race_entries: [], races: [] });
  assert.equal((await inflightReleaseByTeam(noRaces, ['ai2'])).size, 0);
});
