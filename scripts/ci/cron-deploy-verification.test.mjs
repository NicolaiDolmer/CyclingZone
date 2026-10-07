import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { affectedCronJobs, changedFiles, evaluateCheckins, verifyCronCheckins } from './cron-deploy-verification.mjs';

const since = '2026-10-07T12:00:00Z';
const monitors = [['short', { schedule: { value: 1, unit: 'minute' }, checkinMargin: 1 }],
  ['long', { schedule: { value: 1, unit: 'hour' }, checkinMargin: 2 }]];
const row = (job_slug, last_checkin_at, expected_cadence_seconds = job_slug === 'short' ? 60 : 3600) =>
  ({ job_slug, last_checkin_at, expected_cadence_seconds });
const evaluate = (rows, now = '2026-10-07T12:00:30Z', slugs = ['short']) =>
  evaluateCheckins({ slugs, rows, since, now, monitors });

test('strict boundary, future, missing, unreadable and wrong cadence cannot verify', () => {
  for (const rows of [[], [row('short', null)], [row('short', 'invalid')],
    [row('short', '2026-10-07T12:01:00Z')], [row('short', '2026-10-07T12:00:10Z', 99)]]) {
    assert.equal(evaluate(rows).state, 'failed');
  }
  assert.equal(evaluate([row('short', since)]).state, 'waiting');
  assert.equal(evaluate([row('short', '2026-10-07T11:59:30Z')]).state, 'waiting');
  assert.equal(evaluate([row('short', '2026-10-07T11:00:00Z')]).state, 'failed');
  assert.equal(evaluate([row('short', '2026-10-07T12:00:10Z')]).state, 'verified');
  assert.equal(evaluate([row('short', since)], '2026-10-07T12:02:00Z').state, 'failed');
  assert.equal(evaluate([row('short', '2026-10-07T12:02:01Z')], '2026-10-07T12:02:10Z').state, 'failed');
});

test('long cadence defers before deadline and fails after cadence plus SSOT margin', () => {
  assert.equal(evaluate([row('long', since)], undefined, ['long']).state, 'deferred');
  assert.equal(evaluate([row('long', since)], '2026-10-07T13:02:00Z', ['long']).state, 'failed');
  assert.equal(evaluate([row('long', '2026-10-07T10:00:00Z')], undefined, ['long']).state, 'failed');
});

test('boot cohorts are excluded and remembered across polls', () => {
  const excluded = new Set();
  const boot = '2026-10-07T12:00:05Z';
  assert.equal(evaluateCheckins({ slugs: ['short'], rows: [row('short', boot), row('long', boot)], since,
    now: '2026-10-07T12:00:30Z', monitors, excluded }).state, 'waiting');
  assert.equal(evaluateCheckins({ slugs: ['short'], rows: [row('short', boot), row('long', since)], since,
    now: '2026-10-07T12:00:45Z', monitors, excluded }).state, 'waiting');
});

test('polling is GET-only, sleeps on short cadence and emits job plus last check-in on deadline', async () => {
  let milliseconds = Date.parse(since), calls = 0;
  const logs = [];
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => new Date(milliseconds).toISOString(), sleep: async ms => { milliseconds += ms; },
    fetchFn: async (url, options) => {
      calls++; assert.equal(options.method, 'GET');
      assert.equal(url.pathname, '/rest/v1/cron_checkins');
      return { ok: true, json: async () => [row('short', since)] };
    }, log: line => logs.push(line) });
  assert.equal(result.state, 'failed'); assert.equal(calls, 9);
  assert.match(logs.at(-1), /short: failed; last check-in=2026-10-07T12:00:00/);
});

test('initial fresh snapshot alone cannot establish a tick after READY', async () => {
  let calls = 0;
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => '2026-10-07T12:00:30Z', sleep: async () => {},
    fetchFn: async () => ({ ok: true, json: async () => [row('short', ++calls === 1
      ? '2026-10-07T12:00:05Z' : '2026-10-07T12:00:20Z')] }) });
  assert.equal(result.state, 'verified'); assert.equal(calls, 2);
});

