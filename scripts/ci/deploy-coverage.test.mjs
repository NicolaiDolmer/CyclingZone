import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCoverageCheck, findCoveringDeployment, MAIN_REF, REPO, VERCEL_ENVIRONMENT } from './deploy-coverage.mjs';
import { classifyDeploymentStatus, getRailwayDeployStatus } from '../railway-deploy-status.mjs';

// #6859 (owner 18/10). Fixture modelled on the measurement: main went
// before -> target (#6770, never built by Vercel) -> newer (contains target).
const sha = c => c.repeat(40);
const BEFORE = sha('1'), TARGET = sha('a'), NEWER = sha('b'), BRANCH = sha('c'), LATER = sha('d');

// A fake git over a commit graph. `local` = commits present in the checkout;
// fetch adds `remote`. Unknown/missing objects make git exit non-zero (throw).
function fakeGit({ parents, local, remote = [], main, remoteMain = main }) {
  const state = { have: new Set(local), main, fetches: 0 };
  const ancestors = c => { const seen = new Set(); const stack = [c]; while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); stack.push(...(parents[x] ?? [])); } return seen; };
  const resolve = ref => (ref === MAIN_REF ? state.main : ref);
  const git = args => {
    if (args[0] === 'cat-file') { if (!state.have.has(args[2].replace('^{commit}', ''))) throw new Error('missing'); return ''; }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      const [a, b] = [resolve(args[2]), resolve(args[3])];
      if (!state.have.has(a) || !state.have.has(b)) throw Object.assign(new Error('missing'), { status: 128 });
      if (!ancestors(b).has(a)) throw Object.assign(new Error('not ancestor'), { status: 1 });
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const refresh = () => { state.fetches++; remote.forEach(c => state.have.add(c)); state.main = remoteMain; };
  return { git, refresh, state };
}
const graph = { [TARGET]: [BEFORE], [NEWER]: [TARGET], [LATER]: [NEWER], [BRANCH]: [BEFORE] };

test('a newer main SHA containing the target covers it; the target itself, older, side-branch and bad SHAs do not', () => {
  const { git } = fakeGit({ parents: graph, local: [BEFORE, TARGET, NEWER, BRANCH], main: NEWER });
  const covers = createCoverageCheck(TARGET, git);
  assert.equal(covers(NEWER), true);
  assert.equal(covers(TARGET), false, 'same SHA is never "coverage"');
  assert.equal(covers(BEFORE), false, 'an older deploy does not contain the target');
  assert.equal(covers(BRANCH), false, 'not a descendant of the target');
  assert.equal(covers('b'.repeat(7)), false);
  assert.equal(covers(undefined), false);
  assert.equal(createCoverageCheck('nope', git)(NEWER), false);
});

test('a candidate pushed after the checkout is fetched once, then judged', () => {
  const { git, refresh, state } = fakeGit({ parents: graph, local: [BEFORE, TARGET], remote: [NEWER, LATER], main: TARGET, remoteMain: LATER });
  const covers = createCoverageCheck(TARGET, git, refresh);
  assert.equal(covers(NEWER), true);
  assert.equal(covers(LATER), true);
  assert.equal(state.fetches, 1, 'at most one fetch per check');
});

test('a candidate that is not on main (stale or unknown after the fetch) is not coverage; a failed fetch is not coverage', () => {
  const missing = fakeGit({ parents: graph, local: [BEFORE, TARGET], main: TARGET });
  assert.equal(createCoverageCheck(TARGET, missing.git, missing.refresh)(NEWER), false);
  // NEWER exists locally (some other ref) but main never reaches it.
  const offMain = fakeGit({ parents: graph, local: [BEFORE, TARGET, NEWER], main: TARGET });
  assert.equal(createCoverageCheck(TARGET, offMain.git, offMain.refresh)(NEWER), false);
  const broken = fakeGit({ parents: graph, local: [BEFORE, TARGET], main: TARGET });
  assert.equal(createCoverageCheck(TARGET, broken.git, () => { throw new Error('offline'); })(NEWER), false);
});

