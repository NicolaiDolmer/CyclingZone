import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWatchdogResultSummaries } from './stallWatchdogAggregates.ts';

const empty = (race_id: string) => ({ race_id, last_imported_at: null, has_prize: false, stage_numbers: [] });

test('deduplicated candidates use bounded POST batches and one row per race', async () => {
  const ids = Array.from({ length: 601 }, (_, index) => `race-${index}`);
  const sizes: number[] = [];
  const rows = await fetchWatchdogResultSummaries({
    async rpc(name, { p_race_ids }, options) {
      assert.equal(name, 'stall_watchdog_result_summary');
      assert.deepEqual(options, { get: false });
      sizes.push(p_race_ids.length);
      return { data: p_race_ids.map(empty), error: null };
    },
  }, [...ids, ...ids]);
  assert.deepEqual(sizes, [300, 300, 1]);
  assert.equal(rows.size, 601);
});

test('empty candidates make no network request', async () => {
  const rows = await fetchWatchdogResultSummaries({ rpc: () => { throw new Error('unexpected network request'); } }, []);
  assert.equal(rows.size, 0);
});

test('SQL NULL, zero and negative stage keys remain present', async () => {
  const rows = await fetchWatchdogResultSummaries({
    rpc: async () => ({ data: [{ ...empty('r'), stage_numbers: [-1, 0, 1, null] }], error: null }),
  }, ['r']);
  assert.deepEqual(rows.get('r')?.stage_numbers, [-1, 0, 1, null]);
});

test('RPC/permissions errors and malformed or incomplete data cannot become a clean watchdog state', async () => {
  for (const response of [
    { data: null, error: { message: 'permission denied' } },
    { data: null, error: null },
    { data: [], error: null },
    { data: [empty('other')], error: null },
    { data: [empty('r'), empty('r')], error: null },
    { data: [{ ...empty('r'), has_prize: 'false' }], error: null },
    { data: [{ ...empty('r'), last_imported_at: 'invalid timestamp' }], error: null },
    { data: [{ ...empty('r'), stage_numbers: ['1'] }], error: null },
  ]) {
    await assert.rejects(fetchWatchdogResultSummaries({ rpc: async () => response }, ['r']), /stall-watchdog result summary/);
  }
  await assert.rejects(fetchWatchdogResultSummaries({ rpc: async () => { throw new Error('transport failure'); } }, ['r']), /transport failure/);
});

test("migration marker names a migration file that exists (#6102 marker drift)", async () => {
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { WATCHDOG_RESULT_MIGRATION } = await import("./stallWatchdogAggregates.ts");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  assert.ok(existsSync(root + WATCHDOG_RESULT_MIGRATION), `${WATCHDOG_RESULT_MIGRATION} must exist, or the watchdog stops in prod`);
});
