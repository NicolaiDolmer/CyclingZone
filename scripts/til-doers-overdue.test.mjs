// node --test scripts/til-doers-overdue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, main, renderOverdueComment, reportedPairs, unreported, REPORT_ISSUE, OVERDUE_MARKER_PREFIX } from './til-doers-overdue.mjs';
import { MARKER, MARKER_LINE } from './lib/til-doers.mjs';

const NOW = '2026-11-06T12:00:00Z';
const BLOCK = '```til-doers-proof\nissue: 5\nprod: GET https://example.org/api/health -> 200\n```';

function fakeGh({ prs, issueState = 'open', issueComments = [], reportComments = [] }) {
  const calls = [];
  const exec = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs);
    if (args.includes('POST')) return '{}';
    const path = args.find((a) => a.startsWith('repos/'));
    const m = path.match(/issues\/(\d+)(?:\/comments)?/);
    if (path.includes('/comments')) {
      const list = Number(m[1]) === REPORT_ISSUE ? reportComments : issueComments;
      return list.map((c) => JSON.stringify(c)).join('\n');
    }
    return JSON.stringify({ number: Number(m[1]), state: issueState });
  };
  return { exec, calls };
}

const pr = (number, mergedAt, body = `Refs #5\n\n${BLOCK}`) => ({ number, title: 'feat: x', body, mergedAt, baseRefName: 'main' });
const posts = (f) => f.calls.filter((c) => c.args.includes('POST'));

test('parseArgs: dry-run default, poster til #7632, 24 timer', () => {
  const o = parseArgs([]);
  assert.equal(o.apply, false);
  assert.equal(o.hours, 24);
  assert.equal(o.postTo, REPORT_ISSUE);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.throws(() => parseArgs(['--hours', '-1']), /--hours/);
  assert.throws(() => parseArgs(['--bogus']), /ukendt/);
});