// GitHub deployments API fixture.
const row = (id, rowSha, created, extra = {}) => ({ id, sha: rowSha, environment: VERCEL_ENVIRONMENT, creator: { login: 'vercel[bot]' }, created_at: created, ...extra });
function fakeApi(rows, states) {
  const calls = [];
  const api = async path => {
    calls.push(path);
    if (path.startsWith(`repos/${REPO}/deployments?`)) return rows;
    const id = Number(path.match(/deployments\/(\d+)\/statuses/)?.[1]);
    return states[id] === undefined ? [] : [{ state: states[id] }];
  };
  return { api, calls };
}
const coversOnly = (...shas) => candidate => shas.includes(candidate);

test('#6770 fixture: no Vercel deploy of the target, READY deploy of the newer containing SHA -> covered', async () => {
  const { api, calls } = fakeApi([row(2, NEWER, '2026-10-18T13:18:00Z'), row(1, BEFORE, '2026-10-18T12:08:00Z')], { 2: 'success', 1: 'inactive' });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api, covers: coversOnly(NEWER) }), { covered: true, sha: NEWER, id: 2 });
  assert.match(calls[0], new RegExp(`environment=${encodeURIComponent(VERCEL_ENVIRONMENT)}`));
  assert.ok(!calls.some(path => path.includes('/deployments/1/')), 'non-covering deploys are never read');
});

test('a covering deploy that is still building, failed, or from another project/creator is not evidence', async () => {
  for (const state of ['in_progress', 'pending', 'queued', 'failure', 'error', 'inactive', undefined]) {
    const { api } = fakeApi([row(2, NEWER, '2026-10-18T13:18:00Z')], { 2: state });
    assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api, covers: coversOnly(NEWER) }), { covered: false }, String(state));
  }
  const foreign = [row(3, NEWER, '2026-10-18T13:18:00Z', { environment: 'Production – cycling-zone-marketing' }),
    row(4, NEWER, '2026-10-18T13:19:00Z', { creator: { login: 'someone' } }), row(5, NEWER, 'not a date'), row(-1, NEWER, '2026-10-18T13:20:00Z')];
  const { api } = fakeApi(foreign, { 3: 'success', 4: 'success', 5: 'success', [-1]: 'success' });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api, covers: coversOnly(NEWER) }), { covered: false });
});

test('the newest covering READY deploy wins; an older READY one still covers when the newest is building', async () => {
  const rows = [row(3, LATER, '2026-10-18T13:40:00Z'), row(2, NEWER, '2026-10-18T13:18:00Z')];
  const building = fakeApi(rows, { 3: 'in_progress', 2: 'success' });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api: building.api, covers: coversOnly(NEWER, LATER) }), { covered: true, sha: NEWER, id: 2 });
  const ready = fakeApi(rows, { 3: 'success', 2: 'inactive' });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api: ready.api, covers: coversOnly(NEWER, LATER) }), { covered: true, sha: LATER, id: 3 });
});

test('unusable API evidence, unknown platform and a missing check are never coverage', async () => {
  const throwing = async () => { throw new Error('rate limited'); };
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api: throwing, covers: coversOnly(NEWER) }), { covered: false });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api: async () => ({ message: 'x' }), covers: coversOnly(NEWER) }), { covered: false });
  assert.deepEqual(await findCoveringDeployment({ platform: 'netlify', target: TARGET, api: throwing, covers: coversOnly(NEWER) }), { covered: false });
  assert.deepEqual(await findCoveringDeployment({ platform: 'vercel', target: TARGET, api: throwing }), { covered: false });
});

