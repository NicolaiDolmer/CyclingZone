import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRolloverEvidence } from './measureRankingRollover5692.mjs';

const sample = { phase: 'before', readerCode: '55P03', rows: 4, points: 'a', ranks: 'b', snapshot: 'c', rolledBack: true };
test('rollover evidence requires observed blocking before and identical readable snapshots after', () => {
  const after = { ...sample, phase: 'after', readerCode: null };
  assert.equal(assessRolloverEvidence([sample, after]), true);
  for (const changed of [{ readerCode: '55P03' }, { points: 'different' }, { snapshot: 'different' }, { rolledBack: false }, { rows: 0 }]) {
    assert.equal(assessRolloverEvidence([sample, { ...after, ...changed }]), false);
  }
  assert.equal(assessRolloverEvidence([{ ...sample, readerCode: null }, after]), false);
  assert.equal(assessRolloverEvidence([]), false);
});
