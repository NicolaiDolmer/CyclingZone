// scripts/branch-inventory.test.mjs
// Tests for branch-opgørelsen (#5391). Alle git/gh-kald mockes - ingen test
// rammer det virkelige repo eller netværket.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween,
  sanitizeText,
  classifyBranchStatus,
  buildInventoryRow,
  splitSafeAndUnique,
  fetchRemoteBranches,
  deriveMainBranchName,
  fetchAllPrsByHead,
  formatReport,
  parseArgs,
  main,
  DEFAULT_REPO,
  DEFAULT_MAIN_REF,
} from './branch-inventory.mjs';

const NOW = new Date('2026-09-18T12:00:00Z');

// --------------------------------------------------------------- daysBetween

test('daysBetween: heltal-dage, aldrig negativ', () => {
  assert.equal(daysBetween('2026-09-01T12:00:00Z', NOW), 17);
  assert.equal(daysBetween(NOW.toISOString(), NOW), 0);
  assert.equal(daysBetween('2026-09-20T00:00:00Z', NOW), 0);
});

// --------------------------------------------------------------- sanitizeText

test('sanitizeText: pakker bart #N i backticks, escaper "|" og backslash foerst', () => {
  assert.equal(sanitizeText('fix #123: noget'), 'fix `#123`: noget');
  assert.equal(sanitizeText('a | b'), 'a \\| b');
  assert.equal(sanitizeText('sti C:\\Dev\\x | y'), 'sti C:\\\\Dev\\\\x \\| y');
});

// --------------------------------------------------------- classifyBranchStatus

test('classifyBranchStatus: aaben PR vinder over alt andet', () => {
  const prsByHead = new Map([['feat/x', [{ state: 'OPEN', number: 1, url: 'u', isDraft: false }]]]);
  const { status } = classifyBranchStatus({ name: 'feat/x', sha: 'abc' }, prsByHead, () => true);
  assert.equal(status, 'aaben PR');
});

test('classifyBranchStatus: merget PR uden ancestor, spidsen MATCHER headRefOid -> merget (squash-merge-tilfaeldet)', () => {
  const prsByHead = new Map([['feat/x', [{ state: 'MERGED', number: 1, url: 'u', isDraft: false, headRefOid: 'abc' }]]]);
  const { status, isAncestor } = classifyBranchStatus({ name: 'feat/x', sha: 'abc' }, prsByHead, () => false);
  assert.equal(status, 'merget');
  assert.equal(isAncestor, false);
});

test('classifyBranchStatus: merget PR-record men spidsen IKKE matcher headRefOid (genbrugt branch-navn med nyt arbejde) -> foraeldreloes, IKKE merget (CodeRabbit-review, #5391)', () => {
  // Branchen "feat/x" havde tidligere en merged PR (SHA "abc"), men er
  // siden fået nye commits (eller er genskabt) - den nuværende spids "def"
  // er ALDRIG blevet merget. Den historiske MERGED-record må ikke fejlagtigt
  // markere det nye, unikke arbejde som "sikkert at slette".
  const prsByHead = new Map([['feat/x', [{ state: 'MERGED', number: 1, url: 'u', isDraft: false, headRefOid: 'abc' }]]]);
  const { status, isAncestor } = classifyBranchStatus({ name: 'feat/x', sha: 'def' }, prsByHead, () => false);
  assert.equal(status, 'foraeldreloes');
  assert.equal(isAncestor, false);
});

test('classifyBranchStatus: merget PR uden headRefOid i data (aeldre gh-version/manglende felt) falder tilbage til ancestor-tjek, IKKE blind tillid til status=MERGED', () => {
  const prsByHead = new Map([['feat/x', [{ state: 'MERGED', number: 1, url: 'u', isDraft: false }]]]);
  const { status } = classifyBranchStatus({ name: 'feat/x', sha: 'abc' }, prsByHead, () => false);
  assert.equal(status, 'foraeldreloes'); // intet SHA-bevis + ikke ancestor -> IKKE antaget merget
});

test('classifyBranchStatus: ingen PR men ancestor af main -> merget (direkte push)', () => {
  const { status } = classifyBranchStatus({ name: 'chore/docs', sha: 'abc' }, new Map(), () => true);
  assert.equal(status, 'merget');
});

test('classifyBranchStatus: ingen PR og ikke ancestor -> foraeldreloes', () => {
  const { status } = classifyBranchStatus({ name: 'old/scratch', sha: 'abc' }, new Map(), () => false);
  assert.equal(status, 'foraeldreloes');
});

test('classifyBranchStatus: lukket (CLOSED, ikke merged) PR + ikke ancestor -> foraeldreloes (afvist arbejde)', () => {
  const prsByHead = new Map([['feat/rejected', [{ state: 'CLOSED', number: 2, url: 'u', isDraft: false }]]]);
  const { status } = classifyBranchStatus({ name: 'feat/rejected', sha: 'abc' }, prsByHead, () => false);
  assert.equal(status, 'foraeldreloes');
});

