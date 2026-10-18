import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { affectedCronJobs, registryCadenceSeconds, changedFiles, deploymentImpact, evaluateCheckins, evaluateUnreadable, railwayDrainSeconds, safeReason, waitingSummary,
  verifyCronCheckins, SHORT_CADENCE_SECONDS, MAX_COHORT_SHIFT_SECONDS } from './cron-deploy-verification.mjs';
import { ALL_CRON_MONITORS } from '../../backend/lib/cronMonitorRegistry.js';

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

test('transport, non-array, duplicate and HTTP errors that last to the deadline fail closed without leaking bodies (#6799)', async () => {
  for (const fetchFn of [async () => { throw new Error('private body'); },
    async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ secret: 'private' }) }),
    async () => ({ ok: true, json: async () => [row('short', since), row('short', since)] })]) {
    const logs = [];
    let milliseconds = Date.parse(since), calls = 0;
    const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
      now: () => new Date(milliseconds).toISOString(), sleep: async ms => { milliseconds += ms; },
      fetchFn: async (...args) => { calls++; return fetchFn(...args); }, log: line => logs.push(line) });
    assert.equal(result.state, 'failed');
    assert.ok(calls > 1, 'a read error is retried, never an immediate verdict');
    assert.equal(milliseconds, Date.parse(since) + 120_000, 'red only once the job deadline is reached');
    assert.ok(logs.every(line => !line.includes('private')));
    assert.match(logs.at(-1), /short: failed; last check-in=missing\/unreadable; deadline=2026-10-07T12:02:00/);
  }
});

test('a transient read failure keeps accepted proof and retries within the deadline (#6799)', async () => {
  const configs = [monitors[0], ['medium', { schedule: { value: 5, unit: 'minute' }, checkinMargin: 1 }]];
  const clock = ['2026-10-07T12:00:20Z', '2026-10-07T12:00:40Z', '2026-10-07T12:01:00Z', '2026-10-07T12:03:00Z', '2026-10-07T12:05:00Z'];
  const bodies = [
    () => [row('short', '2026-10-07T12:00:05Z'), row('medium', '2026-10-07T11:59:00Z', 300)],
    () => [row('short', '2026-10-07T12:00:30Z'), row('medium', '2026-10-07T11:59:00Z', 300)],
    () => { throw new Error('private body'); },
    () => { throw new Error('private body'); },
    () => [row('short', '2026-10-07T12:04:30Z'), row('medium', '2026-10-07T12:04:40Z', 300)]];
  let calls = 0, sleeps = 0;
  const logs = [];
  const result = await verifyCronCheckins({ slugs: ['short', 'medium'], since, monitors: configs, url: 'https://fixture.invalid', key: 'fixture',
    now: () => clock[Math.min(calls, clock.length) - 1], sleep: async () => { sleeps++; },
    fetchFn: async () => { const body = bodies[calls++](); return { ok: true, json: async () => body }; }, log: line => logs.push(line) });
  assert.equal(result.state, 'verified'); assert.equal(calls, 5); assert.equal(sleeps, 4);
  assert.equal(result.jobs.find(job => job.slug === 'short').lastCheckin, '2026-10-07T12:00:30.000Z');
  assert.equal(logs.filter(line => line.startsWith('Heartbeat read failed')).length, 1);
  assert.ok(logs.every(line => !line.includes('private')));
});

test('a read error that lasts to the deadline is red for unaccepted jobs while accepted proof stays (#6799)', async () => {
  const configs = [monitors[0], ['medium', { schedule: { value: 5, unit: 'minute' }, checkinMargin: 1 }]];
  let milliseconds = Date.parse(since), calls = 0;
  const result = await verifyCronCheckins({ slugs: ['short', 'medium'], since, monitors: configs, url: 'https://fixture.invalid', key: 'fixture',
    now: () => new Date(milliseconds).toISOString(), sleep: async ms => { milliseconds += ms; },
    fetchFn: async () => {
      calls++;
      if (calls > 2) throw new Error('boom');
      const short = calls === 1 ? '2026-10-07T11:59:50Z' : '2026-10-07T12:00:10Z';
      return { ok: true, json: async () => [row('short', short), row('medium', '2026-10-07T11:59:00Z', 300)] };
    } });
  assert.equal(result.state, 'failed');
  assert.equal(result.jobs.find(job => job.slug === 'short').state, 'verified');
  assert.equal(result.jobs.find(job => job.slug === 'medium').state, 'failed');
});

test('an invalid first snapshot does not consume the first-snapshot guard (#6799 review)', async () => {
  let calls = 0;
  const bodies = [[row('short', since), row('short', since)], [row('short', '2026-10-07T12:00:05Z')], [row('short', '2026-10-07T12:00:20Z')]];
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => '2026-10-07T12:00:30Z', sleep: async () => {},
    fetchFn: async () => ({ ok: true, json: async () => bodies[calls++] }) });
  assert.equal(result.state, 'verified');
  assert.equal(calls, 3, 'the unique boot-prime row after the invalid snapshot is not proof');
});

