import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingShadowDecoupled6765Enabled, RANKING_SHADOW_DECOUPLED_6765_FLAG } from './rankingShadowDecoupled6765Flag.ts';

test('independence is fail closed for absent/invalid/off controls and permits explicit engine stages', async () => {
  for (const value of [null, undefined, false, 'off', 'invalid', 1, {}, true, 'on', 'beta']) {
    const client = { from: (table: string) => ({ select: () => ({ eq: (column: string, key: string) => {
      assert.equal(table, 'app_config'); assert.equal(column, 'key'); assert.equal(key, RANKING_SHADOW_DECOUPLED_6765_FLAG);
      return { maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) };
    } }) }) };
    assert.equal(await rankingShadowDecoupled6765Enabled(client), [true, 'on', 'beta'].includes(value as boolean | string));
  }
});

test('reads are fresh and a lookup failure never retains a previous ON decision', async () => {
  for (const thrown of [false, true]) {
    let count = 0;
    const errors: Error[] = [];
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      if (++count === 1) return { data: { value: 'on' }, error: null };
      if (thrown) throw new Error('configuration unavailable');
      return { data: null, error: { message: 'configuration unavailable' } };
    } }) }) }) };
    assert.equal(await rankingShadowDecoupled6765Enabled(client, e => errors.push(e)), true);
    assert.equal(await rankingShadowDecoupled6765Enabled(client, e => errors.push(e)), false);
    assert.equal(count, 2); assert.equal(errors.length, 1);
  }
  assert.equal(await rankingShadowDecoupled6765Enabled({}), false);
  assert.equal(await rankingShadowDecoupled6765Enabled(undefined), false);
  assert.equal(await rankingShadowDecoupled6765Enabled(null), false);
});