// --------------------------------------------------------- buildInventoryRow

test('buildInventoryRow: foraeldreloes-gren faar commitsAhead fra tael-funktionen', () => {
  const branch = { name: 'old/x', sha: 'deadbeef123', committerDate: '2026-09-01T00:00:00Z', subject: 'wip' };
  const row = buildInventoryRow(branch, new Map(), () => false, () => 3, NOW);
  assert.equal(row.status, 'foraeldreloes');
  assert.equal(row.commitsAhead, 3);
  assert.equal(row.ageDays, 17);
  assert.equal(row.sha, 'deadbeef1');
});

test('buildInventoryRow: ancestor-gren faar commitsAhead = 0 UDEN at kalde taeller-funktionen', () => {
  const branch = { name: 'chore/docs', sha: 'abc123', committerDate: '2026-09-10T00:00:00Z', subject: 'docs' };
  let counterCalled = false;
  const row = buildInventoryRow(branch, new Map(), () => true, () => { counterCalled = true; return 99; }, NOW);
  assert.equal(row.commitsAhead, 0);
  assert.equal(counterCalled, false);
});

// --------------------------------------------------------- splitSafeAndUnique

test('splitSafeAndUnique: merget + ancestor-foraeldreloes -> safe; aaben-PR + unik-foraeldreloes -> unique', () => {
  const rows = [
    { name: 'a', status: 'merget', isAncestor: false },
    { name: 'b', status: 'foraeldreloes', isAncestor: true },
    { name: 'c', status: 'aaben PR', isAncestor: false },
    { name: 'd', status: 'foraeldreloes', isAncestor: false },
  ];
  const { safe, unique } = splitSafeAndUnique(rows);
  assert.deepEqual(safe.map((r) => r.name), ['a', 'b']);
  assert.deepEqual(unique.map((r) => r.name), ['c', 'd']);
});

// --------------------------------------------------------- fetchRemoteBranches

test('fetchRemoteBranches: parser for-each-ref-output, dropper HEAD og main', () => {
  const execGit = (args) => {
    assert.deepEqual(args[0], 'for-each-ref');
    return [
      'origin/HEAD\tsha0\t2026-09-01T00:00:00+00:00\tinit',
      'origin/main\tsha1\t2026-09-15T00:00:00+00:00\tlatest',
      'origin/feat/x\tsha2\t2026-09-10T00:00:00+00:00\tfeat: noget med #42 i teksten',
      '',
    ].join('\n');
  };
  const branches = fetchRemoteBranches(execGit, '/repo');
  assert.equal(branches.length, 1);
  assert.equal(branches[0].name, 'feat/x');
  assert.equal(branches[0].sha, 'sha2');
  assert.equal(branches[0].subject, 'feat: noget med #42 i teksten');
});

test('fetchRemoteBranches: excludeBranch er KONFIGURERBAR - dropper "develop", ikke "main", naar det er den angivne default-branch (CodeRabbit-review, #5391)', () => {
  const execGit = () => [
    'origin/main\tsha1\t2026-09-15T00:00:00+00:00\tlatest',
    'origin/develop\tsha2\t2026-09-10T00:00:00+00:00\tdev-latest',
    '',
  ].join('\n');
  const branches = fetchRemoteBranches(execGit, '/repo', 'origin', 'develop');
  assert.deepEqual(branches.map((b) => b.name), ['main']);
});

// ------------------------------------------------------------ deriveMainBranchName

test('deriveMainBranchName: strip "origin/"-praefiks, falder tilbage til raa vaerdi uden praefiks', () => {
  assert.equal(deriveMainBranchName('origin/main'), 'main');
  assert.equal(deriveMainBranchName('origin/develop'), 'develop');
  assert.equal(deriveMainBranchName('main'), 'main');
  assert.equal(deriveMainBranchName('upstream/main', 'upstream'), 'main');
});

// --------------------------------------------------------- fetchAllPrsByHead

test('fetchAllPrsByHead: grupperer flere PR-er pr. headRefName, beder om headRefOid (SHA-matching, #5391)', () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    return JSON.stringify([
      { number: 1, headRefName: 'feat/x', state: 'CLOSED', url: 'u1', isDraft: false },
      { number: 2, headRefName: 'feat/x', state: 'OPEN', url: 'u2', isDraft: false },
      { number: 3, headRefName: 'feat/y', state: 'MERGED', url: 'u3', isDraft: false, headRefOid: 'abc123' },
    ]);
  };
  const byHead = fetchAllPrsByHead(execGh, DEFAULT_REPO);
  assert.equal(byHead.get('feat/x').length, 2);
  assert.equal(byHead.get('feat/y')[0].state, 'MERGED');
  assert.equal(byHead.get('feat/y')[0].headRefOid, 'abc123');
  assert.equal(byHead.has('feat/z'), false);
  const jsonArgIdx = calls[0].indexOf('--json');
  assert.ok(calls[0][jsonArgIdx + 1].includes('headRefOid'), '--json skal bede om headRefOid');
});

