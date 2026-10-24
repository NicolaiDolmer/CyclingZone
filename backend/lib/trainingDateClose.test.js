import test from 'node:test';
import assert from 'node:assert/strict';
import { runNormalizedTrainingDateSweep, dispatchTrainingDateAlarms, departTrainingDateRiders, __resetNormalizedTrainingDateCacheForTests,
  loadTrainingDateIndex, loadJustCompletedFinalTrainingDate } from './trainingDateClose.js';
import { runTrainingDayCloseSweep, __resetTrainingDayCloseStateForTests } from './trainingDayCloseTrigger.js';
import { loadTrainingDateContext } from './trainingDateReadiness.js';
import { assessFinalTrainingDateSettlement } from './seasonTransitionReadiness.js';

test('teammates settle independently and a midnight retry cannot grant growth twice', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const work = [];
  const committed = new Set();
  const calls = [];
  const context = {
    teams: [{ id: 'team', league_division_id: 'division' }],
    riders: [{ id: 'ready', team_id: 'team' }, { id: 'waiting', team_id: 'team' }],
    races: [{ id: 'race', race_type: 'stage_race', stages_completed: 0, finalize_state: null }],
    stages: [{ race_id: 'race', stage_number: 1, game_day: 5 }],
    runs: [{ race_id: 'race', stage_number: 1, entrant_snapshot: ['waiting'] }],
    entries: [], results: [], incidents: [], loads: [], workRows: work,
    gameDaysByDivision: new Map([['division', [5, 6, 7, 8, 9]]]),
  };
  const options = {
    supabase: {},
    elapsedClock: () => 0,
    loadIndex: async () => ({ today: '2026-09-30', jobs: [{ tickDate: '2026-09-29', season: { id: 'season', number: 4 } }] }),
    loadContext: async () => context,
    loadWorkRows: async () => work,
    registerWork: async () => {
      const row = { team_id: 'team', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'waiting'], status: 'pending' };
      work.push(row); return row;
    },
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
    runDay: async args => {
      calls.push(args);
      for (const rider of args.eligibleRiderIds) committed.add(`${rider}:${args.gameDay}`);
      work[0].status = committed.size === 10 ? 'needs_reconciliation' : 'partial';
      return { alreadyRan: false };
    },
  };
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-09-29T20:00:00Z') });
  assert.equal(committed.size, 5);
  assert.ok(calls.every(call => call.eligibleRiderIds.join() === 'ready'));
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-09-30T00:00:00Z') });
  assert.equal(committed.size, 10);
  assert.ok(calls.every(call => call.tickDateOverride === '2026-09-29'));
  assert.equal(calls.at(-1).deadlineReached, true);
  assert.equal(calls.at(-1).unresolvedSlotsByRider.waiting[0].gameDay, 5);
  const before = calls.length;
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-09-30T00:05:00Z') });
  assert.equal(calls.length, before);
});

test('normalized unfinished work is inspected before the legacy evening gate', async () => {
  __resetTrainingDayCloseStateForTests();
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { value: 'on' }, error: null }; } };
  let ran = 0;
  const result = await runTrainingDayCloseSweep({
    supabase: { from: () => query }, now: new Date('2026-09-30T00:05:00Z'),
    runNormalized: async () => { ran++; return { ran: true, logicalDate: '2026-09-29' }; },
  });
  assert.equal(ran, 1);
  assert.equal(result.logicalDate, '2026-09-29');
});

test('deadline alarms aggregate per date and delivery failure leaves a durable retry', async () => {
  const evidence = { kind: 'quarantined', reason: 'roster_or_opening_evidence_unavailable', rider_id: 'missing-condition' };
  const row = { id: 'alarm', tick_date: '2026-09-29', payload: { missing_evidence: [evidence] }, updated_at: '2026-09-30T00:00:00Z' };
  const attempts = [];
  let delivered = false, opsCalls = 0, sentryCalls = 0;
  const query = { select() { return this; }, is() { return this; }, lte() { return this; }, order() { return this; }, async range() { return { data: delivered ? [] : [row], error: null }; } };
  const supabase = { from: () => query, async rpc(name, args) {
    assert.equal(name, 'mark_training_condition_alert_attempt');
    attempts.push(args); delivered = args.p_delivered;
    return { data: 1, error: null };
  } };
  const args = { supabase, now: new Date('2026-09-30T00:05:00Z'), logger: { error() {} },
    onAlarm: async (error, context) => {
      sentryCalls++;
      assert.equal(error.message, 'Training date requires reconciliation');
      assert.deepEqual(JSON.parse(context.pendingEvidence), [evidence]);
    }, sendOps: async () => { opsCalls++; if (opsCalls === 1) throw new Error('temporary outage'); } };
  assert.equal((await dispatchTrainingDateAlarms(args)).failed, 1);
  assert.equal(attempts[0].p_delivered, false);
  assert.equal((await dispatchTrainingDateAlarms(args)).failed, 0);
  await dispatchTrainingDateAlarms(args);
  assert.equal(opsCalls, 2);
  assert.equal(sentryCalls, 2);
  assert.equal(attempts.length, 2);
});

