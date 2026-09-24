// scripts/check-triage-age.test.mjs
// Tests for triage:new-alders-guarden (#5329).
//
// Alle gh-kald mockes via en injiceret execGh(args) -> stdout - ingen af
// disse tests rammer det virkelige gh CLI eller netværket.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRIAGE_AGE_DAYS,
  DEFAULT_TRIAGE_LABEL,
  daysBetween,
  sanitizeTitle,
  classifyTriageAge,
  formatTriageAgeSection,
} from './lib/triage-age.mjs';
import { DEFAULT_REPO, fetchOpenTriageIssues, parseArgs, main } from './check-triage-age.mjs';

const NOW = new Date('2026-09-21T12:00:00Z'); // en mandag

// --------------------------------------------------------------- daysBetween

test('daysBetween: heltal-dage, aldrig negativ', () => {
  assert.equal(daysBetween('2026-09-11T12:00:00Z', NOW), 10);
  assert.equal(daysBetween(NOW.toISOString(), NOW), 0);
  assert.equal(daysBetween('2026-09-22T00:00:00Z', NOW), 0); // "fremtid" -> clamp til 0
});

// ------------------------------------------------------------ sanitizeTitle

test('sanitizeTitle: pakker bare #N i backticks, escaper "|" og linjeskift', () => {
  assert.equal(sanitizeTitle('Post-merge #3798: backfill'), 'Post-merge `#3798`: backfill');
  assert.equal(sanitizeTitle('a | b'), 'a \\| b');
  assert.equal(sanitizeTitle('linje1\nlinje2'), 'linje1 linje2');
});

// --------------------------------------------------------- classifyTriageAge

test('classifyTriageAge: default-graense 7 dage, >= graense er overdue', () => {
  const issues = [
    { number: 1, title: 'A', createdAt: '2026-09-13T12:00:00Z' }, // 8 dage - overdue
    { number: 2, title: 'B', createdAt: '2026-09-14T12:00:00Z' }, // 7 dage - overdue (>=)
    { number: 3, title: 'C', createdAt: '2026-09-15T12:00:00Z' }, // 6 dage - inden for
    { number: 4, title: 'D', createdAt: '2026-09-20T12:00:00Z' }, // 1 dag - inden for
  ];
  const { overdue, withinLimit } = classifyTriageAge(issues, DEFAULT_TRIAGE_AGE_DAYS, NOW);
  assert.deepEqual(overdue.map((i) => i.number), [1, 2]); // sorteret aeldst foerst
  assert.equal(overdue[0].daysOpen, 8);
  assert.equal(overdue[1].daysOpen, 7);
  assert.deepEqual(withinLimit.map((i) => i.number), [3, 4]);
});

test('classifyTriageAge: tom liste giver tomme grupper', () => {
  const { overdue, withinLimit } = classifyTriageAge([], DEFAULT_TRIAGE_AGE_DAYS, NOW);
  assert.deepEqual(overdue, []);
  assert.deepEqual(withinLimit, []);
});

test('classifyTriageAge: --days aendrer graensen', () => {
  const issues = [{ number: 1, title: 'A', createdAt: '2026-09-13T12:00:00Z' }]; // 8 dage
  assert.equal(classifyTriageAge(issues, 7, NOW).overdue.length, 1);
  assert.equal(classifyTriageAge(issues, 10, NOW).overdue.length, 0);
});

// ------------------------------------------------------- formatTriageAgeSection

test('formatTriageAgeSection: ingen fund giver groent flueben, ingen tabel', () => {
  const out = formatTriageAgeSection({ overdue: [], withinLimit: [3], days: 7 });
  assert.match(out, /✅/);
  assert.doesNotMatch(out, /\|---\|/);
});

test('formatTriageAgeSection: fund giver tabel med escaped titel', () => {
  const overdue = [{ number: 42, title: 'Fejl med | pipe', daysOpen: 9 }];
  const out = formatTriageAgeSection({ overdue, withinLimit: [], days: 7 });
  assert.match(out, /`#42`/);
  assert.match(out, /Fejl med \\\| pipe/);
  assert.match(out, /\| 9 \|/);
});