test('Railway GitHub fallback (no token) accepts railway deployments of a covering SHA', async () => {
  const rows = [{ ...row(9, NEWER, '2026-10-18T13:18:00Z'), creator: { login: 'railway-app[bot]' }, environment: 'production' }, row(8, NEWER, '2026-10-18T13:17:00Z')];
  const { api, calls } = fakeApi(rows, { 9: 'success', 8: 'success' });
  assert.deepEqual(await findCoveringDeployment({ platform: 'railway', target: TARGET, api, covers: coversOnly(NEWER) }), { covered: true, sha: NEWER, id: 9 });
  assert.match(calls[0], /deployments\?per_page=100$/);
});

// Railway API (primary source with RAILWAY_TOKEN).
const node = (status, hash) => ({ status, meta: { commitHash: hash } });

test('Railway API: SUCCESS of a newer covering SHA verifies a target that was skipped or superseded', () => {
  const covers = coversOnly(NEWER);
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER)], TARGET, { covers }), 'success', 'target never built');
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER), node('REMOVED', TARGET)], TARGET, { covers }), 'success', 'superseded');
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER), node('SKIPPED', TARGET)], TARGET, { covers }), 'success');
});

test('Railway API: a failed build of the target itself stays failed; non-covering or unready newer deploys change nothing', () => {
  const covers = coversOnly(NEWER);
  for (const status of ['FAILED', 'CRASHED']) {
    assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER), node(status, TARGET)], TARGET, { covers }), 'failed', status);
  }
  assert.equal(classifyDeploymentStatus([node('SUCCESS', BRANCH)], TARGET, { covers }), 'pending');
  assert.equal(classifyDeploymentStatus([node('BUILDING', NEWER)], TARGET, { covers }), 'pending');
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER), node('REMOVED', TARGET)], TARGET), 'failed', 'without a check: unchanged');
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER)], TARGET), 'pending', 'without a check: unchanged');
  assert.equal(classifyDeploymentStatus([node('SUCCESS', NEWER)], TARGET, { covers: () => { throw new Error('git'); } }), 'pending');
});

test('Railway API orchestration passes the coverage check through', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: { deployments: { edges: [{ node: node('SUCCESS', NEWER) }] } } }) });
  const base = { sha: TARGET, token: 'fixture', serviceId: 's', environmentId: 'e', fetchImpl };
  assert.equal(await getRailwayDeployStatus({ ...base, covers: coversOnly(NEWER) }), 'success');
  assert.equal(await getRailwayDeployStatus(base), 'pending');
});

test('deploy-verify wires the coverage check into the deployment wait for both targets', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  const freshness = readFileSync(new URL('../frontend-freshness.mjs', import.meta.url), 'utf8');
  assert.equal(freshness.match(/const ENVIRONMENT = '([^']+)'/)[1], VERCEL_ENVIRONMENT);
  const wait = workflow.slice(workflow.indexOf('- name: Wait for Vercel + Railway deployments'), workflow.indexOf('- name: Deployment still pending'));
  assert.match(wait, /node scripts\/ci\/deploy-coverage\.mjs vercel "\$SHA"/);
  assert.match(wait, /-z "\$\{RAILWAY_TOKEN:-\}" && "\$RAILWAY_OK" == "false"[\s\S]*?node scripts\/ci\/deploy-coverage\.mjs railway "\$SHA"/);
  // Coverage is decided before the cron boundary and the satisfied check.
  assert.ok(wait.indexOf('deploy-coverage.mjs railway') < wait.indexOf('if $RAILWAY_OK && [[ -z "$CRON_SINCE" ]]'));
  // The own-SHA failure exit still comes first.
  assert.ok(wait.indexOf('Latest Vercel deployment failed') < wait.indexOf('deploy-coverage.mjs vercel'));
  assert.match(wait, /echo "vercel_sha=\$VERCEL_SHA" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /SHA: \$\{\{ needs\.release\.outputs\.vercel_sha \|\| needs\.release\.outputs\.sha \}\}/);
});
