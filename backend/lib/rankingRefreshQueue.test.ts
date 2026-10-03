import test from 'node:test';
import assert from 'node:assert/strict';
import { createRankingRefreshQueue } from './rankingRefreshQueue.ts';

test('requests during a running follow-up get a third fresh pass, all serialized', async () => {
  const run = createRankingRefreshQueue<number>();
  const client = {};
  const firstGate = Promise.withResolvers<void>();
  const secondGate = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  let passes = 0;
  const first = run(client, async () => { passes++; await firstGate.promise; return 1; });
  const second = run(client, async () => { passes++; secondStarted.resolve(); await secondGate.promise; return 2; });
  const sharedSecond = run(client, async () => { passes++; secondStarted.resolve(); await secondGate.promise; return 2; });
  assert.equal(second, sharedSecond);
  firstGate.resolve();
  assert.equal(await first, 1);
  await secondStarted.promise;
  const third = run(client, async () => { passes++; return 3; });
  secondGate.resolve();
  assert.equal(await second, 2);
  assert.equal(await sharedSecond, 2);
  assert.equal(await third, 3);
  assert.equal(passes, 3);
});

test('a rejected active pass releases the pending pass and later requests', async () => {
  const run = createRankingRefreshQueue<boolean>();
  const client = {};
  const gate = Promise.withResolvers<void>();
  const first = run(client, async () => { await gate.promise; throw new Error('upstream'); });
  const rejected = assert.rejects(first, /upstream/);
  const pending = run(client, async () => true);
  gate.resolve();
  await rejected;
  assert.equal(await pending, true);
  assert.equal(await run(client, async () => false), false);
});

test('independent clients do not share a queue', async () => {
  const run = createRankingRefreshQueue<boolean>();
  const gate = Promise.withResolvers<void>();
  const first = run({}, async () => { await gate.promise; return false; });
  assert.equal(await run({}, async () => true), true);
  gate.resolve();
  assert.equal(await first, false);
});

test('an unconditional pending request cannot be replaced by a gated request', async () => {
  const run = createRankingRefreshQueue<boolean | 'deferred'>();
  const client = {};
  const gate = Promise.withResolvers<void>();
  const first = run(client, async () => { await gate.promise; return true; });
  const unconditional = run(client, async () => true, 1);
  const gated = run(client, async () => 'deferred', 0);
  gate.resolve();
  assert.equal(await first, true);
  assert.equal(await unconditional, true);
  assert.equal(await gated, true);
});
