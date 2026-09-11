// scripts/priority-hygiene.test.mjs
// Tests for priority-hygiejne-vagten (#5155).
//
// Alle gh-kald mockes via en injiceret execGh(args) -> stdout - ingen af disse
// tests rammer det virkelige gh CLI eller netværket. To spor er dedikeret
// pointe-tests fra scope'et: "epic-undtagelsen" og "aktivitet via PR"
// (en issue der IKKE har kommenteret selv, men har en linket PR med nyt liv).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAYS,
  isEpicLabels,
  daysBetween,
  computeLastActivity,
  buildDowngradeComment,
  classifyIssues,
  formatReport,
  parseArgs,
  main,
} from './priority-hygiene.mjs';

const NOW = new Date('2026-09-11T12:00:00Z');
const REPO = 'NicolaiDolmer/CyclingZone';

// --------------------------------------------------------------- isEpicLabels

test('isEpicLabels: genkender "epic" og "epic:*", afviser andre labels', () => {
  assert.equal(isEpicLabels(['epic']), true);
  assert.equal(isEpicLabels(['epic:progression', 'priority:high']), true);
  assert.equal(isEpicLabels(['priority:high', 'type:feature']), false);
  assert.equal(isEpicLabels([]), false);
});

// --------------------------------------------------------------- daysBetween

test('daysBetween: heltal-dage, aldrig negativ', () => {
  assert.equal(daysBetween('2026-09-01T12:00:00Z', NOW), 10);
  assert.equal(daysBetween(NOW.toISOString(), NOW), 0);
  assert.equal(daysBetween('2026-09-12T00:00:00Z', NOW), 0); // "fremtid" -> clamp til 0
});

// --------------------------------------------------------- computeLastActivity

test('computeLastActivity: falder tilbage til issue.updatedAt uden timeline-events', () => {
  const issue = { updatedAt: '2026-08-01T00:00:00Z' };
  const { lastActivity, reason } = computeLastActivity(issue, []);
  assert.equal(lastActivity, new Date('2026-08-01T00:00:00Z').toISOString());
  assert.equal(reason, 'issue-updated');
});

test('computeLastActivity: kommentar-event nyere end issue.updatedAt vinder', () => {
  const issue = { updatedAt: '2026-08-01T00:00:00Z' };
  const events = [{ event: 'commented', created_at: '2026-08-20T00:00:00Z' }];
  const { lastActivity, reason } = computeLastActivity(issue, events);
  assert.equal(lastActivity, new Date('2026-08-20T00:00:00Z').toISOString());
  assert.equal(reason, 'comment');
});

test('computeLastActivity: "aktivitet via PR" - cross-referenced PR med nyere live updated_at vinder', () => {
  const issue = { updatedAt: '2026-07-01T00:00:00Z' };
  const events = [
    {
      event: 'cross-referenced',
      created_at: '2026-07-05T00:00:00Z', // selve cross-ref-eventet er gammelt
      source: {
        issue: {
          number: 9001,
          pull_request: {},
          updated_at: '2026-09-10T00:00:00Z', // men PR'en er blevet pushet for nylig
        },
      },
    },
  ];
  const { lastActivity, reason } = computeLastActivity(issue, events);
  assert.equal(lastActivity, new Date('2026-09-10T00:00:00Z').toISOString());
  assert.equal(reason, 'linked-pr');
});

test('computeLastActivity: cross-referenced til en almindelig issue (ikke en PR) tæller ikke', () => {
  const issue = { updatedAt: '2026-07-01T00:00:00Z' };
  const events = [
    {
      event: 'cross-referenced',
      created_at: '2026-09-10T00:00:00Z',
      source: { issue: { number: 9002, updated_at: '2026-09-10T00:00:00Z' } }, // ingen pull_request
    },
  ];
  const { lastActivity } = computeLastActivity(issue, events);
  assert.equal(lastActivity, new Date('2026-07-01T00:00:00Z').toISOString());
});

// ------------------------------------------------------------ buildDowngradeComment

