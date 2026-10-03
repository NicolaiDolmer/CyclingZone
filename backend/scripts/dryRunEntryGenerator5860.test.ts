import test from 'node:test';
import assert from 'node:assert/strict';
import { readOnlyGeneratorClient } from './dryRunEntryGenerator5860.ts';

test('dry-run permits chained reads and blocks mutations at every chain depth', async () => {
  let writes = 0;
  const query = {
    select() { return this; }, eq() { return this; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: [{ id: 'rider' }], error: null })); },
    insert() { writes++; }, upsert() { writes++; }, update() { writes++; }, delete() { writes++; },
  };
  const client = readOnlyGeneratorClient({ from: () => query });
  assert.deepEqual(await client.from('fixture_rows').select().eq(), { data: [{ id: 'rider' }], error: null });
  for (const method of ['insert', 'upsert', 'update', 'delete']) {
    assert.throws(() => client.from('fixture_rows')[method](), /refuses database mutation/);
    assert.throws(() => client.from('fixture_rows').select().eq()[method](), /refuses database mutation/);
  }
  assert.throws(() => client.rpc(), /refuses RPC/);
  assert.equal(writes, 0);
});