test('a never-readable heartbeat fails long cadence jobs after the short window instead of deferring them (#6799)', () => {
  const args = { slugs: ['long'], since, monitors };
  assert.equal(evaluateUnreadable({ ...args, now: '2026-10-07T12:10:00Z' }).state, 'waiting');
  assert.equal(evaluateUnreadable({ ...args, now: '2026-10-07T12:30:00Z' }).state, 'failed');
  assert.equal(evaluateUnreadable({ ...args, now: '2026-10-07T12:10:00Z', everRead: true }).state, 'deferred');
  assert.equal(evaluateUnreadable({ ...args, now: '2026-10-07T13:02:00Z', everRead: true }).state, 'failed');
  assert.equal(evaluateUnreadable({ slugs: ['unknown'], since, now: since, monitors }).state, 'failed');
  assert.equal(evaluateUnreadable({ ...args, since: 'invalid', now: since }).state, 'failed');
});

test('a boot cohort after the boundary moves the deadline to cohort time + cadence + margin (#6799)', () => {
  const boot = '2026-10-07T12:01:40Z';
  const excluded = new Set(), cohortAt = new Map();
  const args = { slugs: ['short'], since, monitors, excluded, cohortAt };
  const bootRows = [row('short', boot), row('long', boot)];
  // The base deadline is 12:02:00; without the shift this would already be red.
  assert.equal(evaluateCheckins({ ...args, rows: bootRows, now: '2026-10-07T12:01:50Z' }).state, 'waiting');
  const waiting = evaluateCheckins({ ...args, rows: bootRows, now: '2026-10-07T12:02:10Z' });
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.jobs[0].deadline, '2026-10-07T12:03:40.000Z');
  // A later tick overwrites the row; the remembered cohort keeps the deadline.
  assert.equal(evaluateCheckins({ ...args, rows: [row('short', '2026-10-07T12:02:30Z'), row('long', boot)], now: '2026-10-07T12:02:40Z' }).state, 'verified');
});

