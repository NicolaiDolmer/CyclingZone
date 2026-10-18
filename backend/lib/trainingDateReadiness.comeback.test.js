// #6811: varig parkeringsperiode. Et hold der var parkeret og kom tilbage, faar
// ikke de missede traeningsdatoer efter en genstart af processen.
//
// Scenariet koerer den AEGTE loadTrainingDateIndex + loadTrainingDateContext +
// runNormalizedTrainingDateSweep mod en lille fake-klient; kun skrivninger
// (registerWork/runDay) og loebsdags-spaendene er injiceret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTrainingDateTeam, loadTrainingDateTeams, trainingDateBounds, loadTrainingDateContext } from './trainingDateReadiness.js';
import { loadTrainingDateIndex, runNormalizedTrainingDateSweep, __resetNormalizedTrainingDateCacheForTests } from './trainingDateClose.js';

const D1 = '2026-10-10', D2 = '2026-10-11', D3 = '2026-10-12';
const SEASON = { id: 'season', number: 4, start_date: D1, end_date: '2026-12-31', status: 'active' };
// 10:00 dansk tid paa D3: D1 og D2 sluttede foer comebacket, D3 slutter efter.
const COMEBACK_AT = '2026-10-12T08:00:00.000Z';

test('isTrainingDateTeam: datoer der sluttede foer comebacket taeller ikke', () => {
  const none = new Set();
  const returned = { id: 'a', league_division_id: 'd', parked_at: null, comeback_at: COMEBACK_AT };
  assert.equal(isTrainingDateTeam(returned, none, trainingDateBounds(D2).end), false);
  assert.equal(isTrainingDateTeam(returned, none, trainingDateBounds(D3).end), true, 'comeback-dagen taeller');
  assert.equal(isTrainingDateTeam(returned, new Set(['a']), trainingDateBounds(D2).end), true, 'registreret arbejde afregnes altid');
  // Aktive hold uden comeback er uaendrede.
  assert.equal(isTrainingDateTeam({ id: 'b', league_division_id: 'd' }, none, trainingDateBounds(D1).end), true);
  assert.equal(isTrainingDateTeam({ id: 'b', league_division_id: 'd', comeback_at: null }, none, trainingDateBounds(D1).end), true);
});

