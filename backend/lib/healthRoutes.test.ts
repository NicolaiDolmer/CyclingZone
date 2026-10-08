import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHealthRouter, probeHealthDatabase } from './healthRoutes.ts';

const fixedNow = () => new Date('2026-10-04T00:00:00Z');

async function serve(t: test.TestContext, databaseFetch: typeof fetch) {
  const supabase = createClient('https://health-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: databaseFetch },
  });
  const app = express();
  app.use(createHealthRouter({ supabase, now: fixedNow }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('DB outage cannot prevent Railway liveness and does not make a DB request', async t => {
  let calls = 0;
  const base = await serve(t, async () => { calls++; return new Response(null, { status: 503 }); });
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', timestamp: fixedNow().toISOString() });
  assert.equal(calls, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('readiness reports a DB outage as 503 without leaking upstream details', async t => {
  const base = await serve(t, async () => new Response(JSON.stringify({ message: 'private upstream detail' }), { status: 503 }));
  const response = await fetch(`${base}/health/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'degraded', db: 'error', timestamp: fixedNow().toISOString() });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('readiness probes one bounded row and recovers on the next request', async t => {
  let healthy = false;
  const queries: URL[] = [];
  const base = await serve(t, async (input, init) => {
    queries.push(new URL(String(input)));
    assert.equal(init?.method, 'HEAD');
    return new Response(null, { status: healthy ? 200 : 503 });
  });
  assert.equal((await fetch(`${base}/health/ready`)).status, 503);
  healthy = true;
  const response = await fetch(`${base}/health/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', db: 'ok', timestamp: fixedNow().toISOString() });
  assert.equal(queries.length, 2);
  assert.ok(queries.every(url => url.pathname === '/rest/v1/app_config' && url.searchParams.get('limit') === '1'));
});

test('a hung DB transport that ignores abort still reaches the readiness deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers<void>();
  let signal: AbortSignal | null | undefined;
  const supabase = createClient('https://health-test.invalid', 'test-key', {
    auth: { persistSession: false },
    global: { fetch: async (_input, init) => { signal = init?.signal; started.resolve(); return new Promise<Response>(() => {}); } },
  });
  const probe = probeHealthDatabase(supabase, 3000);
  await started.promise;
  t.mock.timers.tick(3000);
  assert.equal(await probe, false);
  assert.equal(signal?.aborted, true);
});

test('a rejected transport becomes degraded without an unhandled rejection', async () => {
  const supabase = createClient('https://health-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async () => { throw new Error('network down'); } },
  });
  assert.equal(await probeHealthDatabase(supabase, 3000), false);
});

test('liveness stays available while another HTTP readiness request waits for DB', async t => {
  const started = Promise.withResolvers<void>();
  const result = Promise.withResolvers<Response>();
  let calls = 0;
  const base = await serve(t, async () => { calls++; started.resolve(); return result.promise; });
  const readiness = fetch(`${base}/health/ready`);
  await started.promise;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal(calls, 1);
  } finally {
    result.resolve(new Response(null, { status: 200 }));
    assert.equal((await readiness).status, 200);
  }
});

test('a DB rejection arriving after the timeout is handled and cannot change the verdict', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers<void>();
  const result = Promise.withResolvers<Response>();
  const supabase = createClient('https://health-test.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async () => { started.resolve(); return result.promise; } },
  });
  const probe = probeHealthDatabase(supabase, 3000);
  await started.promise;
  t.mock.timers.tick(3000);
  assert.equal(await probe, false);
  result.reject(new Error('late upstream failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(await probe, false);
});
