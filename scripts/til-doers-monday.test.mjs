// node --test scripts/til-doers-monday.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, selectStale, renderReport, main, REPORT_ISSUE } from './til-doers-monday.mjs';

const NOW = new Date('2026-11-02T06:00:00Z');

test('parseArgs: dry-run default, poster til #7336', () => {
  const o = parseArgs([]);
  assert.equal(o.apply, false);
  assert.equal(o.days, 7);
  assert.equal(o.postTo, REPORT_ISSUE);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.throws(() => parseArgs(['--days', '-1']), /--days/);
  assert.throws(() => parseArgs(['--now', 'ikke-en-dato']), /--now/);
});

test('selectStale: kun ældre end 7 dage, ukendt dato tages med, ældste først', () => {
  const rows = [
    { number: 1, title: 'ny', doneAt: '2026-10-30T00:00:00Z', missing: [] },
    { number: 2, title: 'gammel', doneAt: '2026-10-20T00:00:00Z', missing: [{ krav: 8, navn: 'Verificeret i prod' }] },
    { number: 3, title: 'ældst', doneAt: '2026-09-01T00:00:00Z', missing: [] },
    { number: 4, title: 'ukendt', doneAt: null, missing: [] },
    { number: 5, title: 'grænse', doneAt: '2026-10-26T06:00:00Z', missing: [] },
  ];
  const stale = selectStale(rows, { now: NOW, days: 7 });
  assert.deepEqual(stale.map((r) => r.number), [4, 3, 2]);
  assert.equal(stale.find((r) => r.number === 2).ageDays, 13);
});

test('renderReport: tom rapport og liste uden em-dash', () => {
  assert.match(renderReport([], { now: NOW, days: 7 }), /Ingen åbne issues/);
  const r = renderReport(selectStale([{ number: 2, title: 'Noget', doneAt: '2026-10-20T00:00:00Z', missing: [{ krav: 5, navn: 'Gammelt væk' }, { krav: 8, navn: 'Verificeret i prod' }] }], { now: NOW, days: 7 }), { now: NOW, days: 7 });
  assert.match(r, /- #2 Noget \(13 dage\): mangler 5 Gammelt væk, 8 Verificeret i prod/);
  assert.match(r, /2\.11\.2026/);
  assert.equal(r.includes('—'), false);
});

function fakeGh(issues) {
  const calls = [];
  const exec = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(Object.keys(issues).map((n) => ({ number: Number(n) })));
    if (args.includes('POST')) return '{}';
    const path = args.find((a) => a.startsWith('repos/'));
    const m = path.match(/issues\/(\d+)(?:\/(comments|timeline))?/);
    const d = issues[m[1]];
    if (!m[2]) return JSON.stringify(d.issue);
    if (m[2] === 'comments') return '';
    return d.timeline.map((e) => JSON.stringify(e)).join('\n');
  };
  return { exec, calls };
}

const done = (at) => [{ event: 'labeled', label: { name: 'claude:done' }, created_at: at }];

test('main: dry-run printer rapport og poster intet; --apply poster på #7336', () => {
  const issues = {
    10: { issue: { number: 10, title: 'Gammel sag', state: 'open', labels: [] }, timeline: done('2026-10-10T00:00:00Z') },
    11: { issue: { number: 11, title: 'Ny sag', state: 'open', labels: [] }, timeline: done('2026-11-01T00:00:00Z') },
  };
  const base = { execGit: () => '', mainRef: 'main', registry: [], patchNotesText: '', errorLog: () => {} };

  let out = [];
  let f = fakeGh(issues);
  assert.equal(main(['--now', NOW.toISOString()], { ...base, execGh: f.exec, log: (s) => out.push(s) }), 0);
  const text = out.join('\n');
  assert.match(text, /#10 Gammel sag \(23 dage\)/);
  assert.doesNotMatch(text, /#11/);
  assert.equal(f.calls.filter((c) => c.args.includes('POST')).length, 0);

  out = [];
  f = fakeGh(issues);
  assert.equal(main(['--apply', '--now', NOW.toISOString()], { ...base, execGh: f.exec, log: (s) => out.push(s) }), 0);
  const posts = f.calls.filter((c) => c.args.includes('POST'));
  assert.equal(posts.length, 1);
  assert.ok(posts[0].args.includes(`repos/NicolaiDolmer/CyclingZone/issues/${REPORT_ISSUE}/comments`));
  assert.match(JSON.parse(posts[0].input).body, /mandagsrapport/);
});