// Fake-klient: filtre ignoreres (scenariet har kun de raekker der skal ses), med
// undtagelse af training_date_work, som indexet laeser som "pending/partial".
function fakeClient(state, { missingComebackAt = false } = {}) {
  return {
    from(table) {
      let columns = '';
      const rows = () => table === 'training_date_work'
        ? state.work.filter(row => ['pending', 'partial'].includes(row.status))
        : (state[table] ?? []);
      const result = () => (missingComebackAt && table === 'teams' && columns.includes('comeback_at'))
        ? { data: null, error: { code: '42703', message: 'column teams.comeback_at does not exist' } }
        : { data: rows(), error: null };
      const query = {
        select(cols) { columns = cols; return this; },
        eq() { return this; }, in() { return this; }, not() { return this; }, is() { return this; },
        gte() { return this; }, lt() { return this; }, order() { return this; },
        async range() { return result(); },
        async maybeSingle() { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
        async single() { return this.maybeSingle(); },
        then(ok, fail) { return Promise.resolve(result()).then(ok, fail); },
      };
      return query;
    },
  };
}

function scenario({ teamA }) {
  const state = {
    seasons: [SEASON],
    app_config: [{ key: 'training_condition_activation_date', value: D1 }],
    teams: [teamA, { id: 'B', league_division_id: 'div', is_ai: false }],
    riders: [{ id: 'a1', team_id: 'A' }, { id: 'b1', team_id: 'B' }],
    work: [],
  };
  const ran = [];
  const options = {
    supabase: fakeClient(state), elapsedClock: () => 0, logger: { error() {} },
    loadIndex: loadTrainingDateIndex,
    loadContext: loadTrainingDateContext,
    loadDaySpans: async () => new Map([['div', { gameDays: [1] }]]),
    loadWorkRows: async ({ tickDate }) => state.work.filter(row => row.tick_date === tickDate),
    registerWork: async ({ teamId, tickDate, gameDays, riderIds }) => {
      const row = { team_id: teamId, tick_date: tickDate, game_days: gameDays, expected_rider_ids: riderIds, status: 'pending' };
      state.work.push(row); return row;
    },
    runDay: async ({ teamId, tickDateOverride }) => {
      ran.push(`${teamId}:${tickDateOverride}`);
      state.work.find(row => row.team_id === teamId && row.tick_date === tickDateOverride).status = 'complete';
      return { alreadyRan: false };
    },
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  return { state, ran, options };
}

async function parkThenReturnThenRestart(comebackAt) {
  __resetNormalizedTrainingDateCacheForTests();
  const teamA = { id: 'A', league_division_id: null, is_ai: false, parked_at: '2026-10-01T10:00:00Z' };
  const { state, ran, options } = scenario({ teamA });
  // Proces 1: D1 og D2 afregnes, mens A er parkeret (21:00 dansk tid paa D2).
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-11T19:00:00Z') });
  // Comeback paa D3 (returnParkedTeam): parked_at nulstilles, division saettes.
  Object.assign(teamA, { parked_at: null, league_division_id: 'div', comeback_season_id: SEASON.id, comeback_at: comebackAt });
  // Genstart: cachen i processen er tom, indexet gennemgaar D1..D3 igen.
  __resetNormalizedTrainingDateCacheForTests();
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-12T19:00:00Z') });
  return { ran, state };
}

test('parkeret, tilbage, genstart: ingen tildeling for de parkerede datoer', async () => {
  const { ran, state } = await parkThenReturnThenRestart(COMEBACK_AT);
  assert.deepEqual(ran.filter(id => id.startsWith('A:')), [`A:${D3}`]);
  assert.equal(state.work.some(row => row.team_id === 'A' && row.tick_date !== D3), false, 'intet arbejde registreret for parkerede datoer');
  // Det aktive hold er uaendret: hver dato praecis een gang.
  assert.deepEqual(ran.filter(id => id.startsWith('B:')).sort(), [`B:${D1}`, `B:${D2}`, `B:${D3}`]);
});

test('kontrol: uden comeback_at faar holdet de missede datoer efter genstart (fejlen fra #6811)', async () => {
  const { ran } = await parkThenReturnThenRestart(null);
  assert.deepEqual(ran.filter(id => id.startsWith('A:')).sort(), [`A:${D1}`, `A:${D2}`, `A:${D3}`]);
});

test('deploy-vinduet: mangler teams.comeback_at, laeses holdene uden kolonnen', async () => {
  const state = { teams: [{ id: 'A' }] };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await loadTrainingDateTeams(fakeClient(state, { missingComebackAt: true })), [{ id: 'A' }]);
  } finally { console.warn = warn; }
  const other = { from: () => ({ select() { return this; }, order() { return this; }, async range() { return { data: null, error: { code: '42501', message: 'permission denied' } }; } }) };
  await assert.rejects(loadTrainingDateTeams(other), /permission denied/);
});

// #6811 P2: GET /api/training/me giver en lukket gate for et parkeret hold, ogsaa
// paa stien med training_condition_per_date slukket (POST svarer 409 team_parked).
test('GET /training/me: et parkeret hold har lukket gate', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../routes/api.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('router.get("/training/me"');
  const block = source.slice(start, source.indexOf('\n});', start));
  assert.ok(start >= 0);
  assert.match(block, /const parked = req\.team\.parked_at != null;/);
  assert.match(block, /const enabled = !parked && evaluateFlagStage\(stage, \{ isBetaTester \}\);/);
  assert.match(block, /const close = parked \? \{ closed: false, reason: "team_parked", gameDays: \[\] \}/);
});
