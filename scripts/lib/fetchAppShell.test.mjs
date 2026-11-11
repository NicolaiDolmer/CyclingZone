import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appShellHeaders, fetchAppShell } from './fetchAppShell.mjs';
test('app probes never manufacture credentials and preserve headers', () => {
  assert.deepEqual(appShellHeaders(), {});
  assert.deepEqual(appShellHeaders({ accept: 'text/html' }), { accept: 'text/html' });
});
test('root probe selects the app route while preserving query and init', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('ok'); };
  try { await fetchAppShell('https://cyclingzone.org/?probe=1', { redirect: 'follow' }); }
  finally { globalThis.fetch = original; }
  assert.equal(calls[0].url, 'https://cyclingzone.org/dashboard?probe=1');
  assert.equal(calls[0].init.redirect, 'follow');
  assert.equal(calls[0].init.headers.cookie, undefined);
});