test('buildDowngradeComment: refererer regel + #5155 + priority:med', () => {
  const comment = buildDowngradeComment(40, 14);
  assert.match(comment, /priority:med/);
  assert.match(comment, /#5155/);
  assert.match(comment, /40 dage/);
});

// ------------------------------------------------------------------ parseArgs

test('parseArgs: --dry-run er default (execute=false)', () => {
  const opts = parseArgs([]);
  assert.equal(opts.execute, false);
  assert.equal(opts.days, DEFAULT_DAYS);
});

test('parseArgs: --execute saetter execute=true, --days overstyrer graensen', () => {
  const opts = parseArgs(['--execute', '--days', '21']);
  assert.equal(opts.execute, true);
  assert.equal(opts.days, 21);
});

test('parseArgs: ugyldig --days kaster', () => {
  assert.throws(() => parseArgs(['--days', 'abe']));
});

// ------------------------------------------------------------------ classifyIssues

function mockExecGhFactory(responses) {
  // responses: array af { match: (args) => bool, result: string }
  return (args) => {
    const hit = responses.find((r) => r.match(args));
    if (!hit) throw new Error(`uventet gh-kald: ${JSON.stringify(args)}`);
    return hit.result;
  };
}

test('classifyIssues: gammel issue uden nogen timeline-aktivitet er en kandidat', () => {
  const issues = [
    { number: 100, title: 'Gammel sag', labels: [{ name: 'priority:high' }], updatedAt: '2026-06-01T00:00:00Z', url: 'x' },
  ];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api' && a.includes('repos/NicolaiDolmer/CyclingZone/issues/100/timeline'), result: '[]' },
  ]);
  const { candidates, kept } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].number, 100);
  assert.equal(kept.length, 0);
});

test('classifyIssues: issue inden for graensen beholdes', () => {
  const issues = [
    { number: 101, title: 'Frisk sag', labels: [{ name: 'priority:high' }], updatedAt: '2026-09-05T00:00:00Z', url: 'x' },
  ];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api', result: '[]' },
  ]);
  const { candidates, kept } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(candidates.length, 0);
  assert.equal(kept.length, 1);
});

test('classifyIssues: "aktivitet via PR" redder en ellers stille issue fra nedjustering', () => {
  const issues = [
    { number: 102, title: 'Stille issue, aktiv PR', labels: [{ name: 'priority:high' }], updatedAt: '2026-06-01T00:00:00Z', url: 'x' },
  ];
  const timeline = [
    {
      event: 'cross-referenced',
      created_at: '2026-06-05T00:00:00Z',
      source: { issue: { number: 500, pull_request: {}, updated_at: '2026-09-09T00:00:00Z' } },
    },
  ];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api', result: JSON.stringify(timeline) },
  ]);
  const { candidates, kept } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(candidates.length, 0);
  assert.equal(kept.length, 1);
});

test('classifyIssues: epic-undtagelse - epic med aktivt aabent child-issue rapporteres OK, aldrig som kandidat', () => {
  const issues = [
    { number: 931, title: '[Epic] Traeningssystem', labels: [{ name: 'priority:high' }, { name: 'epic:progression' }], updatedAt: '2026-06-26T00:00:00Z', url: 'x' },
  ];
  const subIssues = [{ number: 4850, state: 'open', updatedAt: '2026-09-08T00:00:00Z' }];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api' && a.some((x) => typeof x === 'string' && x.includes('sub_issues')), result: JSON.stringify(subIssues) },
  ]);
  const { candidates, epicsFlagged, epicsOk } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(candidates.length, 0); // epics nedjusteres ALDRIG
  assert.equal(epicsFlagged.length, 0);
  assert.equal(epicsOk.length, 1);
  assert.equal(epicsOk[0].number, 931);
});

test('classifyIssues: epic-undtagelse - epic UDEN aktivt child (sub_issues tom, text-search tom) flages, men nedjusteres ikke', () => {
  const issues = [
    { number: 954, title: '[Epic] Transparens-hub', labels: [{ name: 'epic:quality-hardening' }, { name: 'priority:high' }], updatedAt: '2026-06-29T00:00:00Z', url: 'x' },
  ];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api' && a.some((x) => typeof x === 'string' && x.includes('sub_issues')), result: '[]' },
    { match: (a) => a[0] === 'search', result: '[]' },
  ]);
  const { candidates, epicsFlagged, epicsOk } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(candidates.length, 0);
  assert.equal(epicsOk.length, 0);
  assert.equal(epicsFlagged.length, 1);
  assert.equal(epicsFlagged[0].number, 954);
});

test('classifyIssues: epic-fallback - sub_issues tom, men text-search finder aabent, nyligt opdateret issue', () => {
  const issues = [
    { number: 3131, title: '[Epic] Financial Fair Play', labels: [{ name: 'epic:fair-play' }, { name: 'priority:high' }], updatedAt: '2026-08-06T00:00:00Z', url: 'x' },
  ];
  const execGh = mockExecGhFactory([
    { match: (a) => a[0] === 'api' && a.some((x) => typeof x === 'string' && x.includes('sub_issues')), result: '[]' },
    {
      match: (a) => a[0] === 'search',
      result: JSON.stringify([{ number: 3818, title: 'sub-issue til #3131', updatedAt: '2026-09-08T00:00:00Z' }]),
    },
  ]);
  const { epicsOk, epicsFlagged } = classifyIssues({ issues, execGh, repo: REPO, days: 14, now: NOW });
  assert.equal(epicsOk.length, 1);
  assert.equal(epicsFlagged.length, 0);
});

