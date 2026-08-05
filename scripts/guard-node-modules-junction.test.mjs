import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  DEFAULT_PACKAGE_DIRS,
  findJunctionedNodeModules,
  formatBlockMessage,
} from './guard-node-modules-junction.mjs';

const ROOT = path.join('C:', 'wt');

/** Byg en fake lstat/readlink ud fra en map af sti -> 'dir' | 'junction'. */
function fakeFs(entries) {
  const norm = (p) => path.resolve(p).toLowerCase();
  const table = new Map(Object.entries(entries).map(([k, v]) => [norm(k), v]));
  const lstat = (p) => {
    const kind = table.get(norm(p));
    if (!kind) {
      const err = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return { isSymbolicLink: () => kind === 'junction' };
  };
  const readlink = (p) => {
    const kind = table.get(norm(p));
    if (kind !== 'junction') throw new Error('EINVAL');
    return path.join('C:', 'Dev', 'CyclingZone', 'shared', 'node_modules');
  };
  return { lstat, readlink };
}

test('finder ingen hits naar node_modules er rigtige mapper', () => {
  const { lstat, readlink } = fakeFs({
    [path.join(ROOT, 'node_modules')]: 'dir',
    [path.join(ROOT, 'backend', 'node_modules')]: 'dir',
    [path.join(ROOT, 'frontend', 'node_modules')]: 'dir',
  });
  const hits = findJunctionedNodeModules(ROOT, DEFAULT_PACKAGE_DIRS, lstat, readlink);
  assert.deepEqual(hits, []);
});

test('finder ingen hits naar node_modules slet ikke findes', () => {
  const { lstat, readlink } = fakeFs({});
  const hits = findJunctionedNodeModules(ROOT, DEFAULT_PACKAGE_DIRS, lstat, readlink);
  assert.deepEqual(hits, []);
});

test('flagger en junction og laeser maalet', () => {
  const { lstat, readlink } = fakeFs({
    [path.join(ROOT, 'frontend', 'node_modules')]: 'junction',
    [path.join(ROOT, 'backend', 'node_modules')]: 'dir',
  });
  const hits = findJunctionedNodeModules(ROOT, DEFAULT_PACKAGE_DIRS, lstat, readlink);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].dir, 'frontend');
  assert.match(hits[0].target, /node_modules$/);
});

test('flagger flere junctions paa en gang', () => {
  const { lstat, readlink } = fakeFs({
    [path.join(ROOT, 'frontend', 'node_modules')]: 'junction',
    [path.join(ROOT, 'backend', 'node_modules')]: 'junction',
  });
  const hits = findJunctionedNodeModules(ROOT, DEFAULT_PACKAGE_DIRS, lstat, readlink);
  assert.deepEqual(
    hits.map((h) => h.dir),
    ['backend', 'frontend'],
  );
});

test('respekterer eksplicit mappe-liste', () => {
  const { lstat, readlink } = fakeFs({
    [path.join(ROOT, 'frontend', 'node_modules')]: 'junction',
    [path.join(ROOT, 'backend', 'node_modules')]: 'junction',
  });
  const hits = findJunctionedNodeModules(ROOT, ['frontend'], lstat, readlink);
  assert.deepEqual(
    hits.map((h) => h.dir),
    ['frontend'],
  );
});

test('fejlbeskeden indeholder den korrekte opskrift, ikke bare et afslag', () => {
  const msg = formatBlockMessage([
    { dir: 'frontend', nodeModules: 'x', target: 'C:\\cache\\node_modules' },
  ]);
  // Acceptkriterium i #3367: beskeden skal pege paa den rigtige fremgangsmaade.
  assert.match(msg, /rmdir \/Q frontend\\node_modules && npm ci --prefix frontend/);
  assert.match(msg, /setup-worktree\.ps1 -Rebuild/);
  assert.match(msg, /ALDRIG\s+Remove-Item -Recurse/);
  assert.match(msg, /#3367/);
});

test('rod-pakken faar en kommando uden --prefix', () => {
  const msg = formatBlockMessage([{ dir: '.', nodeModules: 'x', target: null }]);
  assert.match(msg, /rmdir \/Q node_modules && npm ci\n/);
  assert.doesNotMatch(msg, /--prefix \./);
});
