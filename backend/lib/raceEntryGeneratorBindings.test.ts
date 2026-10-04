import test from 'node:test';
import assert from 'node:assert/strict';
import { generatorBindingLocks, indexGeneratorBindings } from './raceEntryGeneratorBindings.ts';

test('canonical spans bind through the final stage; participation remains exact days', () => {
  const bindings = indexGeneratorBindings([{ race_id: 'stage', rider_id: 'r1', team_id: 'seller', binding_span: '[27,32)' }],
    [{ race_id: 'completed', rider_id: 'r2', game_day: 29 }, { race_id: 'completed', rider_id: 'r2', game_day: 31 }]);
  const locks = generatorBindingLocks({ bindings, riderIds: ['r1', 'r2'], teamId: 'buyer', regeneratingRaceIds: new Set(['next']) });
  assert.deepEqual(locks.map(lock => lock.window), [{ start: 27, end: 31 }, { start: 29, end: 29 }, { start: 31, end: 31 }]);
});

test('replanning releases only the target owner, and never releases participation', () => {
  const bindings = indexGeneratorBindings([
    { race_id: 'target', rider_id: 'mine', team_id: 'buyer', binding_span: '[29,30)' },
    { race_id: 'target', rider_id: 'other-owner', team_id: 'seller', binding_span: '[29,30)' },
    { race_id: 'outside', rider_id: 'outside', team_id: 'buyer', binding_span: '[29,30)' },
  ], [{ race_id: 'target', rider_id: 'spent', game_day: 29 }]);
  const locks = generatorBindingLocks({ bindings, riderIds: ['mine', 'other-owner', 'outside', 'spent'],
    teamId: 'buyer', regeneratingRaceIds: new Set(['target']) });
  assert.deepEqual(locks.flatMap(lock => lock.riderIds), ['other-owner', 'outside', 'spent']);
});

test('malformed canonical data fails closed', () => {
  for (const binding_span of ['empty', '[29,29)', '[29,)', '(29,31]', 'unexpected']) {
    assert.throws(() => indexGeneratorBindings([{ race_id: 'race', rider_id: 'r', team_id: 'team', binding_span }], []), /Invalid canonical/);
  }
  assert.throws(() => indexGeneratorBindings([], [{ race_id: 'race', rider_id: 'r', game_day: NaN }]), /integer race day/);
});