test('registered frozen and emptied teams reach reconciliation without a legacy condition write', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const work = { team_id: 'frozen', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['missing'], status: 'partial', opening_conditions: { missing: { fatigue: 30, form: 50 } } };
  const quarantined = [];
  const result = await runNormalizedTrainingDateSweep({
    supabase: {}, now: new Date('2026-09-30T00:05:00Z'), elapsedClock: () => 0,
    loadIndex: async () => ({ today: '2026-09-30', activeSeasonId: 'season', jobs: [{ tickDate: '2026-09-29', season: { id: 'season', number: 4 }, forceRetry: true }] }),
    loadWorkRows: async () => [work],
    loadContext: async args => {
      assert.deepEqual(args.registeredTeamIds, ['frozen']);
      return { teams: [{ id: 'frozen', is_frozen: true, league_division_id: null }], riders: [], gameDaysByDivision: new Map() };
    },
    quarantineRiders: async args => { quarantined.push(...args.riderIds); },
    runDay: async () => { throw new Error('must not write conditions for unavailable roster'); },
    dispatchAlarms: async () => ({ dates: 1, failed: 0 }),
  });
  assert.deepEqual(quarantined, ['missing']);
  assert.equal(result.quarantined, 1);
  assert.equal(result.failed, 0);
});

// #6439 (owner 10/10): training follows the rider who changes team mid-date.
function transferOptions({ work, riders, quarantine, calls }) {
  return {
    supabase: {}, now: new Date('2026-09-30T00:05:00Z'), elapsedClock: () => 0,
    loadIndex: async () => ({ today: '2026-09-30', activeSeasonId: 'season', jobs: [{ tickDate: '2026-09-29', season: { id: 'season', number: 4 }, forceRetry: true }] }),
    loadWorkRows: async () => [work],
    loadContext: async () => ({ teams: [{ id: 'old', league_division_id: 'division' }], riders, gameDaysByDivision: new Map() }),
    quarantineRiders: async args => { quarantine.push(...args.riderIds); },
    // #6504: the RPC accepts nobody unless a test says otherwise.
    departRiders: async () => [],
    runDay: async args => { calls.push(args); return {}; },
    dispatchAlarms: async () => ({ dates: 1, failed: 0 }),
  };
}

test('a transferred rider settles on the opening team and the teammate still receives every tick', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], quarantine = [];
  const work = { team_id: 'old', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'moved'], status: 'partial', opening_conditions: { ready: {}, moved: {} } };
  await runNormalizedTrainingDateSweep(transferOptions({ work, quarantine, calls,
    riders: [{ id: 'ready', team_id: 'old' }, { id: 'moved', team_id: 'new' }] }));
  assert.deepEqual(quarantine, []);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.teamId === 'old' && call.eligibleRiderIds.join() === 'ready,moved'));
});

test('a moved rider without a frozen opening condition, or released from every team, is still quarantined', async () => {
  for (const [riders, opening] of [
    [[{ id: 'ready', team_id: 'old' }, { id: 'moved', team_id: 'new' }], { ready: {} }],
    [[{ id: 'ready', team_id: 'old' }], { ready: {}, moved: {} }],
  ]) {
    __resetNormalizedTrainingDateCacheForTests();
    const calls = [], quarantine = [];
    const work = { team_id: 'old', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'moved'], status: 'partial', opening_conditions: opening };
    await runNormalizedTrainingDateSweep(transferOptions({ work, riders, quarantine, calls }));
    assert.deepEqual(quarantine, ['moved']);
    assert.ok(calls.every(call => call.eligibleRiderIds.join() === 'ready'));
  }
});

