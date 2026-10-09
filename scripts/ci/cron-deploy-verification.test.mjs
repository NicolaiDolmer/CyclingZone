import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { affectedCronJobs, changedFiles, deploymentImpact, evaluateCheckins, railwayDrainSeconds, safeReason,
  verifyCronCheckins } from './cron-deploy-verification.mjs';

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

test('a newly observed boot cohort revokes cached evidence and requires a distinct tick', () => {
  const boot = '2026-10-07T12:00:10Z';
  const accepted = new Map([['short', { lastCheckin: boot }]]);
  const excluded = new Set();
  const args = { slugs: ['short'], since, now: '2026-10-07T12:00:30Z', monitors, accepted, excluded };
  assert.equal(evaluateCheckins({ ...args, rows: [row('short', boot), row('long', boot)] }).state, 'waiting');
  assert.equal(accepted.size, 0);
  assert.equal(evaluateCheckins({ ...args, rows: [row('short', '2026-10-07T12:00:20Z'), row('long', boot)] }).state, 'verified');
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

test('unknown relative dependency always includes its job rather than silently dropping an edge', () => {
  assert.deepEqual(affectedCronJobs([{ filename: 'backend/a.js', status: 'modified' }], { map, monitors,
    exists: path => path === 'backend/a.js', read: () => "import './missing';" }), ['short']);
});

test('prose and path strings do not create loader edges; comments between real loader tokens are supported', () => {
  const text = "// import (not code)\n// import './missing';\nconst label = \"from './missing'\";\nimport /* real edge */ './guard.js';";
  assert.deepEqual(affectedCronJobs([{ filename: 'backend/guard.js', status: 'modified' }], { map, monitors,
    exists: path => path === 'backend/a.js' || path === 'backend/guard.js',
    read: path => path === 'backend/a.js' ? text : '' }), ['short']);
});

test('template-expression and nonliteral loaders remain potentially affected rather than disappearing through masking', () => {
  for (const source of ["const text = `hello ${await import('./guard.js')}`;", 'await import(variable);']) {
    assert.deepEqual(affectedCronJobs([{ filename: 'backend/a.js', status: 'modified' }], { map, monitors,
      exists: path => path === 'backend/a.js', read: () => source }), ['short']);
  }
});

test('an unresolved job remains affected when a different known runtime job changes; unknown files require all', () => {
  const sources = { 'backend/a.js': 'await import(variable);', 'backend/long.js': '' };
  const options = { map: { ...map, sourcePathsBySlug: { short: ['backend/a.js'], long: ['backend/long.js'] } }, monitors,
    exists: path => path in sources, read: path => sources[path] };
  assert.deepEqual(affectedCronJobs([{ filename: 'backend/long.js', status: 'modified' }], options), ['short', 'long']);
  assert.deepEqual(affectedCronJobs([{ filename: 'backend/unknown.js', status: 'modified' }], options), ['short', 'long']);
  assert.deepEqual(affectedCronJobs([{ filename: 'docs/example.md', status: 'modified' }], options), []);
});

test('changed-file retrieval validates target, pagination, transport and completeness', async () => {
  const sha = 'a'.repeat(40);
  const args = { sha, repository: 'fixture/repo', token: 'fixture' };
  assert.deepEqual(await changedFiles({ ...args, fetchFn: async (_, options) => {
    assert.equal(options.method, 'GET'); return { ok: true, json: async () => ({ sha, files: [{ filename: 'backend/a.js', status: 'modified' }] }) };
  } }), [{ filename: 'backend/a.js', status: 'modified' }]);
  for (const data of [{ sha: 'b'.repeat(40), files: [] }, { sha }]) {
    await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: true, json: async () => data }) }));
  }
  // Empty is returned (not thrown); deploymentImpact must confirm it locally.
  assert.deepEqual(await changedFiles({ ...args, fetchFn: async () => ({ ok: true, json: async () => ({ sha, files: [] }) }) }), []);
  await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: false }) }));
  await assert.rejects(changedFiles({ ...args, fetchFn: async () => ({ ok: true, json: async () => ({ sha,
    files: Array.from({ length: 100 }, (_, i) => ({ filename: `backend/${i}.js`, status: 'modified' })) }) }) }));
});

