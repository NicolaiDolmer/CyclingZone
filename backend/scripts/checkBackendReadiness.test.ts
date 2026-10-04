import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForBackendReadiness } from './checkBackendReadiness.ts';

test('deployment smoke retries DB outages and succeeds only after readiness recovers', async () => {
  let calls = 0;
  const waits: number[] = [];
  const ready = await waitForBackendReadiness({
    baseUrl: 'https://backend-test.invalid',
    fetchFn: async (input, init) => {
      assert.equal(String(input), 'https://backend-test.invalid/health/ready');
      assert.equal(init?.cache, 'no-store');
      calls++;
      return new Response(JSON.stringify({ status: 'ok', db: 'ok' }), { status: calls === 3 ? 200 : 503 });
    },
    wait: async ms => { waits.push(ms); },
  });
  assert.equal(ready, true);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 5000]);
});

test('a persistent network failure exhausts the finite retry budget and fails', async () => {
  let calls = 0;
  let waits = 0;
  assert.equal(await waitForBackendReadiness({
    baseUrl: 'https://backend-test.invalid',
    fetchFn: async () => { calls++; throw new Error('offline'); },
    wait: async () => { waits++; },
  }), false);
  assert.equal(calls, 6);
  assert.equal(waits, 5);
});

test('HTTP 200 with liveness or an unrelated page cannot pass DB readiness', async () => {
  assert.equal(await waitForBackendReadiness({
    baseUrl: 'https://backend-test.invalid', attempts: 1,
    fetchFn: async () => new Response(JSON.stringify({ status: 'ok' })), wait: async () => {},
  }), false);
});

test('a hanging smoke request that ignores abort still fails at the hard deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers<void>();
  let signal: AbortSignal | null | undefined;
  const ready = waitForBackendReadiness({
    baseUrl: 'https://backend-test.invalid', attempts: 1,
    fetchFn: async (_input, init) => { signal = init?.signal; started.resolve(); return new Promise<Response>(() => {}); },
    wait: async () => {},
  });
  await started.promise;
  t.mock.timers.tick(5000);
  assert.equal(await ready, false);
  assert.equal(signal?.aborted, true);
});
