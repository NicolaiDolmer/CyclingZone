import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasMigrationChanges, migrationVerdict, verifyMigrationOrder, waitForMigration } from './registry-migration-order.mjs';
import { evaluateFlags } from './check-feature-registry-flags.mjs';

const workflow = readFileSync(new URL('../.github/workflows/feature-registry-check.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('main waits for its migration before the strict flag check', () => {
  const gate = workflow.indexOf('run: node scripts/registry-migration-order.mjs');
  const strict = workflow.indexOf('run: node scripts/check-feature-registry-flags.mjs\n');
  assert.ok(gate >= 0, 'missing migration-order gate on main');
  assert.ok(strict > gate, 'strict verification must follow the migration gate');
});

const sha = 'a'.repeat(40);
const run = (overrides = {}) => ({ id: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', ...overrides });

test('migration paths mirror the top-level auto-migrate filter', () => {
  assert.equal(hasMigrationChanges(['database/2026-11-02-seed.sql']), true);
  for (const path of ['docs/FEATURE_REGISTRY.yml', 'database/proposals/2026-seed.sql', 'database/2025-seed.sql']) {
    assert.equal(hasMigrationChanges([path]), false);
  }
  // Both triggers must run for seed-only pushes and changes to the gate/tests.
  assert.equal(workflow.match(/'database\/2026-\*\.sql'/g).length, 2);
  assert.equal(workflow.match(/'scripts\/registry-migration-order\*'/g).length, 2);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /if: github.event_name == 'push'\n        env:\n          GH_TOKEN:/);
  assert.match(workflow, /run: node scripts\/check-feature-registry-flags.mjs --base-ref origin\/main/);
});

test('only exact SHA main push success releases the gate', () => {
  assert.equal(migrationVerdict([], sha), 'pending');
  for (const other of [{ head_sha: 'b'.repeat(40) }, { event: 'workflow_dispatch' }, { head_branch: 'other' }]) {
    assert.equal(migrationVerdict([run(other)], sha), 'pending');
  }
  assert.equal(migrationVerdict([run({ status: 'queued' })], sha), 'pending');
  assert.equal(migrationVerdict([run({ status: 'in_progress' })], sha), 'pending');
  assert.equal(migrationVerdict([run()], sha), 'success');
  for (const conclusion of ['failure', 'skipped', 'timed_out', null]) {
    assert.throws(() => migrationVerdict([run({ conclusion })], sha), /did not succeed/);
  }
  // Cancelled waits for a successor (see the next test) and times out without one.
  assert.equal(migrationVerdict([run({ conclusion: 'cancelled' })], sha), 'pending');
  assert.equal(migrationVerdict([run(), run({ id: 2, status: 'queued' })], sha), 'pending');
});

test('a cancelled run is released only by a later main push run that contains the SHA', () => {
  const later = 'c'.repeat(40);
  const unrelated = 'd'.repeat(40);
  const contains = (ancestor, descendant) => ancestor === sha && descendant === later;
  const cancelled = run({ id: 5, conclusion: 'cancelled' });
  // No successor yet, or only an unrelated/older/non-push run: keep waiting.
  assert.equal(migrationVerdict([cancelled], sha, contains), 'pending');
  assert.equal(migrationVerdict([cancelled, run({ id: 6, head_sha: unrelated })], sha, contains), 'pending');
  assert.equal(migrationVerdict([cancelled, run({ id: 4, head_sha: later })], sha, contains), 'pending');
  assert.equal(migrationVerdict([cancelled, run({ id: 6, head_sha: later, event: 'workflow_dispatch' })], sha, contains), 'pending');
  assert.equal(migrationVerdict([cancelled, run({ id: 6, head_sha: later, status: 'in_progress' })], sha, contains), 'pending');
  // Successor decides: success releases, failure stops.
  assert.equal(migrationVerdict([cancelled, run({ id: 6, head_sha: later })], sha, contains), 'success');
  assert.throws(() => migrationVerdict([cancelled, run({ id: 6, head_sha: later, conclusion: 'failure' })], sha, contains), /did not succeed/);
  // Without ancestry evidence a cancelled run never releases the gate.
  assert.equal(migrationVerdict([cancelled, run({ id: 6, head_sha: later })], sha), 'pending');
});

test('pending migration completes before strict flags are read', async () => {
  let calls = 0;
  let sleeps = 0;
  const flags = new Map();
  await waitForMigration({ sha, attempts: 3,
    listRuns: async () => {
      calls += 1;
      if (calls === 1) return [];
      if (calls === 2) return [run({ status: 'in_progress' })];
      flags.set('fixture_flag', 'off');
      return [run()];
    },
    sleep: async () => { sleeps += 1; },
  });
  assert.equal(sleeps, 2);
  assert.equal(evaluateFlags([{ id: 'fixture', flag: 'fixture_flag', state: 'building' }], flags)[0].level, 'OK');
});

test('migration failure, missing run, and API failure fail closed', async () => {
  for (const listRuns of [async () => [run({ conclusion: 'failure' })], async () => [], async () => { throw new Error('API failure'); }]) {
    await assert.rejects(waitForMigration({ sha, listRuns, sleep: async () => {}, attempts: 2 }));
  }
});

test('main push without migrations needs no workflow run or API access', async () => {
  await verifyMigrationOrder(['docs/FEATURE_REGISTRY.yml'], {
    sha,
    listRuns: async () => { assert.fail('non-migration push must not wait for a nonexistent run'); },
    sleep: async () => { assert.fail('non-migration push must not sleep'); },
  });
  await assert.rejects(verifyMigrationOrder(['database/2026-seed.sql'], {
    sha, listRuns: async () => [run({ conclusion: 'failure' })], sleep: async () => {},
  }), /did not succeed/);
});

test('successful migration never exempts an actually missing seed', async () => {
  await waitForMigration({ sha, listRuns: async () => [run()], sleep: async () => {} });
  const [result] = evaluateFlags([{ id: 'fixture', flag: 'missing_seed', state: 'building' }], new Map());
  assert.equal(result.level, 'FAIL');
});