// #6504: a rider who provably left the team (team_id null now) is departed without
// alarm; anything the RPC does not accept is still quarantined.
test('a released rider is departed, not quarantined; a rider the RPC rejects is still quarantined', async () => {
  for (const [accepted, expectDeparted, expectQuarantine] of [[['gone'], ['gone'], []], [[], [], ['gone']]]) {
    __resetNormalizedTrainingDateCacheForTests();
    const calls = [], quarantine = [], departCalls = [];
    const work = { team_id: 'old', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'gone'], status: 'partial', opening_conditions: { ready: {}, gone: {} } };
    const result = await runNormalizedTrainingDateSweep({
      ...transferOptions({ work, quarantine, calls, riders: [{ id: 'ready', team_id: 'old' }] }),
      departRiders: async args => { departCalls.push(args.riderIds); return accepted; },
    });
    assert.deepEqual(departCalls, [['gone']]);
    assert.deepEqual(quarantine, expectQuarantine);
    assert.equal(result.departed, expectDeparted.length);
    assert.equal(result.quarantined, expectQuarantine.length);
    assert.ok(calls.every(call => call.eligibleRiderIds.join() === 'ready'));
  }
});

test('a rider moved to another team, or any rider on a frozen team, is never sent to departure', async () => {
  for (const [team, riders, opening] of [
    [{ id: 'old', league_division_id: 'division' }, [{ id: 'ready', team_id: 'old' }, { id: 'gone', team_id: 'new' }], { ready: {} }],
    [{ id: 'old', league_division_id: 'division', is_frozen: true }, [{ id: 'ready', team_id: 'old' }], { ready: {}, gone: {} }],
  ]) {
    __resetNormalizedTrainingDateCacheForTests();
    const calls = [], quarantine = [];
    const work = { team_id: 'old', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'gone'], status: 'partial', opening_conditions: opening };
    await runNormalizedTrainingDateSweep({
      ...transferOptions({ work, quarantine, calls, riders }),
      loadContext: async () => ({ teams: [team], riders, gameDaysByDivision: new Map() }),
      departRiders: async () => { throw new Error('must not depart'); },
    });
    assert.ok(quarantine.includes('gone'));
  }
});

test('a transfer in the middle of the evening settlement gives 5 of 5 on one team and never a double tick', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  // Stateful stand-ins for the database: one receipt per (rider, game day), and the
  // registration RPC's #6439 claim rule (a rider in another team's open date row
  // is not registered again for that date).
  const work = [], receipts = new Map(), quarantine = [];
  let failOnce = true;
  const riders = [{ id: 'stay', team_id: 'old' }, { id: 'mover', team_id: 'old' }, { id: 'buyer-own', team_id: 'new' }];
  const options = {
    supabase: {}, elapsedClock: () => 0, logger: { error() {} },
    loadIndex: async ({ now }) => ({ today: '2026-09-29', activeSeasonId: 'season',
      jobs: [{ tickDate: '2026-09-29', season: { id: 'season', number: 4 }, ...(now.getUTCMinutes() > 0 ? { forceRetry: true } : {}) }] }),
    loadWorkRows: async () => work.map(row => ({ ...row })),
    loadContext: async () => ({
      teams: [{ id: 'old', league_division_id: 'division' }, { id: 'new', league_division_id: 'division' }],
      riders: riders.map(rider => ({ ...rider })), gameDaysByDivision: new Map([['division', [5, 6, 7, 8, 9]]]),
    }),
    registerWork: async ({ teamId, gameDays, riderIds }) => {
      const claimed = new Set(work.filter(row => row.team_id !== teamId).flatMap(row => row.expected_rider_ids));
      const row = { team_id: teamId, game_days: gameDays, expected_rider_ids: riderIds.filter(id => !claimed.has(id)),
        status: 'pending', opening_conditions: Object.fromEntries(riderIds.map(id => [id, { form: 50, fatigue: 10 }])), quarantined_rider_ids: [] };
      work.push(row); return row;
    },
    quarantineRiders: async args => { quarantine.push(...args.riderIds); },
    runDay: async ({ teamId, gameDay, eligibleRiderIds }) => {
      // The settlement is interrupted on the final race day; the rider is sold before the retry.
      if (failOnce && teamId === 'old' && gameDay === 9) {
        failOnce = false;
        riders.find(rider => rider.id === 'mover').team_id = 'new';
        throw new Error('transient');
      }
      for (const rider of eligibleRiderIds) {
        const key = `${rider}:${gameDay}`;
        if (receipts.has(key)) continue; // commit_training_date_tick skips a receipted race day
        receipts.set(key, teamId);
      }
      return {};
    },
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-09-29T18:00:00Z') });
  assert.equal([...receipts.keys()].filter(key => key.startsWith('mover:')).length, 4);
  await runNormalizedTrainingDateSweep({ ...options, now: new Date('2026-09-29T18:05:00Z') });
  const moverTicks = [...receipts].filter(([key]) => key.startsWith('mover:'));
  assert.deepEqual(moverTicks.map(([key]) => Number(key.split(':')[1])).sort((a, b) => a - b), [5, 6, 7, 8, 9]);
  assert.ok(moverTicks.every(([, team]) => team === 'old'), 'the opening team settles the whole date');
  assert.deepEqual(quarantine, []);
  assert.equal(work.find(row => row.team_id === 'new').expected_rider_ids.includes('mover'), false);
});