// -------------------------------------------------------------------- formatReport

test('formatReport: viser kandidat-tabel og epic-tabel, dry-run vs execute i overskriften', () => {
  const candidates = [{ number: 100, title: 'X', daysInactive: 40, reason: 'issue-updated' }];
  const epicsFlagged = [{ number: 954, title: 'Y', source: 'sub_issues' }];
  const dryRun = formatReport({ candidates, epicsFlagged, days: 14, now: NOW, executed: false });
  assert.match(dryRun, /DRY-RUN/);
  assert.match(dryRun, /#100/);
  assert.match(dryRun, /#954/);

  const executed = formatReport({ candidates, epicsFlagged, days: 14, now: NOW, executed: true });
  assert.match(executed, /EXECUTE/);
});

test('formatReport: ingen kandidater og ingen flagede epics giver tydelig "alt godt"-besked', () => {
  const report = formatReport({ candidates: [], epicsFlagged: [], days: 14, now: NOW, executed: false });
  assert.match(report, /Ingen `priority:high`/);
  assert.match(report, /Ingen epics uden aktivt child-issue/);
});

// -------------------------------------------------------------------------- main

test('main: dry-run (default) kalder ALDRIG issue edit/comment, selv med en kandidat', () => {
  const issues = [
    { number: 200, title: 'Kandidat', labels: [{ name: 'priority:high' }], updatedAt: '2026-01-01T00:00:00Z', url: 'x' },
  ];
  let editOrCommentCalled = false;
  const execGh = (args) => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues);
    if (args[0] === 'issue' && args[1] === 'edit') editOrCommentCalled = true;
    if (args[0] === 'issue' && args[1] === 'comment') editOrCommentCalled = true;
    if (args[0] === 'api') return '[]';
    return '[]';
  };
  const logs = [];
  const code = main(['--now', NOW.toISOString()], { execGh, log: (s) => logs.push(s), errorLog: () => {} });
  assert.equal(code, 0);
  assert.equal(editOrCommentCalled, false);
  assert.match(logs.join('\n'), /DRY-RUN/);
});

test('main: --execute kalder issue edit + comment for hver kandidat, ikke for epics', () => {
  const issues = [
    { number: 201, title: 'Kandidat', labels: [{ name: 'priority:high' }], updatedAt: '2026-01-01T00:00:00Z', url: 'x' },
    { number: 202, title: '[Epic] uden child', labels: [{ name: 'priority:high' }, { name: 'epic' }], updatedAt: '2026-01-01T00:00:00Z', url: 'x' },
  ];
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues);
    if (args[0] === 'api' && args[1].includes('sub_issues')) return '[]';
    if (args[0] === 'search') return '[]';
    if (args[0] === 'api') return '[]';
    return '[]';
  };
  const code = main(['--execute', '--now', NOW.toISOString()], { execGh, log: () => {}, errorLog: () => {} });
  assert.equal(code, 0);
  const editCalls = calls.filter((a) => a[0] === 'issue' && a[1] === 'edit');
  const commentCalls = calls.filter((a) => a[0] === 'issue' && a[1] === 'comment');
  assert.equal(editCalls.length, 1);
  assert.equal(editCalls[0][2], '201');
  assert.equal(commentCalls.length, 1);
  assert.equal(commentCalls[0][2], '201');
});

test('main: gh-fejl under --execute for én issue rapporteres og giver exit-kode 1, uden at stoppe resten', () => {
  const issues = [
    { number: 300, title: 'Fejler', labels: [{ name: 'priority:high' }], updatedAt: '2026-01-01T00:00:00Z', url: 'x' },
    { number: 301, title: 'Virker', labels: [{ name: 'priority:high' }], updatedAt: '2026-01-01T00:00:00Z', url: 'x' },
  ];
  const commented = [];
  const execGh = (args) => {
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues);
    if (args[0] === 'api') return '[]';
    if (args[0] === 'issue' && args[1] === 'edit' && args[2] === '300') throw new Error('rate-limited');
    if (args[0] === 'issue' && args[1] === 'comment') commented.push(args[2]);
    return '';
  };
  const errors = [];
  const code = main(['--execute', '--now', NOW.toISOString()], { execGh, log: () => {}, errorLog: (s) => errors.push(s) });
  assert.equal(code, 1);
  assert.equal(commented.includes('301'), true);
  assert.match(errors.join('\n'), /#300/);
});