test('transport, non-array, duplicate and HTTP errors fail closed without leaking bodies', async () => {
  for (const fetchFn of [async () => { throw new Error('private body'); },
    async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ secret: 'private' }) }),
    async () => ({ ok: true, json: async () => [row('short', since), row('short', since)] })]) {
    const logs = [];
    assert.equal((await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
      now: () => since, sleep: async () => assert.fail('must not sleep'), fetchFn, log: line => logs.push(line) })).state, 'failed');
    assert.ok(logs.every(line => !line.includes('private')));
  }
});

test('unreadable configuration prints affected job diagnostics without requests or credentials', async () => {
  const logs = [];
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'private-invalid-url', key: '',
    now: () => since, sleep: async () => assert.fail(), fetchFn: async () => assert.fail(), log: line => logs.push(line) });
  assert.equal(result.state, 'failed');
  assert.deepEqual(logs, ['short: failed; last check-in=unreadable; deadline=unknown']);
});

test('mixed cadence waits for short jobs before returning deferred, never verified', async () => {
  let calls = 0;
  const result = await verifyCronCheckins({ slugs: ['short', 'long'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => '2026-10-07T12:00:30Z', sleep: async () => {},
    fetchFn: async () => ({ ok: true, json: async () => [row('short', ++calls === 1 ? since : '2026-10-07T12:00:20Z'), row('long', since)] }) });
  assert.equal(result.state, 'deferred'); assert.equal(calls, 2);
});

test('accepted first-tick proof survives later heartbeat overwrites while another short job waits', async () => {
  const configs = [monitors[0], ['medium', { schedule: { value: 5, unit: 'minute' }, checkinMargin: 1 }]];
  let calls = 0;
  const timestamps = [since, '2026-10-07T12:01:00Z', '2026-10-07T12:06:00Z'];
  const result = await verifyCronCheckins({ slugs: ['short', 'medium'], since, monitors: configs,
    url: 'https://fixture.invalid', key: 'fixture', now: () => timestamps[calls - 1], sleep: async () => {},
    fetchFn: async () => {
      calls++;
      return { ok: true, json: async () => [row('short', timestamps[calls - 1]),
        row('medium', calls < 3 ? since : '2026-10-07T12:05:50Z', 300)] };
    } });
  assert.equal(result.state, 'verified');
  assert.equal(result.jobs.find(job => job.slug === 'short').lastCheckin, '2026-10-07T12:01:00.000Z');
});

test('cached first-tick proof cannot hide a missing, future or stale current heartbeat', () => {
  const accepted = new Map([['short', { lastCheckin: '2026-10-07T12:01:00.000Z' }]]);
  for (const rows of [[], [row('short', '2026-10-07T12:07:00Z')], [row('short', '2026-10-07T12:01:00Z')]]) {
    assert.equal(evaluateCheckins({ slugs: ['short'], rows, since, now: '2026-10-07T12:06:00Z', monitors, accepted }).state, 'failed');
  }
});

const map = { commonSourcePaths: ['backend/cron.js'], sourcePathsBySlug: { short: ['backend/a.js'], long: [] } };
const sources = { 'backend/a.js': "import './nested.ts';", 'backend/nested.ts': "export { guard } from './guard.js';", 'backend/guard.js': '' };
const impact = files => affectedCronJobs(files, { map, monitors, exists: path => path in sources, read: path => sources[path] });
test('impact includes transitive TS and guard dependencies, renames and inline common triggers', () => {
  assert.deepEqual(impact([{ filename: 'backend/guard.js', status: 'modified' }]), ['short']);
  assert.deepEqual(impact([{ filename: 'backend/new.js', previous_filename: 'backend/guard.js', status: 'renamed' }]), ['short', 'long']);
  assert.deepEqual(impact([{ filename: 'backend/cron.js', status: 'modified' }]), ['short', 'long']);
  assert.deepEqual(impact([{ filename: 'docs/example.md', status: 'modified' }]), []);
  assert.deepEqual(impact([{ filename: 'backend/unknown.js', status: 'modified' }]), ['short', 'long']);
  assert.throws(() => impact([{ filename: 'backend/new.js', status: 'renamed' }]));
  assert.throws(() => impact([]));
});

test('real source map covers every registry job and stall aggregates reach watchdog', () => {
  const jobs = affectedCronJobs([{ filename: 'backend/lib/stallWatchdogAggregates.ts', status: 'modified' }]);
  assert.ok(jobs.includes('stall-watchdog'));
  assert.ok(jobs.length < 55, 'an unrelated graph/prose reference must not widen every cron');
  assert.deepEqual(affectedCronJobs([{ filename: 'docs/DEPLOYMENT.md', status: 'modified' }]), []);
  const savedMap = JSON.parse(readFileSync(new URL('./cron-source-map.json', import.meta.url)));
  assert.equal(Object.keys(savedMap.sourcePathsBySlug).length, 55);
});

test('unknown relative dependency widens to all rather than silently dropping an edge', () => {
  assert.deepEqual(affectedCronJobs([{ filename: 'backend/a.js', status: 'modified' }], { map, monitors,
    exists: path => path === 'backend/a.js', read: () => "import './missing';" }), ['short', 'long']);
});

test('changed-file retrieval validates target, pagination, transport and completeness', async () => {
  const sha = 'a'.repeat(40);
  const args = { sha, repository: 'fixture/repo', token: 'fixture' };
  assert.deepEqual(await changedFiles({ ...args, fetchFn: async (_, options) => {
    assert.equal(options.method, 'GET'); return { ok: true, json: async () => ({ sha, files: [{ filename: 'backend/a.js', status: 'modified' }] }) };
  } }), [{ filename: 'backend/a.js', status: 'modified' }]);
  for (const data of [{ sha: 'b'.repeat(40), files: [] }, { sha }, { sha, files: [] }]) {
    await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: true, json: async () => data }) }));
  }
  await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: false }) }));
  await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: true, json: async () => ({ sha,
    files: Array.from({ length: 100 }, (_, i) => ({ filename: `backend/${i}.js`, status: 'modified' })) }) }) }));
});