test('an older season is evidence-only recovery and cannot overwrite a newer injury', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  let quarantined = false;
  let runCalls = 0;
  const result = await runNormalizedTrainingDateSweep({
    supabase: {}, now: new Date('2026-10-27T08:00:00Z'), elapsedClock: () => 0,
    loadIndex: async () => ({ today: '2026-10-27', activeSeasonId: 'new-season', jobs: [{ tickDate: '2026-09-29', season: { id: 'old-season', number: 4 }, forceRetry: true }] }),
    loadWorkRows: async () => [{ team_id: 'team', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['rider'], status: 'partial', opening_conditions: { rider: {} } }],
    loadContext: async () => ({ teams: [{ id: 'team', league_division_id: 'division' }], riders: [{ id: 'rider', team_id: 'team' }], gameDaysByDivision: new Map() }),
    quarantineRiders: async args => { assert.equal(args.reason, 'historical_season_requires_review'); quarantined = true; },
    runDay: async () => { runCalls++; throw new Error('historical state must not be written'); },
    dispatchAlarms: async () => ({ dates: 1, failed: 0 }),
  });
  assert.equal(quarantined, true);
  assert.equal(runCalls, 0);
  assert.equal(result.failed, 0);
});

// #6004: one stuck partial team must not re-sweep every division-less team each tick.
function retryLoopOptions({ calls, legacyLookups, legacyRan = new Set(), forceRetry = true }) {
  const work = { team_id: 'stuck', game_days: [5], expected_rider_ids: ['r-stuck'], status: 'partial', opening_conditions: { 'r-stuck': {} } };
  return {
    supabase: {}, now: new Date('2026-10-01T13:30:00Z'), elapsedClock: () => 0, logger: { error() {} },
    loadIndex: async () => ({ today: '2026-10-01', activeSeasonId: 'season', jobs: [{ tickDate: '2026-09-30', season: { id: 'season', number: 4 }, ...(forceRetry ? { forceRetry: true } : {}) }] }),
    loadWorkRows: async () => (forceRetry ? [work] : []),
    loadContext: async () => ({
      teams: [{ id: 'stuck', league_division_id: 'division' }, { id: 'legacy-a', league_division_id: null, is_ai: true }, { id: 'legacy-b', league_division_id: null, is_ai: true }],
      riders: [{ id: 'r-stuck', team_id: 'stuck' }, { id: 'r-a', team_id: 'legacy-a' }, { id: 'r-b', team_id: 'legacy-b' }],
      races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [],
      gameDaysByDivision: new Map([['division', [5]]]),
    }),
    loadLegacyRuns: async () => { legacyLookups.push(1); return legacyRan; },
    runDay: async args => { calls.push(args.teamId); if (args.teamId === 'stuck') throw new Error('Missing recorded race load'); return {}; },
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
}

test('a forced retry runs only the unfinished team and never re-reserves legacy rows', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], legacyLookups = [];
  // First pass in a fresh process: legacy teams already settled, found in one lookup.
  const options = retryLoopOptions({ calls, legacyLookups, legacyRan: new Set(['legacy-a', 'legacy-b']) });
  const first = await runNormalizedTrainingDateSweep(options);
  assert.deepEqual(calls, ['stuck']);
  assert.equal(legacyLookups.length, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.failures[0].tickDate, '2026-09-30');
  // Later ticks are retry-only: the legacy branch is skipped without a lookup.
  calls.length = 0; legacyLookups.length = 0;
  const retryOnly = retryLoopOptions({ calls, legacyLookups, legacyRan: new Set() });
  await runNormalizedTrainingDateSweep(retryOnly);
  await runNormalizedTrainingDateSweep(retryOnly);
  assert.deepEqual(calls, ['stuck', 'stuck']);
  assert.equal(legacyLookups.length, 0);
});