test('fetchAllPrsByHead: tom liste giver tomt map, ikke fejl', () => {
  const execGh = () => '[]';
  const byHead = fetchAllPrsByHead(execGh, DEFAULT_REPO);
  assert.equal(byHead.size, 0);
});

// --------------------------------------------------------------- formatReport

test('formatReport: viser begge lister + staleOrphans-sektionen', () => {
  const rows = [
    { name: 'safe/merged', sha: 'aaa111111', committerDate: '2026-09-01T00:00:00Z', subject: 'x', ageDays: 17, status: 'merget', openPr: null, mergedPr: { number: 1 }, isAncestor: false, commitsAhead: 0 },
    { name: 'unique/open', sha: 'bbb222222', committerDate: '2026-09-15T00:00:00Z', subject: 'y', ageDays: 3, status: 'aaben PR', openPr: { url: 'https://x/pr/9' }, mergedPr: null, isAncestor: false, commitsAhead: 0 },
    { name: 'unique/old-orphan', sha: 'ccc333333', committerDate: '2026-08-01T00:00:00Z', subject: 'z', ageDays: 48, status: 'foraeldreloes', openPr: null, mergedPr: null, isAncestor: false, commitsAhead: 5 },
  ];
  const { safe, unique } = splitSafeAndUnique(rows);
  const out = formatReport({ rows, safe, unique, repo: DEFAULT_REPO, mainRef: DEFAULT_MAIN_REF, now: NOW, staleDays: 14 });
  assert.match(out, /Kan slettes sikkert/);
  assert.match(out, /safe\/merged/);
  assert.match(out, /Har unikt arbejde/);
  assert.match(out, /unique\/open/);
  assert.match(out, /unique\/old-orphan/);
  assert.match(out, /Forældreløse 14\+ dage/);
});

test('formatReport: tomme lister giver "(ingen)", ikke en tom tabel', () => {
  const out = formatReport({ rows: [], safe: [], unique: [], repo: DEFAULT_REPO, mainRef: DEFAULT_MAIN_REF, now: NOW, staleDays: 14 });
  assert.match(out, /\(ingen\)/);
});

// --------------------------------------------------------------- parseArgs / main

test('parseArgs: defaults + overrides', () => {
  const a = parseArgs([]);
  assert.equal(a.repo, DEFAULT_REPO);
  assert.equal(a.mainRef, DEFAULT_MAIN_REF);
  assert.equal(a.staleDays, 14);

  const b = parseArgs(['--repo', 'x/y', '--main-ref', 'origin/foo', '--stale-days', '30']);
  assert.equal(b.repo, 'x/y');
  assert.equal(b.mainRef, 'origin/foo');
  assert.equal(b.staleDays, 30);
});

test('main: wire’er fetch+classify+format sammen med injicerede deps, exit 0', () => {
  const execGit = (args) => {
    if (args[0] === 'for-each-ref') {
      return 'origin/feat/x\tabc123\t2026-09-01T00:00:00+00:00\tsubject\n';
    }
    if (args[0] === 'merge-base') {
      throw new Error('not ancestor'); // simulerer exit != 0
    }
    if (args[0] === 'rev-list') {
      return '2\n';
    }
    throw new Error(`uventet git-kald: ${args.join(' ')}`);
  };
  const execGh = () => '[]';
  const logged = [];
  const exitCode = main(['--now', NOW.toISOString()], { execGit, execGh, log: (s) => logged.push(s) });
  assert.equal(exitCode, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /feat\/x/);
  assert.match(logged[0], /Har unikt arbejde/);
});

test('main: --main-ref "origin/develop" udelukker "develop", ikke "main" (CodeRabbit-review, #5391)', () => {
  const execGit = (args) => {
    if (args[0] === 'for-each-ref') {
      return [
        'origin/main\taaa1111111\t2026-09-01T00:00:00+00:00\tmain-subject',
        'origin/develop\tbbb2222222\t2026-09-01T00:00:00+00:00\tdev-subject',
        '',
      ].join('\n');
    }
    if (args[0] === 'merge-base') throw new Error('not ancestor');
    if (args[0] === 'rev-list') return '1\n';
    throw new Error(`uventet git-kald: ${args.join(' ')}`);
  };
  const execGh = () => '[]';
  const logged = [];
  main(['--main-ref', 'origin/develop', '--now', NOW.toISOString()], { execGit, execGh, log: (s) => logged.push(s) });
  assert.match(logged[0], /`main`/); // "main" er nu en almindelig branch i rapporten
  assert.doesNotMatch(logged[0], /`develop`/); // "develop" er ekskluderet som default-branchen
});