// --------------------------------------------------------------- fetchOpenTriageIssues

test('fetchOpenTriageIssues: kalder gh med korrekt label + repo, parser JSON', () => {
  let calledWith;
  const execGh = (args) => {
    calledWith = args;
    return JSON.stringify([{ number: 1, title: 'x', createdAt: NOW.toISOString(), url: 'u' }]);
  };
  const result = fetchOpenTriageIssues(execGh, 'owner/repo', 'triage:new');
  assert.deepEqual(calledWith, [
    'issue', 'list',
    '--repo', 'owner/repo',
    '--state', 'open',
    '--label', 'triage:new',
    '--json', 'number,title,createdAt,url',
    '--limit', '500',
  ]);
  assert.equal(result.length, 1);
});

test('fetchOpenTriageIssues: tomt gh-svar -> tom liste', () => {
  const execGh = () => '';
  assert.deepEqual(fetchOpenTriageIssues(execGh, 'owner/repo'), []);
});

// --------------------------------------------------------------------- parseArgs

test('parseArgs: defaults matcher DEFAULT_TRIAGE_AGE_DAYS/DEFAULT_TRIAGE_LABEL/DEFAULT_REPO', () => {
  const args = parseArgs([]);
  assert.equal(args.days, DEFAULT_TRIAGE_AGE_DAYS);
  assert.equal(args.label, DEFAULT_TRIAGE_LABEL);
  assert.equal(args.repo, DEFAULT_REPO);
});

test('parseArgs: --days/--repo/--label/--now overstyrer', () => {
  const args = parseArgs(['--days', '14', '--repo', 'a/b', '--label', 'foo', '--now', '2026-01-01']);
  assert.equal(args.days, 14);
  assert.equal(args.repo, 'a/b');
  assert.equal(args.label, 'foo');
  assert.equal(args.now.toISOString(), new Date('2026-01-01').toISOString());
});

test('parseArgs: ugyldig --days kaster', () => {
  assert.throws(() => parseArgs(['--days', 'nope']));
  assert.throws(() => parseArgs(['--days', '-1']));
});

test('parseArgs: manglende --repo-vaerdi kaster', () => {
  assert.throws(() => parseArgs(['--repo']));
});

test('parseArgs: ugyldig --now kaster', () => {
  assert.throws(() => parseArgs(['--now', 'ikke-en-dato']));
});

// -------------------------------------------------------------------------- main

test('main: exit 0 naar intet er overdue', () => {
  const execGh = () => JSON.stringify([{ number: 1, title: 'A', createdAt: '2026-09-20T00:00:00Z', url: 'u' }]);
  const logs = [];
  const code = main(['--now', NOW.toISOString()], { execGh, log: (l) => logs.push(l), errorLog: () => {} });
  assert.equal(code, 0);
  assert.match(logs.join('\n'), /✅/);
});

test('main: exit 1 naar mindst ét fund er overdue', () => {
  const execGh = () => JSON.stringify([{ number: 1, title: 'A', createdAt: '2026-09-01T00:00:00Z', url: 'u' }]);
  const logs = [];
  const code = main(['--now', NOW.toISOString()], { execGh, log: (l) => logs.push(l), errorLog: () => {} });
  assert.equal(code, 1);
  assert.match(logs.join('\n'), /`#1`/);
});

test('main: exit 2 ved ugyldige argumenter (rammer aldrig gh)', () => {
  let called = false;
  const execGh = () => {
    called = true;
    return '[]';
  };
  const errors = [];
  const code = main(['--days', 'nope'], { execGh, log: () => {}, errorLog: (e) => errors.push(e) });
  assert.equal(code, 2);
  assert.equal(called, false);
  assert.equal(errors.length, 1);
});

test('main: exit 2 naar gh-kaldet selv fejler', () => {
  const execGh = () => {
    throw new Error('gh: authentication required');
  };
  const errors = [];
  const code = main(['--now', NOW.toISOString()], { execGh, log: () => {}, errorLog: (e) => errors.push(e) });
  assert.equal(code, 2);
  assert.match(errors[0], /authentication required/);
});