test('a normal date pass still settles division-less teams without a legacy row', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], legacyLookups = [];
  const result = await runNormalizedTrainingDateSweep({
    ...retryLoopOptions({ calls, legacyLookups, legacyRan: new Set(['legacy-b']), forceRetry: false }),
    registerWork: async args => ({ team_id: args.teamId, game_days: args.gameDays, expected_rider_ids: args.riderIds, status: 'pending', opening_conditions: { 'r-stuck': {} } }),
  });
  assert.deepEqual(calls.filter(id => id.startsWith('legacy')), ['legacy-a']);
  assert.equal(legacyLookups.length, 1);
  assert.equal(result.failed, 1);
});

// #6536: parking clears league_division_id, so a parked human team looked like a
// division-less AI team and got a legacy tick every evening.
test('a parked team gets no legacy tick; division-less AI and active human teams still do', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], legacyLookups = [];
  const base = retryLoopOptions({ calls, legacyLookups, forceRetry: false });
  const result = await runNormalizedTrainingDateSweep({
    ...base,
    loadContext: async () => ({
      teams: [
        { id: 'active', league_division_id: 'division', is_ai: false },
        { id: 'parked', league_division_id: null, is_ai: false, parked_at: '2026-09-27T18:59:00Z' },
        { id: 'human-no-division', league_division_id: null, is_ai: false },
        { id: 'ai', league_division_id: null, is_ai: true },
      ],
      riders: [{ id: 'r-active', team_id: 'active' }, { id: 'r-parked', team_id: 'parked' }, { id: 'r-human', team_id: 'human-no-division' }, { id: 'r-ai', team_id: 'ai' }],
      races: [], stages: [], runs: [], entries: [], results: [], incidents: [], loads: [],
      gameDaysByDivision: new Map([['division', [5]]]),
    }),
    registerWork: async args => ({ team_id: args.teamId, game_days: args.gameDays, expected_rider_ids: args.riderIds, status: 'pending', opening_conditions: { 'r-active': {} } }),
    runDay: async args => { calls.push(`${args.teamId}:${args.gameDay}`); return {}; },
  });
  assert.deepEqual(calls.sort(), ['active:5', 'ai:null', 'human-no-division:null']);
  assert.equal(result.failed, 0);
});

test('a legacy failure keeps the forced retry on a full pass', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], legacyLookups = [];
  const options = retryLoopOptions({ calls, legacyLookups });
  const runDay = async args => { calls.push(args.teamId); throw new Error('transient'); };
  await runNormalizedTrainingDateSweep({ ...options, runDay });
  await runNormalizedTrainingDateSweep({ ...options, runDay });
  assert.equal(calls.filter(id => id === 'legacy-a').length, 2);
  assert.equal(legacyLookups.length, 2);
});

// #5911: the close triggers one ranking refresh after a sweep that settled today's teams.
test('a sweep that settles today triggers one ranking refresh; a past-date retry does not', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const refreshes = [];
  const today = { ...retryLoopOptions({ calls: [], legacyLookups: [], forceRetry: false }),
    loadIndex: async () => ({ today: '2026-10-01', activeSeasonId: 'season', jobs: [{ tickDate: '2026-10-01', season: { id: 'season', number: 4 } }] }),
    refreshRankings: async args => { refreshes.push(args.now.toISOString()); } };
  const result = await runNormalizedTrainingDateSweep(today);
  assert.ok(result.swept > 0);
  assert.equal(refreshes.length, 1);
  __resetNormalizedTrainingDateCacheForTests();
  await runNormalizedTrainingDateSweep({ ...retryLoopOptions({ calls: [], legacyLookups: [] }), refreshRankings: async () => { refreshes.push('past'); } });
  assert.equal(refreshes.length, 1);
});