test('main: dry-run poster intet; --apply poster een kommentar uden markeringslinjer', () => {
  const base = { prs: [pr(1, '2026-11-04T00:00:00Z')] };
  let out = [];
  let f = fakeGh(base);
  assert.equal(main(['--now', NOW], { execGh: f.exec, log: (s) => out.push(s), errorLog: () => {} }), 0);
  assert.equal(posts(f).length, 0);
  assert.match(out.join('\n'), /PR #1 -> #5/);

  f = fakeGh(base);
  assert.equal(main(['--apply', '--now', NOW], { execGh: f.exec, log: () => {}, errorLog: () => {} }), 0);
  assert.equal(posts(f).length, 1);
  const body = JSON.parse(posts(f)[0].input).body;
  assert.ok(posts(f)[0].args.includes(`repos/NicolaiDolmer/CyclingZone/issues/${REPORT_ISSUE}/comments`));
  assert.match(body, /pr=1 issue=5/);
  assert.equal(body.includes(MARKER), false);
  assert.equal(body.split('\n').some((l) => MARKER_LINE.test(l)), false);
  assert.equal(/til\s+d(ø|oe|o)rs\s*:/i.test(body), false);
});

test('main: kommentaren postes kun een gang', () => {
  const first = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z')] });
  main(['--apply', '--now', NOW], { execGh: first.exec, log: () => {}, errorLog: () => {} });
  const posted = JSON.parse(posts(first)[0].input).body;

  const second = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z')], reportComments: [{ id: 1, user: { login: 'github-actions[bot]' }, author_association: 'CONTRIBUTOR', body: posted }] });
  const out = [];
  main(['--apply', '--now', NOW], { execGh: second.exec, log: (s) => out.push(s), errorLog: () => {} });
  assert.equal(posts(second).length, 0);
  assert.match(out.join('\n'), /allerede rapporteret/);

  // En ny PR efter en rapporteret: kun den nye kommer med.
  const third = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z'), pr(2, '2026-11-04T01:00:00Z')], reportComments: [{ id: 1, user: { login: 'github-actions[bot]' }, body: posted }] });
  main(['--apply', '--now', NOW], { execGh: third.exec, log: () => {}, errorLog: () => {} });
  const body = JSON.parse(posts(third)[0].input).body;
  assert.match(body, /pr=2 issue=5/);
  assert.doesNotMatch(body, /pr=1 issue=5/);
});

test('main: issue med bevis, lukket issue og ingen deklaration giver ingen kommentar', () => {
  const proof = [{ id: 9, author_association: 'OWNER', body: `<!-- til-doers-proof:v1 pr=1 issue=5 sha=abcdef1 -->\nx` }];
  let f = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z')], issueComments: proof });
  main(['--apply', '--now', NOW], { execGh: f.exec, log: () => {}, errorLog: () => {} });
  assert.equal(posts(f).length, 0);

  f = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z')], issueState: 'closed' });
  main(['--apply', '--now', NOW], { execGh: f.exec, log: () => {}, errorLog: () => {} });
  assert.equal(posts(f).length, 0);

  const out = [];
  f = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z', 'Refs #5')] });
  main(['--apply', '--now', NOW], { execGh: f.exec, log: (s) => out.push(s), errorLog: () => {} });
  assert.equal(posts(f).length, 0);
  assert.match(out.join('\n'), /1 uden deklaration \(ingen alarm\)/);
});

test('main: under 24 timer og uden for lookback giver ingen kommentar', () => {
  const f = fakeGh({ prs: [pr(1, '2026-11-05T12:00:01Z'), pr(2, '2026-10-01T00:00:00Z')] });
  main(['--apply', '--now', NOW], { execGh: f.exec, log: () => {}, errorLog: () => {} });
  assert.equal(posts(f).length, 0);
});

test('main: exit er altid 0, ogsaa ved GitHub-fejl og ugyldige argumenter', () => {
  const errs = [];
  const boom = () => {
    throw new Error('gh nede\nmere');
  };
  assert.equal(main(['--apply', '--now', NOW], { execGh: boom, log: () => {}, errorLog: (s) => errs.push(s) }), 0);
  assert.match(errs[0], /intet postet/);
  assert.equal(main(['--hours', 'x'], { errorLog: (s) => errs.push(s) }), 0);
});

test('main: et issue der ikke kan hentes tager ikke de andre paamindelser med', () => {
  const f = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z', 'Refs #6'), pr(2, '2026-11-04T00:00:00Z')] });
  const inner = f.exec;
  const exec = (args, input) => {
    if (args.some((a) => String(a).endsWith('issues/6'))) throw new Error('404 Not Found');
    return inner(args, input);
  };
  const errs = [];
  main(['--apply', '--now', NOW], { execGh: exec, log: () => {}, errorLog: (s) => errs.push(s) });
  assert.match(errs.join('\n'), /springer #6 over/);
  assert.match(JSON.parse(posts(f)[0].input).body, /pr=2 issue=5/);
});

test('reportedPairs ignorerer utroede kommentarer', () => {
  const body = `${OVERDUE_MARKER_PREFIX} pr=3 issue=4 -->`;
  assert.equal(reportedPairs([{ author_association: 'NONE', user: { login: 'x' }, body }]).size, 0);
  assert.deepEqual([...reportedPairs([{ author_association: 'OWNER', body }])], ['3:4']);
  assert.deepEqual(unreported([{ pr: 3, issue: 4 }, { pr: 5, issue: 4 }], [{ author_association: 'OWNER', body }]).map((r) => r.pr), [5]);
});

test('renderOverdueComment: ingen em-dash', () => {
  assert.equal(renderOverdueComment([{ pr: 1, issue: 2, ageHours: 30 }]).includes('—'), false);
});

test('main: kan kommentarerne ikke hentes, meldes issuet ikke som uden bevis', () => {
  const f = fakeGh({ prs: [pr(1, '2026-11-04T00:00:00Z')] });
  const inner = f.exec;
  const exec = (args, input) => {
    if (args.some((a) => String(a).includes('issues/5/comments'))) throw new Error('HTTP 502');
    return inner(args, input);
  };
  const errs = [];
  main(['--apply', '--now', NOW], { execGh: exec, log: () => {}, errorLog: (s) => errs.push(s) });
  assert.match(errs.join('\n'), /springer #5 over/);
  assert.equal(posts(f).length, 0);
});