test('dry-run makes no requests and does not claim verification', () => {
  const output = execFileSync(process.execPath, [new URL('./cron-deploy-verification.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--dry-run'],
    { env: { ...process.env, AFFECTED_SLUGS: '["short"]', SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' }, encoding: 'utf8' });
  assert.match(output, /no heartbeat request or mutation; not verified/);
});

test('#6318 review: a common backend change widening to every registry job verifies short cadences and only defers long ones', async () => {
  const jobs = affectedCronJobs([{ filename: 'backend/server.js', status: 'modified' }]);
  const { ALL_CRON_MONITORS } = await import('../../backend/lib/cronMonitorRegistry.js');
  assert.equal(jobs.length, ALL_CRON_MONITORS.length);
  const units = { minute: 60, hour: 3600, day: 86400 };
  const cadence = config => config.schedule.value * units[config.schedule.unit];
  const drainSeconds = railwayDrainSeconds();
  const prime = Date.parse(since) - 30_000;
  let clock = Date.parse(since), calls = 0;
  const result = await verifyCronCheckins({ slugs: jobs, since, url: 'https://fixture.invalid', key: 'fixture', drainSeconds,
    now: () => new Date(clock).toISOString(), sleep: async ms => { clock += ms; },
    fetchFn: async () => {
      calls++;
      // Short jobs tick on the new process once draining is over; distinct
      // timestamps so they never look like a boot cohort. Long jobs keep
      // their boot-prime timestamp (still inside cadence + margin).
      const rows = ALL_CRON_MONITORS.map(([slug, config], index) => {
        const fresh = calls > 1 && cadence(config) <= 1800 && clock - 1000 - index > Date.parse(since) + drainSeconds * 1000;
        return row(slug, new Date(fresh ? clock - 1000 - index : prime).toISOString(), cadence(config));
      });
      return { ok: true, json: async () => rows };
    } });
  assert.equal(result.state, 'deferred');
  for (const job of result.jobs) {
    const config = ALL_CRON_MONITORS.find(([slug]) => slug === job.slug)[1];
    assert.equal(job.state, cadence(config) <= 1800 ? 'verified' : 'deferred', job.slug);
  }
  assert.ok(clock - Date.parse(since) < (drainSeconds + 120) * 1000, 'short proof must not wait for long cadences');
});

test('#6318 review: a check-in during Railway draining (old process) is not proof', () => {
  const args = { slugs: ['short'], since, monitors, drainSeconds: 150 };
  assert.equal(evaluateCheckins({ ...args, rows: [row('short', '2026-10-07T12:01:00Z')], now: '2026-10-07T12:01:30Z' }).state, 'waiting');
  assert.equal(evaluateCheckins({ ...args, rows: [row('short', '2026-10-07T12:02:31Z')], now: '2026-10-07T12:02:40Z' }).state, 'verified');
  // Deadline starts after the drain window as well.
  const late = evaluateCheckins({ ...args, rows: [row('short', '2026-10-07T12:02:20Z')], now: '2026-10-07T12:04:30Z' });
  assert.equal(late.state, 'failed');
  assert.equal(late.jobs[0].deadline, '2026-10-07T12:04:30.000Z');
  assert.throws(() => evaluateCheckins({ ...args, drainSeconds: -1, rows: [], now: since }));
});

test('#6318 review: drain seconds come from the Railway config and fail closed when invalid', () => {
  const config = JSON.parse(readFileSync(new URL('../../backend/railway.json', import.meta.url), 'utf8'));
  assert.equal(railwayDrainSeconds(), config.deploy.drainingSeconds);
  assert.equal(railwayDrainSeconds(() => '{"deploy":{}}'), 0);
  for (const text of ['{"deploy":{"drainingSeconds":"150"}}', '{"deploy":{"drainingSeconds":-5}}', 'not json']) {
    assert.throws(() => railwayDrainSeconds(() => text));
  }
});

test('#6318 review: heartbeat query is filtered to registry slugs, ordered and bounded', async () => {
  let seen;
  await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => '2026-10-07T12:03:00Z', sleep: async () => {},
    fetchFn: async url => { seen = url; return { ok: true, json: async () => [row('short', since)] }; } });
  assert.equal(seen.searchParams.get('job_slug'), 'in.(short,long)');
  assert.equal(seen.searchParams.get('order'), 'job_slug.asc');
  assert.equal(seen.searchParams.get('limit'), '3');
  await assert.rejects(verifyCronCheckins({ slugs: ['short'], since, monitors: [['bad slug)', monitors[0][1]]],
    url: 'https://fixture.invalid', key: 'fixture', now: () => since, sleep: async () => {}, fetchFn: async () => assert.fail() }));
});

test('#6318 review: an empty commit has no impact only when the checkout confirms it', () => {
  assert.deepEqual(deploymentImpact([], { localChangedPaths: [] }), { slugs: [], needRailway: false, empty: true });
  assert.throws(() => deploymentImpact([], { localChangedPaths: ['backend/server.js'] }), /disagrees/);
  assert.throws(() => deploymentImpact([]), /could not be confirmed/);
  const impact = deploymentImpact([{ filename: 'backend/a.js', status: 'modified' }], { affected: () => [] });
  assert.deepEqual(impact, { slugs: [], needRailway: true, empty: false });
  assert.equal(deploymentImpact([{ filename: 'database/x.sql', status: 'added' }], { affected: () => ['short'] }).needRailway, true);
});

test('#6318 review: the top-level failure reason is logged without secrets or response bodies', () => {
  const secret = 'fixture-secret-value';
  const reason = safeReason(new Error(`Heartbeat GET failed for ${secret} with Bearer abc.def`), [secret, undefined, '']);
  assert.match(reason, /^Error: Heartbeat GET failed/);
  assert.ok(!reason.includes(secret) && !reason.includes('abc.def'));
  assert.equal(safeReason(new SyntaxError('Unexpected token < in "<html>private"')), 'SyntaxError: invalid JSON payload');
  const run = env => {
    try {
      execFileSync(process.execPath, [new URL('./cron-deploy-verification.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
        { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (error) { return error.stderr; }
  };
  const stderr = run({ AFFECTED_SLUGS: 'not-json', SUPABASE_SERVICE_KEY: secret });
  assert.match(stderr, /Cron deploy proof failed \(SyntaxError: invalid JSON payload\); no verification claimed/);
  assert.ok(!stderr.includes(secret));
});

test('production workflow checks out target SHA, observes READY boundary and gates LIVE on cron proof', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Checkout target SHA[\s\S]*?ref: \$\{\{ steps\.pr\.outputs\.sha \}\}[\s\S]*?fetch-depth: 0\s+- name: Determine required deployments/);
  // Railway/cron impact from this script; Vercel only from the canonical classifier.
  assert.match(workflow, /cron-deploy-verification\.mjs --impact\s+[\s\S]*?node scripts\/frontend-deployment-needed\.mjs "\$SHA"/);
  const deferredComment = workflow.slice(workflow.indexOf('name: Comment deferred cron proof on merged PR'), workflow.indexOf('name: Comment pending on merged PR'));
  assert.doesNotMatch(deferredComment, /exit 75/);
  assert.match(deferredComment, /Merge-koeen fortsaetter/);
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
