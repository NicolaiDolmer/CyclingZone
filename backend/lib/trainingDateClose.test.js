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

test('a transferred rider cannot prevent the remaining teammate from receiving every tick', async () => {
  __resetNormalizedTrainingDateCacheForTests();
  const calls = [], quarantine = [];
  const work = { team_id: 'old', game_days: [5, 6, 7, 8, 9], expected_rider_ids: ['ready', 'moved'], status: 'partial', opening_conditions: { ready: {}, moved: {} } };
  await runNormalizedTrainingDateSweep({
    supabase: {}, now: new Date('2026-09-30T00:05:00Z'), elapsedClock: () => 0,
    loadIndex: async () => ({ today: '2026-09-30', activeSeasonId: 'season', jobs: [{ tickDate: '2026-09-29', season: { id: 'season', number: 4 }, forceRetry: true }] }),
    loadWorkRows: async () => [work],
    loadContext: async () => ({ teams: [{ id: 'old', league_division_id: 'division' }], riders: [{ id: 'ready', team_id: 'old' }, { id: 'moved', team_id: 'new' }], gameDaysByDivision: new Map() }),
    quarantineRiders: async args => { quarantine.push(...args.riderIds); },
    runDay: async args => { calls.push(args); return {}; },
    dispatchAlarms: async () => ({ dates: 1, failed: 0 }),
  });
  assert.deepEqual(quarantine, ['moved']);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.eligibleRiderIds.join() === 'ready'));
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
