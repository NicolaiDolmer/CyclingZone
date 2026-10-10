import test from 'node:test';
import assert from 'node:assert/strict';
import { runNormalizedTrainingDateSweep, dispatchTrainingDateAlarms, __resetNormalizedTrainingDateCacheForTests } from './trainingDateClose.js';
import { runTrainingDayCloseSweep, __resetTrainingDayCloseStateForTests } from './trainingDayCloseTrigger.js';

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
      teams: [{ id: 'stuck', league_division_id: 'division' }, { id: 'legacy-a', league_division_id: null }, { id: 'legacy-b', league_division_id: null }],
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
