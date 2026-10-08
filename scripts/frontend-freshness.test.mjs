import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFrontendFreshness } from './frontend-freshness.mjs';
import * as freshness from './frontend-freshness.mjs';
import { productionBuildDecision, frontendDeploymentRequirement } from '../frontend/scripts/vercel-build-decision.ts';

const served = 'a'.repeat(40), target = 'b'.repeat(40), earlierBuild = 'c'.repeat(40);
const version = { release: served, frontend: '0123456789abcdef' };
function fixture(paths = 'frontend/src/App.jsx\0', candidates = [target]) {
  return args => {
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'rev-list') return candidates.join('\n');
    if (args[0] === 'diff') return args[4] === served ? paths : 'docs/later.md\0';
    throw new Error('Unexpected Git operation');
  };
}
const noBuild = async () => ({ complete: true, state: 'absent' });

test('current production release needs no history or deployment API', async () => {
  assert.equal((await assessFrontendFreshness({ ...version, release: target }, target,
    () => { throw new Error('Git must not be called'); }, () => { throw new Error('API must not be called'); })).state, 'current');
});

test('independent changes keep the served frontend intentionally unchanged', async () => {
  assert.equal((await assessFrontendFreshness(version, target, fixture('docs/change.md\0backend/routes/x.js\0'),
    () => { throw new Error('API must not be called'); })).state, 'intentionally-unchanged');
});

test('frontend, shared backend libraries, root scripts and unknown inputs require a fresh deployment', async () => {
  for (const path of ['frontend/public/x.js', 'backend/lib/x.ts', 'package-lock.json', 'scripts/tool.mjs', 'new-package/x.ts']) {
    assert.equal((await assessFrontendFreshness(version, target, fixture(path + '\0'), noBuild)).state, 'stale', path);
  }
});

test('a positively observed active build suppresses the stale alarm', async () => {
  assert.equal((await assessFrontendFreshness(version, target, fixture(), async () => ({ complete: true, state: 'building' }))).state, 'building');
});

test('an earlier intervening build can cover the target when later changes are independent', async () => {
  const observed = [];
  const result = await assessFrontendFreshness(version, target, fixture(undefined, [target, earlierBuild]), async sha => {
    observed.push(sha);
    return { complete: true, state: sha === earlierBuild ? 'building' : 'absent' };
  });
  assert.equal(result.state, 'building');
  assert.deepEqual(observed, [target, earlierBuild]);
});

test('a build missing later frontend inputs cannot cover the target', async () => {
  const git = fixture(undefined, [target, earlierBuild]);
  const result = await assessFrontendFreshness(version, target, args =>
    args[0] === 'diff' && args[4] === earlierBuild ? 'frontend/new.ts\0' : git(args),
  async sha => ({ complete: true, state: sha === earlierBuild ? 'building' : 'absent' }));
  assert.equal(result.state, 'stale');
});

test('invalid versions, newer/unrelated served history, API errors and incomplete evidence are unknown', async () => {
  for (const input of [null, {}, { release: 'invalid' }]) {
    assert.equal((await assessFrontendFreshness(input, target, fixture(), noBuild)).state, 'unknown');
  }
  assert.equal((await assessFrontendFreshness(version, target, () => { throw new Error('Not an ancestor'); }, noBuild)).state, 'unknown');
  for (const observe of [async () => { throw new Error('PRIVATE_API_DETAIL'); }, async () => ({ complete: false, state: 'absent' }), async () => ({ complete: true, state: 'unexpected' })]) {
    const result = await assessFrontendFreshness(version, target, fixture(), observe);
    assert.equal(result.state, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_API_DETAIL/);
  }
});

test('history bounds and missing target commit cannot establish no active build', async () => {
  for (const commits of [[], [earlierBuild], Array(65).fill(target)]) {
    assert.equal((await assessFrontendFreshness(version, target, fixture(undefined, commits), noBuild)).state, 'unknown');
  }
});

test('only the frontend production project is accepted as deployment evidence', async () => {
  const row = { id: 10, sha: target, environment: 'Production – cycling-zone', creator: { login: 'vercel[bot]' }, created_at: '2026-10-06T06:00:00Z' };
  for (const bad of [{ ...row, environment: 'Preview – cycling-zone' }, { ...row, environment: 'Production – cycling-zone-marketing' }, { ...row, sha: served }]) {
    const result = await freshness.readProductionBuildState(target, () => [bad]);
    assert.deepEqual(result, { complete: false, state: 'unknown' });
  }
  assert.deepEqual(await freshness.readProductionBuildState(target, path => path.includes('/statuses') ? [{ state: 'in_progress' }] : [row]), { complete: true, state: 'building' });
});

test('empty list proves absence but missing status or a truncated page is unknown', async () => {
  assert.deepEqual(await freshness.readProductionBuildState(target, () => []), { complete: true, state: 'absent' });
  const row = { id: 10, sha: target, environment: 'Production – cycling-zone', creator: { login: 'vercel[bot]' }, created_at: '2026-10-06T06:00:00Z' };
  for (const api of [path => path.includes('/statuses') ? [] : [row], () => Array(100).fill(row)]) {
    assert.deepEqual(await freshness.readProductionBuildState(target, api), { complete: false, state: 'unknown' });
  }
});

test('main moving during the probe invalidates an otherwise current observation', async () => {
  let reads = 0;
  const result = await freshness.probeFrontendFreshness({
    readMain: () => ++reads === 1 ? target : earlierBuild,
    readVersion: () => ({ release: target }), git: fixture(), observe: noBuild,
  });
  assert.equal(result.state, 'unknown');
});

test('deploy workflow uses the canonical adapter and no narrower frontend-only decision', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../.github/workflows/deploy-verify.yml', import.meta.url), 'utf8');
  assert.match(source, /node scripts\/frontend-deployment-needed\.mjs "\$SHA"/);
  assert.doesNotMatch(source, /grep -q '\^frontend\/'/);
  const adapter = readFileSync(new URL('./frontend-deployment-needed.mjs', import.meta.url), 'utf8');
  assert.match(adapter, /frontendDeploymentRequirement/);
  assert.match(adapter, /frontend\/scripts\/vercel-build-decision\.ts/);
});

test('production, release verification and freshness agree on all input classes', async () => {
  for (const path of ['docs/change.md', 'backend/routes/x.js', 'backend/lib/x.ts', 'frontend/public/x.js',
    'package-lock.json', 'scripts/tool.mjs', 'shared/x.ts', 'unknown/x.ts']) {
    const paths = path + '\0';
    const git = args => args[0] === 'rev-parse' ? target : args[0] === 'diff' ? paths : '';
    const production = productionBuildDecision(served, git).build;
    const verification = frontendDeploymentRequirement(target, git).required;
    const observation = (await assessFrontendFreshness(version, target, fixture(paths), noBuild)).state;
    assert.equal(verification, production, path);
    assert.equal(observation === 'stale', production, path);
  }
});
