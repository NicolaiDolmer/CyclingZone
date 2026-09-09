import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureBase = join(root, '.codex.local');
const guard = join(root, 'scripts/check-staged-docs.mjs');
function fixture(fn) {
  mkdirSync(fixtureBase, { recursive: true });
  const cwd = mkdtempSync(join(fixtureBase, 'staged-docs-test-'));
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const put = (path, content) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), content); };
  try {
    assert.equal(git('init', '--quiet', '--initial-branch=main').status, 0);
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Hook fixture');
    fn({ cwd, git, put, check: () => spawnSync(process.execPath, [guard], { cwd, encoding: 'utf8' }) });
  } finally {
    assert.ok(cwd.startsWith(fixtureBase + '\\') || cwd.startsWith(fixtureBase + '/'));
    rmSync(cwd, { recursive: true, force: true });
  }
}
test('archive changes block an actual git commit before secret scan or lint', () => fixture(({cwd,git,put}) => {
  put('docs/archive/harmless-fixture.md', 'fixture\n');
  mkdirSync(join(cwd, 'scripts'), {recursive:true});
  copyFileSync(guard, join(cwd, 'scripts/check-staged-docs.mjs'));
  git('config', 'core.hooksPath', join(root, '.githooks'));
  git('add', '--', 'docs/archive/harmless-fixture.md');
  const result = git('commit', '-m', 'Fixture must be blocked');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /STAGED-DOCS BLOCKED: archive/);
  assert.notEqual(git('rev-parse', '--verify', 'HEAD').status, 0);
}));
test('NOW line overflow blocks, using staged content rather than working file', () => fixture(({git,put,check}) => {
  put('docs/NOW.md', 'line\n'.repeat(31)); git('add', '--', 'docs/NOW.md');
  put('docs/NOW.md', 'short working copy\n');
  const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /31 lines/);
}));
test('NOW token overflow blocks without a line overflow', () => fixture(({git,put,check}) => {
  put('docs/NOW.md', 'x'.repeat(4801)); git('add', '--', 'docs/NOW.md');
  const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /1201 approx tokens/);
}));
test('NOW boundary, CRLF normalization and unstaged archive change are allowed', () => fixture(({git,put,check}) => {
  put('docs/NOW.md', ('x'.repeat(159) + '\r\n').repeat(30)); git('add', '--', 'docs/NOW.md');
  put('docs/archive/unstaged.md', 'outside the commit\n');
  const result = check(); assert.equal(result.status, 0, result.stderr);
}));
test('rename away from archive is blocked', () => fixture(({git,put,check}) => {
  put('docs/archive/old.md', 'fixture\n'); git('add', '.');
  assert.equal(git('commit', '--quiet', '-m', 'Fixture baseline before hook installation').status, 0);
  assert.equal(git('mv', 'docs/archive/old.md', 'docs/moved.md').status, 0);
  const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /archive/);
}));
