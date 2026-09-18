// scripts/report-orphan-worktree-dirs.test.mjs
// Tests for orphan-worktree-mappe-rapporten (#5391). Alle git/fs-kald
// mockes - ingen test rører det virkelige filsystem eller repo. Scriptet
// SLETTER ALDRIG noget - disse tests bekræfter bl.a. netop det (ingen
// exec-kald udover det ene read-only 'git worktree list').

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKTREE_ROOT,
  normalizePath,
  getRegisteredWorktreeNames,
  findOrphanDirs,
  formatOrphanReport,
  parseArgs,
  main,
} from './report-orphan-worktree-dirs.mjs';

const PORCELAIN = [
  'worktree C:/Dev/CyclingZone',
  'HEAD 5fab148345ce15d438c25f5e78119a564650c9b3',
  'branch refs/heads/main',
  '',
  'worktree C:/Dev/CyclingZone-worktrees/_dryrun-main',
  'HEAD 41a5593d905d1b6e2a1543757bd6650b8577cf7a',
  'detached',
  '',
  'worktree C:/Dev/CyclingZone-worktrees/chore-5391-branch-og-worktree-rutiner',
  'HEAD 3a2e02b6bd01b1dc5112ec1093f909909e95cbb5',
  'branch refs/heads/chore/5391-branch-og-worktree-rutiner',
  '',
].join('\n');

// ----------------------------------------------------------------- normalizePath

test('normalizePath: backslash -> forward slash, lowercased, ingen trailing slash', () => {
  assert.equal(normalizePath('C:\\Dev\\Foo\\'), 'c:/dev/foo');
  assert.equal(normalizePath('C:/Dev/Foo'), 'c:/dev/foo');
});

// --------------------------------------------------------- getRegisteredWorktreeNames

test('getRegisteredWorktreeNames: kun mapper direkte under worktreeRoot tælles med - hovedcheckoutet udelades', () => {
  const names = getRegisteredWorktreeNames(PORCELAIN, 'C:\\Dev\\CyclingZone-worktrees');
  assert.deepEqual([...names].sort(), ['_dryrun-main', 'chore-5391-branch-og-worktree-rutiner']);
});

test('getRegisteredWorktreeNames: forskellig case paa roden matcher stadig (Windows er case-insensitive)', () => {
  const names = getRegisteredWorktreeNames(PORCELAIN, 'c:\\dev\\cyclingzone-worktrees');
  assert.equal(names.has('_dryrun-main'), true);
});

test('getRegisteredWorktreeNames: tomt output giver tomt set, ikke en fejl', () => {
  const names = getRegisteredWorktreeNames('', 'C:\\Dev\\CyclingZone-worktrees');
  assert.equal(names.size, 0);
});

// ----------------------------------------------------------------- findOrphanDirs

test('findOrphanDirs: filtrerer registrerede + skjulte mapper fra, sorterer alfabetisk', () => {
  const registered = new Set(['_dryrun-main', 'chore-5391-branch-og-worktree-rutiner']);
  const childDirs = ['_dryrun-main', 'chore-5391-branch-og-worktree-rutiner', '.wave-scratch', 'zzz-old', 'aaa-older'];
  const orphans = findOrphanDirs(childDirs, registered);
  assert.deepEqual(orphans, ['aaa-older', 'zzz-old']);
});

test('findOrphanDirs: case-insensitiv sammenligning mod registered-settet', () => {
  const registered = new Set(['feat-x']);
  const orphans = findOrphanDirs(['FEAT-X', 'other'], registered);
  assert.deepEqual(orphans, ['other']);
});

test('findOrphanDirs: tom liste -> tom liste', () => {
  assert.deepEqual(findOrphanDirs([], new Set()), []);
});

// ------------------------------------------------------------------ formatOrphanReport

test('formatOrphanReport: tom liste giver "(ingen ...)"-linje', () => {
  const out = formatOrphanReport([], 'C:\\Dev\\CyclingZone-worktrees');
  assert.match(out, /ingen forældreløse mapper/);
});

test('formatOrphanReport: ikke-tom liste nævner antal, hver mappe, og henviser til #4924-audit', () => {
  const out = formatOrphanReport(['old-1', 'old-2'], 'C:\\Dev\\CyclingZone-worktrees');
  assert.match(out, /2 forældreløs/);
  assert.match(out, /old-1/);
  assert.match(out, /old-2/);
  assert.match(out, /2026-09-18-orphan-worktrees-uge38\.md/);
  assert.match(out, /RØRES IKKE/);
});

// --------------------------------------------------------------------- parseArgs

test('parseArgs: default worktree-root, override virker', () => {
  assert.equal(parseArgs([]).worktreeRoot, DEFAULT_WORKTREE_ROOT);
  assert.equal(parseArgs(['--worktree-root', 'X:\\foo']).worktreeRoot, 'X:\\foo');
});

// ------------------------------------------------------------------------- main

test('main: happy-path wiring, kalder KUN "git worktree list --porcelain" (read-only), aldrig delete/remove', () => {
  const gitCalls = [];
  const execGit = (args) => {
    gitCalls.push(args);
    return PORCELAIN;
  };
  const listChildDirs = (root) => {
    assert.equal(root, 'C:\\Dev\\CyclingZone-worktrees');
    return ['_dryrun-main', 'chore-5391-branch-og-worktree-rutiner', 'old-orphan', '.wave-scratch'];
  };
  const logged = [];
  const code = main(['--worktree-root', 'C:\\Dev\\CyclingZone-worktrees'], { execGit, listChildDirs, log: (s) => logged.push(s) });

  assert.equal(code, 0);
  assert.equal(gitCalls.length, 1);
  assert.deepEqual(gitCalls[0], ['worktree', 'list', '--porcelain']);
  assert.ok(logged[0].includes('old-orphan'));
  assert.ok(!logged[0].includes('.wave-scratch'));
});

test('main: git-kald fejler -> loggger warn og exit 1, kaster ikke', () => {
  const execGit = () => { throw new Error('git ikke fundet'); };
  const logged = [];
  const code = main([], { execGit, listChildDirs: () => [], log: (s) => logged.push(s) });
  assert.equal(code, 1);
  assert.match(logged[0], /\[warn\]/);
});

test('main: tom rod (fs-fejl haandteres af listChildDirs-injektionen) giver "(ingen ...)"-rapport', () => {
  const execGit = () => PORCELAIN;
  const logged = [];
  const code = main([], { execGit, listChildDirs: () => [], log: (s) => logged.push(s) });
  assert.equal(code, 0);
  assert.match(logged[0], /ingen forældreløse mapper/);
});