test('#6504: before auto-migrate creates the RPC nobody is departed; other errors still throw', async () => {
  const call = error => departTrainingDateRiders({ supabase: { rpc: async () => ({ data: null, error }) },
    teamId: 't', seasonId: 's', tickDate: '2026-10-19', riderIds: ['r'], now: new Date('2026-10-19T18:00:00Z') });
  assert.deepEqual(await call({ code: 'PGRST202', message: 'Could not find the function' }), []);
  assert.deepEqual(await call({ code: '42883', message: 'function does not exist' }), []);
  await assert.rejects(call({ code: 'XX000', message: 'boom' }), /depart released riders/);
  assert.deepEqual(await departTrainingDateRiders({ supabase: { rpc: async () => ({ data: { departed_rider_ids: ['r'] }, error: null }) },
    teamId: 't', seasonId: 's', tickDate: '2026-10-19', riderIds: ['r'], now: new Date() }), ['r']);
});

// #6924 (owner decision B on #6898): the season can end before the evening run.
// The real index, context and season-end gate run against an in-memory store that
// honours the filters they use; only the writers (register/runDay) are injected.
function memoryClient(db) {
  return {
    from(table) {
      const filters = [], orders = [];
      let limitTo = null;
      const col = key => (key === 'races.season_id' ? 'season_id' : key);
      const time = value => new Date(value).getTime();
      const exec = (from = 0, to = null) => {
        let rows = (db[table] ?? []).filter(row => filters.every(match => match(row)));
        for (const [key, ascending] of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => (a[key] === b[key] ? 0 : (a[key] > b[key] ? 1 : -1)) * (ascending ? 1 : -1));
        }
        if (limitTo !== null) rows = rows.slice(0, limitTo);
        return { data: rows.slice(from, to === null ? undefined : to + 1).map(row => ({ ...row })), error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[col(key)] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[col(key)])); return query; },
        is(key) { filters.push(row => row[col(key)] == null); return query; },
        not(key) { filters.push(row => row[col(key)] != null); return query; },
        gte(key, value) { filters.push(row => row[col(key)] != null && time(row[col(key)]) >= time(value)); return query; },
        lt(key, value) { filters.push(row => row[col(key)] != null && time(row[col(key)]) < time(value)); return query; },
        order(key, { ascending = true } = {}) { orders.push([key, ascending]); return query; },
        limit(count) { limitTo = count; return query; },
        async range(from, to) { return exec(from, to); },
        async maybeSingle() { const { data } = exec(); return { data: data[0] ?? null, error: data.length > 1 ? { message: 'multiple rows' } : null }; },
        async single() { const { data } = exec(); return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: 'not one row' } }; },
        then(ok, fail) { return Promise.resolve(exec()).then(ok, fail); },
      };
      return query;
    },
  };
}

const FINAL = '2026-10-25'; // S4's last stage; DST has ended, Copenhagen = UTC+1.
const at = iso => new Date(iso);

