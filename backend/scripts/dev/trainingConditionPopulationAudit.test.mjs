import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStageMasks } from './trainingConditionPopulationAudit.mjs';

test('S4 first stage is game day zero, and its following gap belongs to that slot', () => {
  const result = buildStageMasks([{ profiles: [[0, 'flat'], [5, 'mountain']], spans: [[0, 5]] }]);
  const [gaps, stages] = result.livePatterns.patterns[0];
  assert.equal(stages[0], '1');
  assert.equal(stages[5], '1');
  assert.equal(stages[4], '0');
  assert.equal(gaps.charCodeAt(0) - 65, 4);
  assert.equal(result.stageDates[0].slice(0, 3), '110');
});

test('last S4 slot remains in the final date, singles do not become tour stages', () => {
  const result = buildStageMasks([{ profiles: [[0, 'flat'], [135, 'hilly'], [139, 'mountain']], spans: [[135, 139]] }]);
  assert.equal(result.livePatterns.patterns[0][1][0], '0');
  assert.equal(result.livePatterns.patterns[0][1][139], '1');
  assert.equal(result.stageDates[0], '0'.repeat(27) + '1');
});

test('duplicate and out-of-season activity slots fail rather than corrupting comparisons', () => {
  assert.throws(() => buildStageMasks([{ profiles: [[0, 'flat'], [0, 'mountain']], spans: [] }]), /unique zero-based/);
  assert.throws(() => buildStageMasks([{ profiles: [[140, 'flat']], spans: [] }]), /unique zero-based/);
});
