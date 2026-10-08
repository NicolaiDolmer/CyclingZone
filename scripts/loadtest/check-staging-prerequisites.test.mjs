import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStagingPrerequisites, runCli } from './check-staging-prerequisites.mjs';

const stagingRef = 'pywxpnynzmbukdvoiazp';
const key = 'fixture-secret-never-print';
const config = { ref: stagingRef, url: `https://${stagingRef}.supabase.co`, key, minResults: 1865119 };
const env = { STAGING_REF: config.ref, STAGING_SUPABASE_URL: config.url, STAGING_SERVICE_KEY: key };
const reply = (status = 200, count = '*/1865119') => new Response(null, { status, headers: { 'content-range': count } });

test('known staging with schema and exact volume passes only data prerequisites', async () => {
  const calls = [];
  const result = await checkStagingPrerequisites(config, async (url, options) => {
    calls.push({ url: new URL(url), options });
    return reply();
  });
  assert.equal(result.status, 'DATA_PREREQUISITES_READY');
  assert.equal(result.loadTestPassed, false);
  assert.equal(result.resultRows, 1865119);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(c => c.url.pathname), ['/rest/v1/races', '/rest/v1/training_date_work', '/rest/v1/race_day_participation', '/rest/v1/race_results']);
  for (const { url, options } of calls) {
    assert.equal(url.origin, config.url);
    assert.equal(url.searchParams.get('limit'), '0');
    assert.equal(options.method, 'HEAD');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.apikey, key);
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].url.searchParams.get('select'), 'id,squad,finalize_state,finalize_updated_at,engine_rules_revision');
  assert.equal(calls[3].options.headers.Prefer, 'count=exact');
  assert.equal(calls[0].options.headers.Prefer, undefined);
});

test('prod, unknown target, URL tricks and incomplete config fail before any request', async () => {
  const variants = [
    { ref: 'ghwvkxzhsbbltzfnuhhz', url: 'https://ghwvkxzhsbbltzfnuhhz.supabase.co' },
    { ref: 'aaaaaaaaaaaaaaaaaaaa', url: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' },
    { url: `https://${stagingRef}.supabase.co.attacker.invalid` },
    { url: `${config.url}/rest/v1` }, { url: `${config.url}/?secret=${key}` },
    { url: `${config.url}#fragment` }, { url: `http://${stagingRef}.supabase.co` },
    { url: `https://user:pass@${stagingRef}.supabase.co` },
    { url: `https://${stagingRef}.supabase.co:443` },
    { key: '' }, { ref: undefined }, { url: undefined },
    { minResults: 0 }, { minResults: NaN }, { minResults: -1 },
    { minResults: '1865119' }, { minResults: 1.5 }, { minResults: Infinity },
  ];
  for (const variant of variants) {
    let requests = 0;
    const result = await checkStagingPrerequisites({ ...config, ...variant }, async () => { requests++; return reply(); });
    assert.equal(result.status, 'BLOCKED', JSON.stringify(variant));
    assert.equal(requests, 0);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test('empty/undersized data blocks despite healthy schema', async () => {
  for (const rows of [0, 1865118]) {
    const result = await checkStagingPrerequisites(config, async () => reply(200, `*/${rows}`));
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes('RESULT_VOLUME_TOO_SMALL'));
  }
});

test('missing schema, HTTP failures and redirects block without exposing response data', async () => {
  for (const table of ['races', 'training_date_work', 'race_day_participation']) {
    for (const status of [302, 401, 403, 404, 500, 503]) {
      const result = await checkStagingPrerequisites(config, async url => new URL(url).pathname.endsWith(`/${table}`) ? reply(status) : reply());
      assert.equal(result.status, 'BLOCKED');
      assert.ok(result.blockers.includes(`SCHEMA_${table.toUpperCase()}_HTTP_${status}`));
    }
  }
});

test('failed count request is unknown, never interpreted as zero or ready', async () => {
  const result = await checkStagingPrerequisites(config, async url => new URL(url).pathname.endsWith('/race_results') ? reply(503) : reply());
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.resultRows, null);
  assert.deepEqual(result.blockers, ['RESULT_COUNT_HTTP_503']);
});

test('unknown/malformed/inexact count never becomes a successful volume measurement', async () => {
  for (const count of [null, '*/ *', '*/*', '0-0/*', '*/-1', '*/1.5', '*/9007199254740993']) {
    const result = await checkStagingPrerequisites(config, async url => {
      if (!new URL(url).pathname.endsWith('/race_results')) return reply();
      return new Response(null, { status: 200, headers: count === null ? {} : { 'content-range': count } });
    });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.includes('RESULT_COUNT_UNKNOWN'));
    assert.equal(result.resultRows, null);
  }
});

test('network/cancellation errors fail closed and redact exceptions', async () => {
  for (const name of ['Error', 'TimeoutError', 'AbortError']) {
    const result = await checkStagingPrerequisites(config, async () => {
      const error = new Error(`Authorization: Bearer ${key} ${config.url}`);
      error.name = name;
      throw error;
    });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(result.blockers.length, 4);
  }
});

test('CLI requires explicit volume and staging-only credentials; no prod-env fallback', async () => {
  for (const args of [[], ['--min-results', '0'], ['--min-results', '1e6'], ['--min-results', '42', '--apply']]) {
    let requests = 0;
    const output = [];
    assert.equal(await runCli(args, { env, fetchImpl: async () => { requests++; return reply(); }, write: s => output.push(s) }), 1);
    assert.equal(requests, 0);
    assert.equal(output.join('').includes(key), false);
  }
  const output = [];
  let requests = 0;
  assert.equal(await runCli(['--min-results', '1865119'], { env: { SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: key }, fetchImpl: async () => { requests++; return reply(); }, write: s => output.push(s) }), 1);
  assert.equal(requests, 0);
});

test('CLI emits bounded JSON and uses nonzero exit for measured blockers', async () => {
  for (const rows of [0, 1865119]) {
    const output = [];
    const code = await runCli(['--min-results', '1865119'], { env, fetchImpl: async () => reply(200, `*/${rows}`), write: s => output.push(s) });
    assert.equal(code, rows === 0 ? 1 : 0);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]).loadTestPassed, false);
    assert.equal(output[0].includes(key), false);
  }
});
