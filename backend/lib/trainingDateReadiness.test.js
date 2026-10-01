import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingDateDeadline, resolveTrainingDateReadiness, trainingAutopickCandidates } from './trainingDateReadiness.js';

test('deadline uses the original date across midnight and Copenhagen DST transitions', () => {
  assert.equal(trainingDateDeadline('2026-09-29').toISOString(), '2026-09-30T00:00:00.000Z');
  assert.equal(trainingDateDeadline('2026-10-24').toISOString(), '2026-10-25T00:00:00.000Z');
  assert.equal(trainingDateDeadline('2027-03-27').toISOString(), '2027-03-28T01:00:00.000Z');
});

function fixture() {
  return {
    tickDate: '2026-09-29', now: new Date('2026-09-29T20:00:00Z'), riderIds: ['waiting', 'ready'],
    stages: [{ race_id: 'race', stage_number: 1, game_day: 5 }],
    races: [{ id: 'race', race_type: 'stage_race', stages_completed: 0, finalize_state: null }],
    runs: [{ race_id: 'race', stage_number: 1, entrant_snapshot: ['waiting'] }],
    entries: [], results: [], incidents: [], loads: [],
  };
}

test('missing senior snapshot cannot defer youth who are outside the runtime autopick pool', () => {
  const teams = [{ id: 'team', is_ai: true, league_division_id: 'senior', u23_league_division_id: 'u23', junior_league_division_id: 'junior' }];
  const riders = ['senior', 'u23', 'junior'].map(squad => ({ id: squad, team_id: 'team', squad, is_academy: squad !== 'senior', is_retired: false, pending_team_id: null }));
  assert.deepEqual(trainingAutopickCandidates({ squad: 'senior', league_division_id: 'senior' }, teams, riders), ['senior']);
  assert.deepEqual(trainingAutopickCandidates({ squad: 'u23', league_division_id: 'u23' }, teams, riders), ['u23']);
});

test('#6006: a team that pressed Train now is no autopick candidate; other autopick teams still are', () => {
  const teams = [
    { id: 'pressed', assistant_autopick_enabled: true, league_division_id: 'd1' },
    { id: 'other', assistant_autopick_enabled: true, league_division_id: 'd1' },
  ];
  const riders = [
    { id: 'p1', team_id: 'pressed', squad: 'senior', is_academy: false, is_retired: false, pending_team_id: null },
    { id: 'o1', team_id: 'other', squad: 'senior', is_academy: false, is_retired: false, pending_team_id: null },
  ];
  const race = { squad: 'senior', league_division_id: 'd1' };
  assert.deepEqual(trainingAutopickCandidates(race, teams, riders), ['p1', 'o1']);
  assert.deepEqual(trainingAutopickCandidates(race, teams, riders, new Set(['pressed'])), ['o1']);
});

test('one missing stage delays its starter, never an unaffected teammate', () => {
  const result = resolveTrainingDateReadiness(fixture());
  assert.deepEqual(result.eligibleRiderIds, ['ready']);
  assert.deepEqual(result.unresolvedSlotsByRider.waiting, [{ raceId: 'race', stageNumber: 1, gameDay: 5 }]);
  assert.equal(result.deadlineReached, false);
});

test('after midnight the original deadline still applies; deadline releases evidence-only settlement', () => {
  const input = fixture();
  input.now = new Date('2026-09-29T23:59:59Z');
  assert.deepEqual(resolveTrainingDateReadiness(input).eligibleRiderIds, ['ready']);
  input.now = new Date('2026-09-30T00:00:00Z');
  const result = resolveTrainingDateReadiness(input);
  assert.deepEqual(result.eligibleRiderIds, ['waiting', 'ready']);
  assert.equal(result.unresolvedSlotsByRider.waiting.length, 1);
});

test('durable result and load release a starter even if unrelated finalization remains pending', () => {
  const input = fixture();
  input.results = [{ race_id: 'race', stage_number: 1, rider_id: 'waiting', result_type: 'stage' }];
  input.loads = [{ race_id: 'race', stage_number: 1, rider_id: 'waiting', load: 12 }];
  assert.deepEqual(resolveTrainingDateReadiness(input).eligibleRiderIds, ['waiting', 'ready']);
});

test('completed race does not hide a missing load and GC cannot stand in for a tour stage result', () => {
  const input = fixture();
  input.races[0].stages_completed = 1;
  assert.deepEqual(resolveTrainingDateReadiness(input).eligibleRiderIds, ['ready']);
  input.races[0].stages_completed = 0;
  input.results = [{ race_id: 'race', stage_number: 1, rider_id: 'waiting', result_type: 'gc' }];
  input.loads = [{ race_id: 'race', stage_number: 1, rider_id: 'waiting', load: 12 }];
  assert.deepEqual(resolveTrainingDateReadiness(input).eligibleRiderIds, ['ready']);
});