function cutoverWorld() {
  const db = {
    seasons: [
      { id: 's3', number: 3, status: 'completed', start_date: '2026-08-01', end_date: '2026-09-20T18:00:00Z' },
      { id: 's4', number: 4, status: 'active', start_date: '2026-10-20', end_date: null },
      { id: 's5', number: 5, status: 'upcoming', start_date: null, end_date: null },
    ],
    app_config: [{ key: 'training_condition_activation_date', value: '2026-10-20' }],
    races: [
      { id: 'r4-1', season_id: 's4', league_division_id: 'pool-1', race_type: 'single', stages_completed: 1, finalize_state: null },
      { id: 'r4-2', season_id: 's4', league_division_id: 'pool-2', race_type: 'single', stages_completed: 1, finalize_state: null },
      { id: 'r5-0', season_id: 's5', league_division_id: 'pool-0', race_type: 'single', stages_completed: 0, finalize_state: null },
    ],
    race_stage_schedule: [
      { race_id: 'r4-1', season_id: 's4', stage_number: 1, game_day: 40, scheduled_at: '2026-10-25T13:00:00Z' },
      { race_id: 'r4-2', season_id: 's4', stage_number: 1, game_day: 41, scheduled_at: '2026-10-25T14:00:00Z' },
      { race_id: 'r5-0', season_id: 's5', stage_number: 1, game_day: 1, scheduled_at: '2026-10-28T10:00:00Z' },
    ],
    teams: [
      { id: 'A', league_division_id: 'pool-1', is_ai: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'B', league_division_id: 'pool-2', is_ai: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'P', league_division_id: 'pool-2', is_ai: false, created_at: '2026-01-01T00:00:00Z' },
    ],
    riders: [
      { id: 'a1', team_id: 'A', is_retired: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'b1', team_id: 'B', is_retired: false, created_at: '2026-01-01T00:00:00Z' },
      { id: 'p1', team_id: 'P', is_retired: false, created_at: '2026-01-01T00:00:00Z' },
    ],
    season_standings: [
      { season_id: 's4', team_id: 'A', league_division_id: 'pool-1' },
      { season_id: 's4', team_id: 'B', league_division_id: 'pool-2' },
      { season_id: 's4', team_id: 'P', league_division_id: 'pool-2' },
    ],
    season_end_claims: [],
    training_date_work: [],
  };
  const settled = [], quarantined = [];
  const options = {
    supabase: memoryClient(db), elapsedClock: () => 0, logger: { error() {} },
    loadIndex: loadTrainingDateIndex,
    loadContext: loadTrainingDateContext,
    // The race days of each pool racing on the date, from the season's own races.
    loadDaySpans: async ({ raceRows, todaysStages }) => new Map(todaysStages.map(stage => {
      const pool = raceRows.find(race => race.id === stage.race_id).league_division_id;
      return [pool, { gameDays: [stage.game_day] }];
    })),
    registerWork: async ({ teamId, seasonId, tickDate, gameDays, riderIds }) => {
      const row = { team_id: teamId, season_id: seasonId, tick_date: tickDate, game_days: gameDays, expected_rider_ids: riderIds, status: 'pending' };
      db.training_date_work.push(row); return { ...row };
    },
    runDay: async ({ teamId, seasonId, tickDateOverride, gameDay, eligibleRiderIds }) => {
      settled.push({ key: `${teamId}:${seasonId}:${tickDateOverride}:${gameDay}`, riders: eligibleRiderIds });
      db.training_date_work.find(row => row.team_id === teamId && row.season_id === seasonId && row.tick_date === tickDateOverride).status = 'complete';
      return { alreadyRan: false };
    },
    quarantineRiders: async args => { quarantined.push(args); },
    departRiders: async () => [],
    refreshRankings: async () => {},
    dispatchAlarms: async () => ({ dates: 0, failed: 0 }),
  };
  // "Afslut sæson" at 18:00 and the transition at 18:30 (Copenhagen) on the final date.
  const endSeasonAndTransition = () => {
    db.seasons.find(row => row.id === 's4').status = 'completed';
    db.season_end_claims.push({ season_id: 's4', claimed_at: '2026-10-25T17:00:00Z' });
    Object.assign(db.teams.find(row => row.id === 'A'), { league_division_id: 'pool-0' }); // promoted
    Object.assign(db.teams.find(row => row.id === 'P'), { league_division_id: null, parked_at: '2026-10-25T17:01:00Z' });
    Object.assign(db.seasons.find(row => row.id === 's5'), { status: 'active', start_date: '2026-10-25T17:30:00Z' });
    db.teams.push({ id: 'N', league_division_id: 'pool-0', is_ai: true, created_at: '2026-10-25T17:30:00Z' });
    db.riders.push({ id: 'y1', team_id: 'A', is_retired: false, created_at: '2026-10-25T17:30:00Z' },
      { id: 'n1', team_id: 'N', is_retired: false, created_at: '2026-10-25T17:30:00Z' });
  };
  return { db, settled, quarantined, options, endSeasonAndTransition };
}