test('without a genuine tick after the cohort the shifted deadline still ends red (#6799)', async () => {
  const boot = '2026-10-07T12:01:40Z';
  let milliseconds = Date.parse('2026-10-07T12:01:50Z');
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => new Date(milliseconds).toISOString(), sleep: async ms => { milliseconds += ms; },
    fetchFn: async () => ({ ok: true, json: async () => [row('short', boot), row('long', boot)] }) });
  assert.equal(result.state, 'failed');
  assert.ok(milliseconds >= Date.parse(boot) + 120_000, 'waited for the cohort-based deadline');
  assert.equal(result.jobs[0].deadline, '2026-10-07T12:03:40.000Z');
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
  assert.equal(Object.keys(savedMap.sourcePathsBySlug).length, 56);
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
  const cadence = registryCadenceSeconds;
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
  assert.match(workflow, /while \[\[[\s\S]*?RAILWAY_OK=false\s+(?:#[^\r\n]*(?:\r?\n[ \t]*)+)+CRON_SINCE=""/);
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

test('waiting summary names jobs and latest deadline, and is empty otherwise (#6318)', () => {
  assert.equal(waitingSummary([]), '');
  assert.equal(waitingSummary([{ slug: 'a', state: 'verified', deadline: '2026-10-07T12:01:00.000Z' }]), '');
  assert.equal(waitingSummary([
    { slug: 'a', state: 'waiting', deadline: '2026-10-07T12:01:00.000Z' },
    { slug: 'b', state: 'waiting', deadline: '2026-10-07T12:45:00.000Z' },
    { slug: 'c', state: 'deferred', deadline: '2026-10-08T12:45:00.000Z' }]),
  'Waiting for check-in from a, b; latest deadline 2026-10-07T12:45:00.000Z');
});

test('polling logs the waiting summary once per change and never changes the verdict', async () => {
  let milliseconds = Date.parse(since);
  const logs = [];
  const result = await verifyCronCheckins({ slugs: ['short'], since, monitors, url: 'https://fixture.invalid', key: 'fixture',
    now: () => new Date(milliseconds).toISOString(), sleep: async ms => { milliseconds += ms; },
    fetchFn: async () => ({ ok: true, json: async () => [row('short', since)] }), log: line => logs.push(line) });
  assert.equal(result.state, 'failed');
  const summaries = logs.filter(line => line.startsWith('Waiting for check-in from short; latest deadline '));
  assert.equal(summaries.length, 1);
});

test('#6487: cron proof starts right after smoke and its step timeout covers the latest short-cadence deadline', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  const names = [...workflow.matchAll(/^ {6}- name: (.+?)\s*$/gm)].map(match => match[1]);
  // The first heartbeat snapshot is never proof, so the cron step must start
  // before the boundary (READY + drain). Only the bounded smoke (<= 55 s) and
  // the PR comment may sit between the deployment wait and the cron proof.
  const from = names.indexOf('Deployment still pending');
  const cron = names.indexOf('Verify affected cron check-ins');
  assert.deepEqual(names.slice(from + 1, cron), ['Smoke-test prod', 'Comment release verified, cron proof running']);
  assert.deepEqual(names.slice(cron + 1, cron + 3), ['Cron check-ins verified', 'Cron check-ins deferred']);
  const units = { minute: 60, hour: 3600, day: 86400 };
  const latest = Math.max(...ALL_CRON_MONITORS.map(([, config]) => config.schedule.value * units[config.schedule.unit])
    .map((cadence, index) => cadence <= SHORT_CADENCE_SECONDS ? cadence + (ALL_CRON_MONITORS[index][1].checkinMargin ?? 0) * 60 : 0));
  const drain = railwayDrainSeconds();
  assert.ok(drain > 55, 'smoke must fit inside the Railway drain window');
  const step = workflow.slice(workflow.indexOf('- name: Verify affected cron check-ins'), workflow.indexOf('- name: Cron check-ins verified'));
  const minutes = Number(step.match(/timeout-minutes: (\d+)/)[1]);
  const needed = (drain + latest + MAX_COHORT_SHIFT_SECONDS) / 60;
  assert.ok(minutes >= needed + 1 && minutes <= needed + 5, `cron step timeout ${minutes} min vs latest short deadline ${needed} min`);
  const comment = workflow.slice(workflow.indexOf('- name: Comment release verified'), workflow.indexOf('- name: Verify affected cron check-ins'));
  assert.match(comment, /continue-on-error: true/);
  assert.match(comment, /<!-- deploy-verify:\$SHA -->/);
});

test('#6799 (Codex #6823): a late boot cohort shifts the deadline at most MAX_COHORT_SHIFT_SECONDS', () => {
  const since = '2026-10-17T12:00:00.000Z';
  const late = new Date(Date.parse(since) + (MAX_COHORT_SHIFT_SECONDS + 3600) * 1000).toISOString();
  const rows = ['board-auto-accept', 'board-mid-season'].map(job_slug => ({ job_slug, last_checkin_at: late, expected_cadence_seconds: 1800 }));
  const result = evaluateCheckins({ slugs: ['board-auto-accept'], rows, since, now: late, excluded: new Set([Date.parse(late)]), cohortAt: new Map([['board-auto-accept', Date.parse(late)]]) });
  const deadline = Date.parse(result.jobs[0].deadline);
  assert.ok(deadline <= Date.parse(since) + (MAX_COHORT_SHIFT_SECONDS + 1800 + 15 * 60) * 1000, `deadline ${result.jobs[0].deadline}`);
});

test('#6858: fixed-time (crontab) monitors have a 1- or 7-day cadence and are deferred, never invalid', () => {
  const crontab = ALL_CRON_MONITORS.filter(([, config]) => config.schedule.type === 'crontab');
  assert.ok(crontab.length >= 5);
  for (const [slug, config] of crontab) {
    assert.ok([86400, 7 * 86400].includes(registryCadenceSeconds(config)), slug);
  }
  assert.equal(registryCadenceSeconds(ALL_CRON_MONITORS.find(([slug]) => slug === 'sunday-value-refresh')[1]), 7 * 86400);
  assert.ok(Number.isNaN(registryCadenceSeconds({ schedule: { type: 'crontab', value: '0 14 * * 0' } })), 'crontab without wallClock fails closed');
  assert.equal(registryCadenceSeconds({ schedule: { type: 'interval', value: 5, unit: 'minute' } }), 300);
});

test('#6860 (Codex P2): a weekly fixed-time job is due at its next Copenhagen slot across the DST change', async () => {
  const { dueAtMs } = await import('./cron-deploy-verification.mjs');
  const config = { schedule: { type: 'crontab', value: '0 14 * * 0' }, maxRuntime: 60, wallClock: { weekdays: ['sun'], hour: 14, minute: 0 } };
  const lastRun = Date.parse('2026-10-18T12:00:00Z'); // 14:00 CEST
  const due = dueAtMs(config, lastRun, 7 * 86400, 15 * 60);
  // 25/10 14:00 CET = 13:00Z, plus 15 min margin + 60 min maxRuntime. A nominal 168 h would say 12:15Z.
  assert.equal(new Date(due).toISOString(), '2026-10-25T14:15:00.000Z');
  const interval = { schedule: { type: 'interval', value: 5, unit: 'minute' } };
  assert.equal(dueAtMs(interval, 0, 300, 600), 900000);
});
