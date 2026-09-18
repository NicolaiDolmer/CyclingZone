// scripts/stale-branches-report.test.mjs
// Tests for den ugentlige stale-branches-rutine (#5391). Alle git/gh-kald
// mockes - ingen test rammer det virkelige repo, netværket eller et rigtigt
// GitHub-issue.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER_LABEL,
  ISSUE_TITLE,
  computeStaleBranches,
  buildIssueBody,
  ensureMarkerLabel,
  findExistingIssueNumber,
  upsertIssue,
  parseArgs,
  main,
  DEFAULT_REPO,
} from './stale-branches-report.mjs';

const NOW = new Date('2026-09-18T12:00:00Z');

// --------------------------------------------------------- computeStaleBranches

test('computeStaleBranches: filtrerer aaben-PR og for-unge branches fra, sorterer aeldst foerst', () => {
  const branches = [
    { name: 'old/orphan', sha: 'aaa1111111', committerDate: '2026-08-01T00:00:00Z', subject: 'gammel' }, // 48 dage
    { name: 'young/orphan', sha: 'bbb2222222', committerDate: '2026-09-15T00:00:00Z', subject: 'ny' }, // 3 dage
    { name: 'has/pr', sha: 'ccc3333333', committerDate: '2026-08-01T00:00:00Z', subject: 'har pr' },
    { name: 'exactly/14', sha: 'ddd4444444', committerDate: '2026-09-04T00:00:00Z', subject: 'graense' }, // 14 dage
  ];
  const prsByHead = new Map([['has/pr', [{ state: 'OPEN' }]]]);
  const rows = computeStaleBranches(branches, prsByHead, () => false, () => 2, NOW, 14);

  assert.deepEqual(rows.map((r) => r.name), ['old/orphan', 'exactly/14']);
  assert.equal(rows[0].ageDays, 48);
  assert.equal(rows[0].commitsAhead, 2);
});

test('computeStaleBranches: ancestor-gren tael-funktion kaldes IKKE, commitsAhead = 0', () => {
  const branches = [{ name: 'merged/but-still-here', sha: 'e'.repeat(10), committerDate: '2026-08-01T00:00:00Z', subject: 'x' }];
  let counterCalled = false;
  const rows = computeStaleBranches(branches, new Map(), () => true, () => { counterCalled = true; return 5; }, NOW, 14);
  // status bliver 'merget' (ancestor=true uden PR) - IKKE 'foraeldreloes' - saa den filtreres helt fra.
  assert.equal(rows.length, 0);
  assert.equal(counterCalled, false);
});

// ------------------------------------------------------------- buildIssueBody

test('buildIssueBody: tom liste giver groent flueben, ingen tabel', () => {
  const body = buildIssueBody([], NOW, 14, DEFAULT_REPO);
  assert.match(body, /✅ Ingen forældreløse branches/);
  assert.doesNotMatch(body, /\| Branch \|/);
});

test('buildIssueBody: ikke-tom liste bygger tabel med alle raekker + sanitizer titler', () => {
  const rows = [
    { name: 'old/x', sha: 'abc123456', subject: 'fix #42: noget', ageDays: 30, commitsAhead: 2 },
  ];
  const body = buildIssueBody(rows, NOW, 14, DEFAULT_REPO);
  assert.match(body, /1 branch\(es\)/);
  assert.match(body, /old\/x/);
  assert.match(body, /`#42`/); // bart #N pakket i backticks
  assert.match(body, /Ejeren afgør pr\. branch/);
});

// --------------------------------------------------------------- issue-upsert

test('ensureMarkerLabel: kalder gh label create med --repo + --force (idempotent)', () => {
  const calls = [];
  const execGh = (args) => { calls.push(args); return ''; };
  ensureMarkerLabel(execGh, DEFAULT_REPO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'label');
  assert.equal(calls[0][1], 'create');
  assert.equal(calls[0][2], MARKER_LABEL);
  assert.ok(calls[0].includes('--force'));
  const repoIdx = calls[0].indexOf('--repo');
  assert.ok(repoIdx !== -1, 'forventede --repo blandt argumenterne');
  assert.equal(calls[0][repoIdx + 1], DEFAULT_REPO);
});