test('#6924: season ends at 18:00, the evening run at 20:00 settles the final date exactly once', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const { db, settled, quarantined, options, endSeasonAndTransition } = cutoverWorld();
  const s4 = db.seasons.find(row => row.id === 's4');

  const gate = await assessFinalTrainingDateSettlement({ supabase: options.supabase, season: s4, now: at('2026-10-25T17:00:00Z') });
  assert.equal(gate.blocked, false, 'before the evening run the season may end');
  assert.equal(gate.deferred, true);
  assert.equal(gate.tick_date, FINAL);
  endSeasonAndTransition();

  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-25T18:55:00Z') }); // 19:55
  assert.deepEqual(settled, [], 'not due before 20:00');

  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-25T19:00:00Z') }); // 20:00
  assert.deepEqual(settled.map(row => row.key).sort(),
    [`A:s4:${FINAL}:40`, `B:s4:${FINAL}:41`, `P:s4:${FINAL}:41`],
    'S4 pools from the standings (A was promoted, P parked at season-end); no S5 or new team');
  assert.deepEqual(settled.find(row => row.key.startsWith('A:')).riders, ['a1'], 'new-season intake is not trained on the S4 date');
  assert.deepEqual(quarantined, [], 'not treated as historical');
  assert.ok(db.training_date_work.every(row => row.season_id === 's4' && row.status === 'complete'));

  // Every later run (5-minute cron, restart, the next evening, after the window) adds nothing.
  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-25T19:05:00Z') });
  __resetNormalizedTrainingDateCacheForTests();
  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-25T20:00:00Z') });
  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-26T19:00:00Z') });
  await runNormalizedTrainingDateSweep({ ...options, now: at('2026-10-27T19:00:00Z') });
  assert.equal(settled.length, 3);
  assert.equal(db.training_date_work.length, 3);
});

test('#6924: unfinished final-date work is settled the next day, then becomes historical', async () => {
  for (const [now, historical] of [['2026-10-26T09:00:00Z', false], ['2026-10-27T09:00:00Z', true]]) {
    __resetNormalizedTrainingDateCacheForTests();
    const { db, settled, quarantined, options, endSeasonAndTransition } = cutoverWorld();
    endSeasonAndTransition();
    // A pending row from before season-end (e.g. a Train now press), not settled on the date.
    db.training_date_work.push({ team_id: 'B', season_id: 's4', tick_date: FINAL, game_days: [41], expected_rider_ids: ['b1'], status: 'pending' });
    await runNormalizedTrainingDateSweep({ ...options, now: at(now) });
    if (historical) {
      assert.deepEqual(settled, []);
      assert.equal(quarantined[0].reason, 'historical_season_requires_review');
    } else {
      assert.deepEqual(settled.map(row => row.key).sort(), [`A:s4:${FINAL}:40`, `B:s4:${FINAL}:41`, `P:s4:${FINAL}:41`]);
      assert.deepEqual(quarantined, []);
    }
  }
});

test('#6924: only the latest completed season, while its final date is due and at most a day old', async () => {
  const { db, options, endSeasonAndTransition } = cutoverWorld();
  const load = now => loadTrainingDateIndex({ supabase: options.supabase, now: at(now) })
    .then(index => index.jobs.filter(job => job.finalSeasonDate).map(job => `${job.season.id}:${job.tickDate}`));
  assert.deepEqual(await load('2026-10-25T19:00:00Z'), [], 'still active: the ordinary active-season date');
  endSeasonAndTransition();
  assert.deepEqual(await load('2026-10-25T18:59:00Z'), []);
  assert.deepEqual(await load('2026-10-25T19:00:00Z'), [`s4:${FINAL}`]);
  assert.deepEqual(await load('2026-10-26T22:59:00Z'), [`s4:${FINAL}`]);
  assert.deepEqual(await load('2026-10-26T23:00:00Z'), []);
  const final = (await loadTrainingDateIndex({ supabase: options.supabase, now: at('2026-10-25T19:00:00Z') })).jobs.find(job => job.finalSeasonDate);
  assert.equal(final.finalSeasonDate.cutoff.toISOString(), '2026-10-25T17:00:00.000Z', 'the season-end claim');
  // A forced transition without season-end leaves no claim: its end_date instant is the cutoff.
  db.season_end_claims.length = 0;
  db.seasons.find(row => row.id === 's4').end_date = '2026-10-25T17:30:00Z';
  const window = { supabase: options.supabase, today: FINAL, dueEnd: FINAL };
  assert.equal((await loadJustCompletedFinalTrainingDate(window)).cutoff.toISOString(), '2026-10-25T17:30:00.000Z');
  // A planned date-only end_date is not an instant: the date's own end.
  db.seasons.find(row => row.id === 's4').end_date = FINAL;
  assert.equal((await loadJustCompletedFinalTrainingDate(window)).cutoff.toISOString(), '2026-10-25T23:00:00.000Z');
});