test('dry-run makes no requests and does not claim verification', () => {
  const output = execFileSync(process.execPath, [new URL('./cron-deploy-verification.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--dry-run'],
    { env: { ...process.env, AFFECTED_SLUGS: '["short"]', SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' }, encoding: 'utf8' });
  assert.match(output, /no heartbeat request or mutation; not verified/);
});

test('production workflow checks out target SHA, observes READY boundary and gates LIVE on cron proof', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Checkout target SHA[\s\S]*?ref: \$\{\{ steps\.pr\.outputs\.sha \}\}/);
  assert.ok(workflow.indexOf('name: Checkout target SHA') < workflow.indexOf('cron-deploy-verification.mjs --impact'));
  assert.match(workflow, /if \$RAILWAY_OK && \[\[ -z "\$CRON_SINCE" \]\]; then\s+CRON_SINCE=\$\(date -u/);
  assert.match(workflow, /while \[\[[\s\S]*?RAILWAY_OK=false\s+(?:#[^\n]*\r?\n\s*)+CRON_SINCE=""/);
  assert.match(workflow, /echo "cron_since=\$CRON_SINCE" >> "\$GITHUB_OUTPUT"/);
  const gate = workflow.indexOf('name: Verify affected cron check-ins');
  const live = workflow.indexOf('name: Comment success on merged PR');
  assert.ok(gate > 0 && gate < live);
  assert.match(workflow.slice(gate, live), /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/);
  assert.match(workflow.slice(live), /if: success\(\).*steps\.crons\.outputs\.state == 'verified'/);
  assert.match(workflow, /name: Cron check-ins deferred/);
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /node --test scripts\/ci\/cron-deploy-verification\.test\.mjs scripts\/ci\/deploy-verification-state\.test\.mjs/);
});