test('findExistingIssueNumber: returnerer nummeret paa foerste fund, null hvis tom', () => {
  const execGhFound = () => JSON.stringify([{ number: 777 }]);
  assert.equal(findExistingIssueNumber(execGhFound, DEFAULT_REPO), 777);

  const execGhEmpty = () => '[]';
  assert.equal(findExistingIssueNumber(execGhEmpty, DEFAULT_REPO), null);
});

test('upsertIssue: eksisterende issue -> edit, ikke create', () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 42 }]);
    return '';
  };
  const { number, created } = upsertIssue(execGh, DEFAULT_REPO, 'body-text');
  assert.equal(number, 42);
  assert.equal(created, false);
  const editCall = calls.find((c) => c[0] === 'issue' && c[1] === 'edit');
  assert.ok(editCall, 'forventede et "issue edit"-kald');
  assert.equal(editCall[2], '42');
  assert.ok(editCall.includes(ISSUE_TITLE));
  const createCall = calls.find((c) => c[0] === 'issue' && c[1] === 'create');
  assert.equal(createCall, undefined, 'skal IKKE oprette et nyt issue naar et allerede findes');
});

test('upsertIssue: intet eksisterende issue -> create, parser issue-nummer fra URL i stdout', () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/NicolaiDolmer/CyclingZone/issues/999\n';
    return '';
  };
  const { number, created } = upsertIssue(execGh, DEFAULT_REPO, 'body-text');
  assert.equal(number, 999);
  assert.equal(created, true);
});

// --------------------------------------------------------------- parseArgs / main

test('parseArgs: --dry-run flag + defaults', () => {
  const a = parseArgs([]);
  assert.equal(a.dryRun, false);
  assert.equal(a.days, 14);
  const b = parseArgs(['--dry-run', '--days', '21']);
  assert.equal(b.dryRun, true);
  assert.equal(b.days, 21);
});

test('main --dry-run: rører IKKE gh issue (ingen create/edit-kald), printer body i stedet', () => {
  const execGit = (args) => {
    if (args[0] === 'for-each-ref') return 'origin/old/x\tabc123456\t2026-08-01T00:00:00+00:00\tsubject\n';
    if (args[0] === 'merge-base') throw new Error('ikke ancestor');
    if (args[0] === 'rev-list') return '3\n';
    throw new Error(`uventet git-kald: ${args.join(' ')}`);
  };
  const ghCalls = [];
  const execGh = (args) => {
    ghCalls.push(args);
    return '[]'; // pr list
  };
  const logged = [];
  const code = main(['--dry-run', '--now', NOW.toISOString()], { execGit, execGh, log: (s) => logged.push(s) });
  assert.equal(code, 0);
  // Kun PR-list-kaldet (fetchAllPrsByHead) - ALDRIG issue/label-kald i dry-run.
  assert.ok(ghCalls.every((c) => c[0] === 'pr'), `uventede gh-kald i dry-run: ${JSON.stringify(ghCalls)}`);
  assert.ok(logged.some((l) => l.includes('[dry-run]')));
});

test('main uden --dry-run: opretter/opdaterer issuet for reelt via injiceret execGh', () => {
  const execGit = (args) => {
    if (args[0] === 'for-each-ref') return 'origin/old/x\tabc123456\t2026-08-01T00:00:00+00:00\tsubject\n';
    if (args[0] === 'merge-base') throw new Error('ikke ancestor');
    if (args[0] === 'rev-list') return '3\n';
    throw new Error(`uventet git-kald: ${args.join(' ')}`);
  };
  const ghCalls = [];
  const execGh = (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/NicolaiDolmer/CyclingZone/issues/123\n';
    return '';
  };
  const logged = [];
  const code = main(['--now', NOW.toISOString()], { execGit, execGh, log: (s) => logged.push(s) });
  assert.equal(code, 0);
  assert.ok(ghCalls.some((c) => c[0] === 'label' && c[1] === 'create'));
  assert.ok(ghCalls.some((c) => c[0] === 'issue' && c[1] === 'create'));
  assert.match(logged[0], /Oprettede issue #123/);
});
