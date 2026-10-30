// #7282 (ejer 26/10): ingen saesonpause. Datoerne mellem forrige saesons sidste dato
// og den nye saesons foerste loebsdato er rene traeningsdatoer i den nye saeson, med
// 5 loebsdage uden loeb pr. dato.
//
// Scenariet koerer den AEGTE loadTrainingDateIndex + loadTrainingDateContext +
// runNormalizedTrainingDateSweep mod en lille fake-klient; kun skrivninger
// (registerWork/runDay) og loebsdags-spaendene er injiceret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeGameDays, loadSeasonBridgeBounds, loadTrainingDateContext, trainingDateDeadline, BRIDGE_SLOTS_PER_DATE } from './trainingDateReadiness.js';
import { loadTrainingDateIndex, runNormalizedTrainingDateSweep, __resetNormalizedTrainingDateCacheForTests } from './trainingDateClose.js';

const S4 = { id: 's4', number: 4, status: 'completed', start_date: '2026-09-28', end_date: '2026-10-25' };
const S5 = { id: 's5', number: 5, status: 'active', start_date: '2026-10-28', end_date: null };

test('bridgeGameDays: negative loebsdage talt tilbage fra foerste loebsdato', () => {
  const bounds = { firstRaceDate: '2026-10-28', previousEndDate: '2026-10-25' };
  assert.equal(BRIDGE_SLOTS_PER_DATE, 5);
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-26', ...bounds }), [-10, -9, -8, -7, -6]);
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-27', ...bounds }), [-5, -4, -3, -2, -1]);
  // Forrige saesons sidste dato og den nye saesons foerste loebsdato er ikke broen.
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-25', ...bounds }), []);
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-28', ...bounds }), []);
  // Ukendt forrige saeson: ingen bro (vi opfinder aldrig en dato paa et gaet).
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-26', firstRaceDate: '2026-10-28', previousEndDate: null }), []);
  // Saesoner der starter dagen efter: ingen bro.
  assert.deepEqual(bridgeGameDays({ tickDate: '2026-10-26', firstRaceDate: '2026-10-26', previousEndDate: '2026-10-25' }), []);
});

// Fake-klient der respekterer eq-filtre paa seasons/app_config; training_date_work
// laeses som "pending/partial" ligesom indexet spoerger.
function fakeClient(state) {
  return {
    from(table) {
      const filters = [];
      const rows = () => {
        if (table === 'training_date_work') return state.work.filter(row => ['pending', 'partial'].includes(row.status));
        const base = state[table] ?? [];
        return ['seasons', 'app_config'].includes(table)
          ? base.filter(row => filters.every(([col, value]) => String(row[col]) === String(value)))
          : base;
      };
      const result = () => ({ data: rows(), error: null });
      return {
        select() { return this; },
        eq(col, value) { filters.push([col, value]); return this; },
        in() { return this; }, not() { return this; }, is() { return this; },
        gte() { return this; }, lt() { return this; }, order() { return this; },
        // #6924: the index also looks up the just-completed season's final date.
        limit() { return this; }, contains() { return this; },
        async range() { return result(); },
        async maybeSingle() { return { data: rows()[0] ?? null, error: null }; },
        async single() { return this.maybeSingle(); },
        then(ok, fail) { return Promise.resolve(result()).then(ok, fail); },
      };
    },
  };
}

