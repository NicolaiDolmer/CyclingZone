import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConditionCutoverProposal, replayOpeningFromSeasonReset } from './trainingConditionCutoverDryRun.mjs';

function resetReplay() {
  return { riderId: 'starter', targetDate: '2026-09-29',
    proof: { phaseLog: { id: 'reset-log', meta: { status: 'completed', to_season_id: 'season', to_season_number: 4,
      transition_at: '2026-09-27T20:00:00Z', phases: [{ phase: 'season_fatigue_reset' }] } },
      fatigueMode: 'full', seasonStartDate: '2026-09-28', configured_at: '2026-08-01T00:00:00Z',
      formRun: { season_id: 'season', mode: 'decay', completed_at: '2026-09-27T20:01:00Z' },
      formConfig: { mode: 'decay', decayTarget: 48, decayFactor: 0.5 } },
    previousReport: { id: 'old-report', created_at: '2026-09-26T20:00:00Z', form: 20, fatigue: 80 },
    days: [{ date: '2026-09-28', settled: false, recordedRaceStarts: 0, recordedTrainingRuns: 0 }] };
}

test('documented reset and subsequent events reconstruct forward without current-fatigue subtraction', () => {
  assert.deepEqual(replayOpeningFromSeasonReset(resetReplay()), { fatigue: 0, form: 34, source: 'season-reset-forward:reset-log:old-report' });
});

test('forward reconstruction rejects failed reset, missing dates and unaccounted race activity', () => {
  const failed = resetReplay(); failed.proof.phaseLog.meta.phases[0].error = 'database failure';
  assert.throws(() => replayOpeningFromSeasonReset(failed), /Completed full/);
  const gap = resetReplay(); gap.days = [];
  assert.throws(() => replayOpeningFromSeasonReset(gap), /does not reach/);
  const unknown = resetReplay(); unknown.days[0].recordedRaceStarts = 1;
  assert.throws(() => replayOpeningFromSeasonReset(unknown), /Cannot infer/);
});

function fixture() {
  return {
    date: '2026-09-29', training_runs: 0,
    runs: [{ race_id: 'race', stage_number: 1, season_id: 'season', profile_type: 'flat',
      entrant_snapshot: ['starter'], scheduled_at: '2026-09-29T09:00:00Z', created_at: '2026-09-29T09:01:00Z' }],
    openings: [{ rider_id: 'starter', opening_form: 50, opening_fatigue: 30,
      expected_form: 50, expected_fatigue: 40, source: 'final-report', source_date: '2026-09-28' }],
    orders: [], roles: [],
  };
}

test('cutover retains the original starter, authoritative opening and live CAS independently', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildConditionCutoverProposal(input);
  assert.equal(result.requiresOwnerGo, true);
  assert.equal(result.args.p_openings[0].opening_fatigue, 30);
  assert.equal(result.args.p_openings[0].expected_fatigue, 40);
  assert.equal(result.args.p_loads[0].rider_id, 'starter');
  assert.equal(result.summary.changedConditions, 1);
  assert.deepEqual(input, before);
});

test('cutover refuses a missing prior report instead of guessing the opening', () => {
  const input = fixture();
  input.openings[0].source_date = '2026-09-27';
  assert.throws(() => buildConditionCutoverProposal(input), /Yesterday/);
  input.openings = [];
  assert.throws(() => buildConditionCutoverProposal(input), /Missing opening/);
});

test('cutover rejects effort edits made after the original simulation', () => {
  const input = fixture();
  input.roles = [{ race_id: 'race', stage_number: 1, rider_id: 'starter', effort: 'protect', updated_at: '2026-09-29T10:00:00Z' }];
  assert.throws(() => buildConditionCutoverProposal(input), /modified after/);
});

test('cutover refuses training already run and a stage on another Copenhagen date', () => {
  const input = fixture();
  input.training_runs = 1;
  assert.throws(() => buildConditionCutoverProposal(input), /no training runs/);
  input.training_runs = 0;
  input.runs[0].scheduled_at = '2026-09-29T22:30:00Z';
  assert.throws(() => buildConditionCutoverProposal(input), /outside the cutover date/);
});