function scenario() {
  const state = {
    seasons: [S4, { ...S5 }],
    app_config: [{ key: 'training_condition_activation_date', value: '2026-09-29' }],
    teams: [{ id: 'A', league_division_id: 'd1', is_ai: false }, { id: 'B', league_division_id: 'd4', is_ai: true }],
    riders: [{ id: 'a1', team_id: 'A' }, { id: 'b1', team_id: 'B' }],
    races: [], race_stage_schedule: [], training_race_loads: [],
    work: [],
  };
  const ran = [], registrations = [], quarantined = [];
  const options = {
    supabase: fakeClient(state), elapsedClock: () => 0, logger: { error() {} },
    loadIndex: loadTrainingDateIndex,
    loadContext: loadTrainingDateContext,
    // Broens datoer har ingen etaper og dermed ingen spaend.
    loadDaySpans: async () => new Map(),
    loadWorkRows: async ({ tickDate }) => state.work.filter(row => row.tick_date === tickDate),
    // Spejler RPC'erne: register_training_date_work gemmer kun snapshot foer fristen;
    // register_training_bridge_date_work (lateBridge) gemmer det ogsaa efter.
    registerWork: async ({ teamId, seasonId, tickDate, gameDays, riderIds, now, lateBridge }) => {
      registrations.push({ teamId, tickDate, lateBridge: Boolean(lateBridge) });
      if (lateBridge && state.bridgeRpcMissing) return null;
      const inTime = now < trainingDateDeadline(tickDate);
      // Bro-RPC'ens kronologi-vagt: senere arbejde paa holdet => intet snapshot.
      const laterWork = state.work.some(row => row.team_id === teamId && row.tick_date > tickDate);
      const opening_conditions = inTime || (lateBridge && !laterWork) ? Object.fromEntries(riderIds.map(id => [id, { form: 50, fatigue: 0 }])) : {};
      const row = { team_id: teamId, season_id: seasonId, tick_date: tickDate, game_days: gameDays, expected_rider_ids: riderIds, status: 'pending', opening_conditions };
      state.work.push(row); return row;
    },
    quarantineRiders: async ({ teamId, tickDate, riderIds }) => { quarantined.push({ teamId, tickDate, riderIds }); },
    runDay: async ({ teamId, seasonId, tickDateOverride, gameDay, dateGameDays }) => {
      ran.push({ teamId, seasonId, tickDate: tickDateOverride, gameDay, dateGameDays });
      const row = state.work.find(r => r.team_id === teamId && r.tick_date === tickDateOverride);
      if (gameDay === row.game_days.at(-1)) row.status = 'complete';
      return { alreadyRan: false };
    },
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  return { state, ran, registrations, quarantined, options };
}

test('indexet starter dagen efter forrige saesons sidste dato', async () => {
  const { options } = scenario();
  // 27/10 kl. 21 dansk tid: 26/10 indhentes, 27/10 er dagens dato.
  const index = await loadTrainingDateIndex({ supabase: options.supabase, now: new Date('2026-10-27T20:00:00Z') });
  assert.deepEqual(index.jobs.map(job => job.tickDate), ['2026-10-26', '2026-10-27']);
  assert.ok(index.jobs.every(job => job.season.id === 's5'), 'broen hoerer til den nye saeson');
  // Foer kl. 20 er dagens dato ikke med endnu.
  const early = await loadTrainingDateIndex({ supabase: options.supabase, now: new Date('2026-10-27T10:00:00Z') });
  assert.deepEqual(early.jobs.map(job => job.tickDate), ['2026-10-26']);
});

test('sweepen giver alle divisioner 5 traeninger pr. brodato, 26/10 indhentes, praecis een gang', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const { state, ran, registrations, quarantined, options } = scenario();
  const summary = await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-27T20:00:00Z') });
  assert.equal(summary.failed, 0);
  for (const teamId of ['A', 'B']) {
    assert.deepEqual(ran.filter(r => r.teamId === teamId && r.tickDate === '2026-10-26').map(r => r.gameDay), [-10, -9, -8, -7, -6]);
    assert.deepEqual(ran.filter(r => r.teamId === teamId && r.tickDate === '2026-10-27').map(r => r.gameDay), [-5, -4, -3, -2, -1]);
  }
  assert.ok(ran.every(r => r.seasonId === 's5'));
  // Programslottet regnes fra datoens egne dage (manageren valgte program, slot 0-4).
  assert.deepEqual(ran.find(r => r.gameDay === -1).dateGameDays, [-5, -4, -3, -2, -1]);
  assert.ok(state.work.every(row => row.status === 'complete'));
  // 26/10 indhentes efter sin frist (27/10 kl. 02) via bro-RPC'en; 27/10 er inden fristen.
  assert.ok(registrations.filter(r => r.tickDate === '2026-10-26').every(r => r.lateBridge));
  assert.ok(registrations.filter(r => r.tickDate === '2026-10-27').every(r => !r.lateBridge));
  assert.deepEqual(quarantined, [], 'ingen ryttere i karantaene');
  // Genstart af processen: ingen nye traeninger.
  __resetNormalizedTrainingDateCacheForTests();
  const before = ran.length;
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-27T21:00:00Z') });
  assert.equal(ran.length, before, 'afregnede brodatoer koeres aldrig igen');
});

test('foerste loebsdato bruger loebsdags-aksen uaendret', async () => {
  const { options } = scenario();
  const context = await loadTrainingDateContext({
    supabase: options.supabase, season: { ...S5, previous_end_date: '2026-10-25' }, tickDate: '2026-10-28',
    loadDaySpans: async () => new Map([['d1', { gameDays: [0, 1, 2, 3, 4] }]]),
  });
  assert.deepEqual(context.gameDaysByDivision.get('d1'), [0, 1, 2, 3, 4]);
  assert.equal(context.gameDaysByDivision.has('d4'), false);
});

test('Traen nu (saeson kun med id/number) slaar broens graenser op selv', async () => {
  const { options } = scenario();
  assert.deepEqual(await loadSeasonBridgeBounds(options.supabase, { id: 's5', number: 5 }),
    { firstRaceDate: '2026-10-28', previousEndDate: '2026-10-25' });
  const context = await loadTrainingDateContext({
    supabase: options.supabase, season: { id: 's5', number: 5 }, tickDate: '2026-10-27', loadDaySpans: async () => new Map(),
  });
  assert.deepEqual(context.gameDaysByDivision.get('d1'), [-5, -4, -3, -2, -1]);
  assert.deepEqual(context.gameDaysByDivision.get('d4'), [-5, -4, -3, -2, -1]);
});

test('deploy-vinduet: uden bro-RPC registreres den sene brodato ikke og proeves igen', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const { state, ran, quarantined, options } = scenario();
  state.bridgeRpcMissing = true;
  const summary = await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-27T20:00:00Z') });
  assert.equal(summary.failed, 0);
  assert.equal(state.work.some(row => row.tick_date === '2026-10-26'), false, 'ingen tom, frosset dato');
  assert.equal(ran.some(r => r.tickDate === '2026-10-26'), false);
  assert.equal(state.work.some(row => row.tick_date === '2026-10-27'), false, 'senere dato holdes tilbage');
  // Naeste tick efter migrationen: 26/10 afregnes (cachen holdt datoen aaben).
  state.bridgeRpcMissing = false;
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-10-27T20:05:00Z') });
  assert.deepEqual(ran.filter(r => r.teamId === 'A' && r.tickDate === '2026-10-26').map(r => r.gameDay), [-10, -9, -8, -7, -6]);
  assert.deepEqual(ran.filter(r => r.teamId === 'A' && r.tickDate === '2026-10-27').map(r => r.gameDay), [-5, -4, -3, -2, -1]);
  assert.deepEqual(quarantined, [], 'ingen ryttere i karantaene efter indhentning');
});
