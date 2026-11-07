// node --test scripts/til-doers-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER,
  CLOSE_COMMENT,
  evaluateDoor,
  decideClose,
  parseMarkers,
  refsIssue,
  titleScopeIssue,
  extractRefIssues,
  patchNoteVersionsFor,
  registryEntriesFor,
  prsFromTimeline,
  labeledAt,
  renderComment,
  missingKrav,
  mainCommitsFor,
  DUP_BODY,
} from './lib/til-doers.mjs';
import { parseArgs, main, processIssue, targetsFromPr } from './til-doers-check.mjs';
import { titleScopeIssues, mergedIntoMain, lastMarkerAt, isInternalChange, queueVerified, latestMerged, directCommits, fetchIssueBundle } from './lib/til-doers.mjs';

const N = 4242;
const owner = (body, created_at = '2026-10-31T10:00:00Z', extra = {}) => ({ id: Math.floor(Math.random() * 1e9), body, created_at, author_association: 'OWNER', user: { login: 'ejer' }, ...extra });
const status = (door, k) => door.find((d) => d.krav === k).status;

const PATCH_NOTES = `export const PATCHES = [
  { "version": "7.391", "changes": [ { "refs": [ 1, 2 ] } ] },
  { "version": "7.390", "changes": [ { "refs": [
        ${N}
      ] }, { "refs": [9] } ] },
];`;

// ---------------------------------------------------------------- referencer

test('refsIssue kræver nøgleord og præcist nummer', () => {
  assert.equal(refsIssue(`Refs #${N}`, N), true);
  assert.equal(refsIssue(`closes: #${N}`, N), true);
  assert.equal(refsIssue(`Refs #1, #${N}`, N), true);
  assert.equal(refsIssue(`Fixes #${N}0`, N), false);
  assert.equal(refsIssue(`se #${N} for baggrund`, N), false);
});

test('titleScopeIssue genkender conventional-commit-scope', () => {
  assert.equal(titleScopeIssue(`fix(${N}): noget`, N), true);
  assert.equal(titleScopeIssue(`feat(ui,${N})!: noget`, N), true);
  assert.equal(titleScopeIssue(`fix(1${N}): noget`, N), false);
  assert.equal(titleScopeIssue(`fix(${N}0): noget`, N), false);
});

test('extractRefIssues samler alle refererede issues', () => {
  assert.deepEqual(extractRefIssues('Refs #10, #12\nCloses #7 og #8\nse #99'), [7, 8, 10, 12]);
});

test('patchNoteVersionsFor finder version for refs over flere linjer', () => {
  assert.deepEqual(patchNoteVersionsFor(PATCH_NOTES, N), ['7.390']);
  assert.deepEqual(patchNoteVersionsFor(PATCH_NOTES, 2), ['7.391']);
  assert.deepEqual(patchNoteVersionsFor(PATCH_NOTES, 3), []);
});

test('registryEntriesFor matcher epic eller #N i note, ikke længere numre', () => {
  const reg = [
    { id: 'a', epic: String(N), state: 'live' },
    { id: 'b', note: `rettet i #${N}`, state: 'dormant' },
    { id: 'c', note: `#${N}1`, state: 'live' },
  ];
  assert.deepEqual(registryEntriesFor(reg, N).map((e) => e.id), ['a', 'b']);
});

test('prsFromTimeline tager kun PR-referencer med nøgleord eller scope', () => {
  const tl = [
    { event: 'cross-referenced', source: { issue: { number: 1, title: 'x', body: `Refs #${N}`, state: 'closed', pull_request: { merged_at: '2026-10-30T00:00:00Z' } } } },
    { event: 'cross-referenced', source: { issue: { number: 2, title: `fix(${N}): y`, body: '', state: 'open', pull_request: { merged_at: null } } } },
    { event: 'cross-referenced', source: { issue: { number: 3, title: 'z', body: `nævner #${N}`, state: 'open', pull_request: {} } } },
    { event: 'cross-referenced', source: { issue: { number: 4, title: 'issue', body: `Refs #${N}`, state: 'open' } } },
  ];
  const prs = prsFromTimeline(tl, N);
  assert.deepEqual(prs.map((p) => [p.number, p.merged, p.state]), [[2, false, 'open'], [1, true, 'closed']]);
});

test('labeledAt giver seneste claude:done-markering', () => {
  const tl = [
    { event: 'labeled', label: { name: 'claude:done' }, created_at: '2026-10-01T00:00:00Z' },
    { event: 'unlabeled', label: { name: 'claude:done' }, created_at: '2026-10-02T00:00:00Z' },
    { event: 'labeled', label: { name: 'claude:done' }, created_at: '2026-10-20T00:00:00Z' },
    { event: 'labeled', label: { name: 'other' }, created_at: '2026-10-25T00:00:00Z' },
  ];
  assert.equal(labeledAt(tl), '2026-10-20T00:00:00Z');
  assert.equal(labeledAt([]), null);
});

// ---------------------------------------------------------------- markeringer

test('parseMarkers: seneste pr. krav vinder, na uden tekst tæller ikke', () => {
  const m = parseMarkers([
    owner(`Til dørs: 5 ok gammel komponent fjernet`, '2026-10-30T00:00:00Z'),
    owner(`Til dørs: 5 na ingen gammel kode\nTil dørs: 8 na`, '2026-10-31T00:00:00Z'),
  ]);
  assert.equal(m.get(5).status, 'na');
  assert.equal(m.get(5).tekst, 'ingen gammel kode');
  assert.equal(m.has(8), false);
});

test('parseMarkers ignorerer ikke-collaborators og scriptets egen tabel', () => {
  const m = parseMarkers([
    { body: 'Til dørs: 5 ok', author_association: 'NONE', created_at: '2026-10-31T00:00:00Z' },
    owner(`${MARKER}\nTil dørs: 8 ok fra tabellen`),
  ]);
  assert.equal(m.size, 0);
});

test('parseMarkers tåler ascii-stavning og n/a, kræver ord-grænse', () => {
  const m = parseMarkers([owner('Til doers: 4 n/a ops-issue uden UI\nTil dørs: 6 okay')]);
  assert.equal(m.get(4).status, 'na');
  assert.equal(m.has(6), false);
});

// ---------------------------------------------------------------- evaluateDoor

test('evaluateDoor: tomt issue mangler alle 8', () => {
  const door = evaluateDoor({ issue: { number: N } });
  assert.equal(door.length, 8);
  assert.deepEqual(missingKrav(door).map((d) => d.krav), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const d of door) assert.ok(d.kilde, `krav ${d.krav} skal have en kilde`);
});

test('evaluateDoor: åben PR = bygget, ikke merget', () => {
  const door = evaluateDoor({ issue: { number: N }, prs: [{ number: 9, state: 'open', merged: false }] });
  assert.equal(status(door, 1), 'ok');
  assert.equal(status(door, 2), 'mangler');
  assert.match(door[1].kilde, /ikke merget/);
});

test('evaluateDoor: main-commit tæller som bygget og merget', () => {
  const door = evaluateDoor({ issue: { number: N }, commits: [{ sha: 'abcdef1234567', subject: 'x' }] });
  assert.equal(status(door, 1), 'ok');
  assert.equal(status(door, 2), 'ok');
  assert.match(door[1].kilde, /abcdef123/);
});

test('evaluateDoor udfylder 3, 4, 6, 7 automatisk', () => {
  const door = evaluateDoor({
    issue: { number: N },
    prs: [{ number: 9, state: 'closed', merged: true }],
    registry: [{ id: 'feat-x', epic: String(N), state: 'live', visible_in: 'Taktik-fanen' }],
    patchNotesText: PATCH_NOTES,
    helpChanged: 'PR #9',
  });
  assert.deepEqual(door.map((d) => d.status), ['ok', 'ok', 'ok', 'ok', 'mangler', 'ok', 'ok', 'mangler']);
  assert.match(door[6].kilde, /7\.390/);
});

test('evaluateDoor: registry-post der ikke er live giver mangler med state i kilden', () => {
  const door = evaluateDoor({ issue: { number: N }, registry: [{ id: 'feat-x', epic: String(N), state: 'dormant' }] });
  assert.equal(status(door, 3), 'mangler');
  assert.match(door[2].kilde, /dormant/);
});

test('evaluateDoor: markering udfylder huller, men taler ikke et automatisk ok ned', () => {
  const door = evaluateDoor({
    issue: { number: N },
    prs: [{ number: 9, state: 'closed', merged: true }],
    comments: [owner('Til dørs: 2 mangler ikke på main endnu\nTil dørs: 5 na intet gammelt\nTil dørs: 8 ok tjekket i prod 31/10')],
  });
  assert.equal(status(door, 2), 'ok');
  assert.equal(status(door, 5), 'na');
  assert.equal(door[4].hvorfor, 'intet gammelt');
  assert.equal(status(door, 8), 'ok');
  assert.match(door[7].kilde, /markering af ejer/);
});

// ---------------------------------------------------------------- lukning

const allDone = (n = N) =>
  evaluateDoor({
    issue: { number: n },
    prs: [{ number: 9, state: 'closed', merged: true }],
    comments: [owner([3, 4, 5, 6, 7].map((k) => `Til dørs: ${k} na ops-opgave`).join('\n') + '\nTil dørs: 8 ok verificeret')],
  });

test('decideClose lukker når alle 8 er ok/na', () => {
  const door = allDone();
  assert.deepEqual(missingKrav(door), []);
  assert.equal(decideClose({ issue: { number: N, state: 'open', labels: [] }, door }).close, true);
});

test('decideClose lukker ikke ved mangler, needs-decision eller lukket issue', () => {
  const door = allDone();
  assert.equal(decideClose({ issue: { number: N, state: 'open' }, door: evaluateDoor({ issue: { number: N } }) }).close, false);
  assert.equal(decideClose({ issue: { number: N, state: 'open', labels: [{ name: 'needs-decision' }] }, door }).close, false);
  assert.equal(decideClose({ issue: { number: N, state: 'closed', state_reason: 'not_planned' }, door }).close, false);
});

test('decideClose: brand-issue kræver krav 8 = ok, na er ikke nok', () => {
  const brandList = [{ issue: N, reason: 'x', since: '2026-10-29' }];
  const ok = allDone();
  assert.equal(decideClose({ issue: { number: N, state: 'open' }, door: ok, brandList }).close, true);
  const na = evaluateDoor({
    issue: { number: N },
    prs: [{ number: 9, state: 'closed', merged: true }],
    comments: [owner([3, 4, 5, 6, 7, 8].map((k) => `Til dørs: ${k} na ingen grund`).join('\n'))],
  });
  const res = decideClose({ issue: { number: N, state: 'open' }, door: na, brandList });
  assert.equal(res.close, false);
  assert.match(res.reason, /krav 8/);
});

// ---------------------------------------------------------------- rendering

test('renderComment har markør, 8 rækker og ingen em-dash', () => {
  const body = renderComment(evaluateDoor({ issue: { number: N } }));
  assert.ok(body.startsWith(MARKER));
  assert.equal(body.split('\n').filter((l) => /^\| [1-8] \|/.test(l)).length, 8);
  assert.equal(body.includes('—'), false);
  assert.equal(CLOSE_COMMENT.includes('—'), false);
  // scriptets egen tabel må aldrig kunne læses som en markering
  assert.equal(parseMarkers([owner(body)]).size, 0);
  assert.equal(parseMarkers([owner(body.replace(MARKER, ''))]).size, 0);
});

test('renderComment escaper pipes i begrundelser', () => {
  const door = evaluateDoor({ issue: { number: N }, comments: [owner('Til dørs: 5 na a | b')] });
  assert.match(renderComment(door), /a \\\| b/);
});

// ---------------------------------------------------------------- CLI

test('parseArgs: dry-run er default, --apply skal være eksplicit', () => {
  assert.equal(parseArgs(['--issue', '12']).apply, false);
  assert.equal(parseArgs(['--sweep', '--apply']).apply, true);
  assert.deepEqual(parseArgs(['--issue', '#1,2']).issues, [1, 2]);
  assert.throws(() => parseArgs([]), /--issue/);
  assert.throws(() => parseArgs(['--issue', 'x']), /ugyldigt/);
  assert.throws(() => parseArgs(['--bogus']), /ukendt/);
});

function fakeGh(state) {
  const calls = [];
  const exec = (args, input) => {
    calls.push({ args, input });
    const path = args.find((a) => a.startsWith('repos/') || a === 'search/issues');
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(state.doneList.map((number) => ({ number })));
    if (path === 'search/issues') return state.searchHits.join('\n');
    if (args.includes('-X') && args[args.indexOf('-X') + 1] !== 'GET') return '{}';
    const m = path.match(/^repos\/[^/]+\/[^/]+\/(issues|pulls)\/(\d+)(?:\/(comments|timeline|files))?/);
    if (!m) throw new Error(`uventet kald ${args.join(' ')}`);
    const [, kind, num, sub] = m;
    const data = state.issues[num];
    if (kind === 'pulls' && sub === 'files') return (state.prFiles[num] || []).map((f) => JSON.stringify({ filename: f })).join('\n');
    if (kind === 'pulls') return JSON.stringify(state.pulls?.[num] ?? { number: Number(num), merged_at: '2026-10-30T00:00:00Z', base: { ref: 'main' } });
    if (!sub) return JSON.stringify(data.issue);
    if (sub === 'comments') return (data.comments || []).map((c) => JSON.stringify(c)).join('\n');
    if (sub === 'timeline') return (data.timeline || []).map((c) => JSON.stringify(c)).join('\n');
    throw new Error('ukendt');
  };
  return { exec, calls };
}

const mergedPrEvent = (pr, n) => ({ event: 'cross-referenced', source: { issue: { number: pr, title: 'x', body: `Refs #${n}`, state: 'closed', repository: { full_name: 'o/r' }, pull_request: { merged_at: '2026-10-30T00:00:00Z' } } } });
const noGit = () => '';

test('processIssue (apply) opretter kommentar, lukker når alt er ok/na', () => {
  const comments = [owner([3, 4, 5, 6, 7].map((k) => `Til dørs: ${k} na ops`).join('\n') + '\nTil dørs: 8 ok tjekket')];
  const { exec, calls } = fakeGh({
    issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments, timeline: [mergedPrEvent(9, N)] } },
    prFiles: { 9: ['backend/x.js'] },
  });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'create');
  assert.equal(plan.close, true);
  const writes = calls.filter((c) => c.args.includes('POST') || c.args.includes('PATCH'));
  assert.equal(writes.length, 3);
  assert.ok(JSON.parse(writes[0].input).body.startsWith(MARKER));
  assert.equal(JSON.parse(writes[1].input).body, CLOSE_COMMENT);
  assert.deepEqual(JSON.parse(writes[2].input), { state: 'closed', state_reason: 'completed' });
});

test('processIssue redigerer eksisterende tabel i stedet for at oprette en dublet', () => {
  const stale = { id: 77, body: `${MARKER}\ngammel`, created_at: '2026-10-01T00:00:00Z', author_association: 'NONE', user: { login: 'github-actions[bot]' } };
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [stale], timeline: [] } } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'edit');
  const writes = calls.filter((c) => c.args.includes('POST') || c.args.includes('PATCH'));
  assert.equal(writes.length, 1);
  assert.ok(writes[0].args.includes('repos/o/r/issues/comments/77'));
});

test('processIssue: uændret tabel skrives ikke igen', () => {
  const body = renderComment(evaluateDoor({ issue: { number: N } }));
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [{ id: 5, body, author_association: 'NONE', user: { login: 'github-actions[bot]' } }], timeline: [] } } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'unchanged');
  assert.equal(calls.filter((c) => c.args.includes('POST') || c.args.includes('PATCH')).length, 0);
});

test('processIssue rører aldrig et lukket issue (not_planned)', () => {
  const comments = [owner([3, 4, 5, 6, 7, 8].map((k) => `Til dørs: ${k} na x`).join('\n'))];
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'closed', state_reason: 'not_planned', title: 't', labels: [] }, comments, timeline: [mergedPrEvent(9, N)] } }, prFiles: { 9: [] } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'none');
  assert.equal(plan.close, false);
  assert.equal(calls.filter((c) => c.args.includes('POST') || c.args.includes('PATCH')).length, 0);
});

test('processIssue: help.json i en merget PR giver krav 6 = ok', () => {
  const { exec } = fakeGh({
    issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [], timeline: [mergedPrEvent(9, N)] } },
    prFiles: { 9: ['frontend/public/locales/en/help.json'] },
  });
  const plan = processIssue({ number: N, repo: 'o/r', apply: false, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.door[5].status, 'ok');
  assert.match(plan.door[5].kilde, /PR #9/);
});

test('main: dry-run skriver intet og samler sweep + PR-referencer', () => {
  const { exec, calls } = fakeGh({
    doneList: [N],
    searchHits: [String(N + 1)],
    pulls: { 9: { merged_at: '2026-10-30T00:00:00Z', base: { ref: 'main' }, title: 'x', body: `Refs #${N + 2}` } },
    issues: {
      [N]: { issue: { number: N, state: 'open', title: 'a', labels: [] }, comments: [], timeline: [] },
      [N + 1]: { issue: { number: N + 1, state: 'open', title: 'b', labels: [] }, comments: [], timeline: [] },
      [N + 2]: { issue: { number: N + 2, state: 'open', title: 'c', labels: [] }, comments: [], timeline: [] },
    },
  });
  const out = [];
  const code = main(['--sweep', '--pr', '9'], { execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [], log: (s) => out.push(s), errorLog: () => {} });
  assert.equal(code, 0);
  assert.equal(calls.filter((c) => c.args.includes('POST') || c.args.includes('PATCH')).length, 0);
  const text = out.join('\n');
  assert.match(text, /3 issues tjekket \(dry-run/);
  assert.match(text, /Ville lukke: 0/);
});

test('main: ugyldige argumenter giver exit 2', () => {
  assert.equal(main(['--nope'], { errorLog: () => {}, registry: [], patchNotesText: '', brandList: [] }), 2);
});

test('decideClose: auto-close-veto blokerer', () => {
  assert.equal(decideClose({ issue: { number: N, state: 'open', labels: [{ name: 'auto-close-veto' }] }, door: allDone() }).close, false);
});

test('decideClose: genåbnet efter seneste markering lukkes ikke igen før ny markering', () => {
  const door = allDone();
  const issue = { number: N, state: 'open', labels: [] };
  const res = decideClose({ issue, door, reopened: '2026-11-01T00:00:00Z', lastMarker: '2026-10-31T10:00:00Z' });
  assert.equal(res.close, false);
  assert.match(res.reason, /genåbnet/);
  assert.equal(decideClose({ issue, door, reopened: '2026-11-01T00:00:00Z', lastMarker: '2026-11-02T00:00:00Z' }).close, true);
});

test('processIssue: genåbnet issue (reopened-event i timeline) lukkes ikke', () => {
  const comments = [owner([3, 4, 5, 6, 7].map((k) => `Til dørs: ${k} na ops`).join('\n') + '\nTil dørs: 8 ok tjekket', '2026-10-31T10:00:00Z')];
  const timeline = [mergedPrEvent(9, N), { event: 'closed', created_at: '2026-10-31T11:00:00Z' }, { event: 'reopened', created_at: '2026-10-31T12:00:00Z' }];
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments, timeline } }, prFiles: { 9: [] } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.close, false);
  assert.equal(calls.filter((c) => c.args.includes('PATCH') && c.args.some((a) => /issues\/\d+$/.test(a))).length, 0);
});

test('prsFromTimeline: PR fra et andet repo tæller ikke', () => {
  const ev = (number, full) => ({ event: 'cross-referenced', source: { issue: { number, title: 'x', body: `Refs #${N}`, state: 'closed', repository: { full_name: full }, pull_request: { merged_at: '2026-10-30T00:00:00Z' } } } });
  const viaUrl = { event: 'cross-referenced', source: { issue: { number: 3, title: 'x', body: `Refs #${N}`, state: 'open', html_url: 'https://github.com/andet/repo/pull/3', pull_request: {} } } };
  assert.deepEqual(prsFromTimeline([ev(1, 'o/r'), ev(2, 'fremmed/repo'), viaUrl], N, 'o/r').map((p) => p.number), [1]);
});

test('evaluateDoor: krav 3 kræver at ALLE registry-poster for issuet er live (retired tæller ikke)', () => {
  const reg = [
    { id: 'del-a', epic: String(N), state: 'live' },
    { id: 'del-b', note: `#${N}`, state: 'dormant' },
    { id: 'gammel', epic: String(N), state: 'retired' },
  ];
  const door = evaluateDoor({ issue: { number: N }, registry: reg });
  assert.equal(status(door, 3), 'mangler');
  assert.match(door[2].kilde, /del-b \(dormant\)/);
  assert.equal(status(evaluateDoor({ issue: { number: N }, registry: [reg[0], reg[2]] }), 3), 'ok');
});

test('processIssue: en udenforstaaendes kopi af markøren overtages aldrig', () => {
  const fake = { id: 66, body: `${MARKER}\nfalsk`, created_at: '2026-10-01T00:00:00Z', author_association: 'NONE', user: { login: 'fremmed' } };
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [fake], timeline: [] } } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'create');
  assert.equal(calls.filter((c) => c.args.some((a) => a.includes('comments/66'))).length, 0);
});

test('processIssue: dublet-tabeller tømmes, den ældste opdateres', () => {
  const bot = { login: 'github-actions[bot]' };
  const first = { id: 1, body: `${MARKER}\ngammel`, created_at: '2026-10-01T00:00:00Z', author_association: 'NONE', user: bot };
  const second = { id: 2, body: `${MARKER}\nogsaa gammel`, created_at: '2026-10-01T00:00:01Z', author_association: 'NONE', user: bot };
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [second, first], timeline: [] } } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'edit');
  assert.equal(plan.duplicates, 1);
  const patches = calls.filter((c) => c.args.includes('PATCH'));
  assert.ok(patches[0].args.includes('repos/o/r/issues/comments/1'));
  assert.ok(patches[1].args.includes('repos/o/r/issues/comments/2'));
  assert.equal(JSON.parse(patches[1].input).body, DUP_BODY);
  assert.equal(DUP_BODY.includes(MARKER), false);
});

test('mainCommitsFor bruger samme nøgleordsregel som PR-referencer', () => {
  const rec = (sha, subject, body = '') => `${sha}\x1f${subject}\x1f${body}\x1e\n`;
  const out = rec('aaa1', `fix: noget`, `Refs #${N}`) + rec('bbb2', `hotfix #${N}`) + rec('ccc3', `chore: x (Refs #1 and #${N})`) + rec('ddd4', `prefix #${N}`);
  let args;
  const commits = mainCommitsFor((a) => { args = a; return out; }, N, 'origin/main');
  assert.deepEqual(commits.map((c) => c.sha), ['aaa1', 'ccc3']);
  assert.ok(args.includes('origin/main'));
  assert.equal(mainCommitsFor(() => { throw new Error('ingen git'); }, N, 'main').length, 0);
});

test('labelNames-normalisering: strings og objekter', () => {
  const door = allDone();
  assert.equal(decideClose({ issue: { number: N, state: 'open', labels: ['needs-decision'] }, door }).close, false);
});

test('Codex P2 #7428: kun en PR merget ind i main tæller som merget', () => {
  assert.equal(mergedIntoMain({ merged_at: '2026-10-30T00:00:00Z', base: { ref: 'main' } }), true);
  assert.equal(mergedIntoMain({ merged_at: '2026-10-30T00:00:00Z', base: { ref: 'feat/integration' } }), false);
  assert.equal(mergedIntoMain({ merged_at: null, base: { ref: 'main' } }), false);
  const { exec } = fakeGh({
    issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [], timeline: [mergedPrEvent(9, N)] } },
    prFiles: { 9: ['frontend/public/locales/en/help.json'] },
    pulls: { 9: { number: 9, merged_at: '2026-10-30T00:00:00Z', base: { ref: 'feat/integration' } } },
  });
  const plan = processIssue({ number: N, repo: 'o/r', apply: false, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  const krav = (k) => plan.door.find((d) => d.krav === k);
  assert.notEqual(krav(2).status, 'ok', 'merget ind i en anden branch er ikke merget');
  assert.notEqual(krav(6).status, 'ok', 'Hjælp-bevis fra en PR uden for main tæller ikke');
});

test('Codex P2 #7428: titlens scope giver mål ved PR-merge', () => {
  assert.deepEqual(titleScopeIssues('fix(4242): x'), [4242]);
  assert.deepEqual(titleScopeIssues('feat(12, 34)!: x'), [12, 34]);
  assert.deepEqual(titleScopeIssues('chore: x'), []);
  const exec = () => JSON.stringify({ number: 9, title: 'fix(4242): noget', body: 'See #4242', merged_at: '2026-10-30T00:00:00Z', base: { ref: 'main' } });
  assert.deepEqual(targetsFromPr(exec, 'o/r', 9), [4242]);
  const notMain = () => JSON.stringify({ number: 9, title: 'fix(4242): noget', body: 'Refs #4242', merged_at: '2026-10-30T00:00:00Z', base: { ref: 'feat/x' } });
  assert.deepEqual(targetsFromPr(notMain, 'o/r', 9), []);
});

test('cell escaper backslash foer pipe, saa tabellen ikke brydes (CodeQL #385)', async () => {
  const { cell } = await import('./lib/til-doers.mjs');
  assert.equal(cell('a|b'), 'a\\|b');
  assert.equal(cell('a\\|b'), 'a\\\\\\|b');
  assert.equal(cell('sti\\til\nfil'), 'sti\\\\til fil');
});

// ---------------------------------------------------------------- auto-bevis (#7585)

const proofSha = 'abcdef1234567';
const proofBody = (lines, { issue = N, pr = 9, sha = proofSha } = {}) => `<!-- til-doers-proof:v1 pr=${pr} issue=${issue} sha=${sha} -->\n### Til dørs: auto-bevis\n${lines.join('\n')}`;
const proofBy = (association, login, lines, opts = {}, created_at = '2026-11-04T10:00:00Z') => ({ id: Math.floor(Math.random() * 1e9), body: proofBody(lines, opts), created_at, author_association: association, user: { login } });

test('auto-bevis: author_association OWNER tæller med kilden auto-bevis, bot (CONTRIBUTOR) og NONE tæller aldrig', () => {
  const lines = ['Til dørs: 4 ok auto-bevis: /team fundet', 'Til dørs: 8 ok auto-bevis: GET /api/h -> 200'];
  const owner_ = parseMarkers([proofBy('OWNER', 'ejer', lines)], { issue: N });
  assert.equal(owner_.get(4).auto, true);
  assert.equal(owner_.get(8).menneske, null);
  // github-actions[bot] har author_association CONTRIBUTOR (set paa #7585 4/11)
  assert.equal(parseMarkers([proofBy('CONTRIBUTOR', 'github-actions[bot]', lines)], { issue: N }).size, 0);
  assert.equal(parseMarkers([proofBy('NONE', 'fremmed', lines)], { issue: N }).size, 0);

  const door = evaluateDoor({ issue: { number: N }, comments: [proofBy('OWNER', 'ejer', lines)] });
  const k4 = door.find((d) => d.krav === 4);
  assert.equal(k4.status, 'ok');
  assert.equal(k4.kilde, 'auto-bevis');
  assert.equal(k4.autoBevis, true);
  assert.match(renderComment(door), /\| 4 \| Synligt \| ok \| auto-bevis \|/);
  const botDoor = evaluateDoor({ issue: { number: N }, comments: [proofBy('CONTRIBUTOR', 'github-actions[bot]', lines)] });
  assert.equal(botDoor.find((d) => d.krav === 4).status, 'mangler');
});

test('auto-bevis: bevis for et andet issue eller med misdannet markør tæller ikke', () => {
  const lines = ['Til dørs: 4 ok x'];
  assert.equal(parseMarkers([proofBy('OWNER', 'ejer', lines, { issue: N + 1 })], { issue: N }).size, 0);
  const broken = { ...proofBy('OWNER', 'ejer', lines), body: `<!-- til-doers-proof:v1 pr=9 -->\n${lines[0]}` };
  assert.equal(parseMarkers([broken], { issue: N }).size, 0);
  // uden issue-kontekst er den stadig auto (konservativt: aldrig menneske-ord)
  assert.equal(parseMarkers([broken]).get(4).auto, true);
});

test('auto-bevis: udkast-linjer markerer aldrig noget', () => {
  const door = evaluateDoor({ issue: { number: N }, comments: [proofBy('OWNER', 'ejer', ['Udkast (auto-bevis) 4: ingen deklaration', 'Udkast (auto-bevis) 8: Deploy verify er ikke grøn'])] });
  assert.equal(status(door, 4), 'mangler');
  assert.equal(status(door, 8), 'mangler');
  assert.equal(door.find((d) => d.krav === 8).kilde, 'manuelt');
});

test('Codex P2: et redigeret (nyere) auto-bevis vinder over en menneskelig markering imellem', () => {
  const refreshed = { ...proofBy('OWNER', 'ejer', ['Til dørs: 8 mangler auto-bevis: GET /api/h gav 500, forventet 200'], {}, '2026-11-02T00:00:00Z'), updated_at: '2026-11-04T00:00:00Z' };
  const human = owner('Til dørs: 8 ok tjekket', '2026-11-03T00:00:00Z');
  const k8 = evaluateDoor({ issue: { number: N }, comments: [refreshed, human] }).find((d) => d.krav === 8);
  assert.equal(k8.status, 'mangler');
  assert.equal(k8.kilde, 'auto-bevis');
  // en redigeret menneskelig kommentar flytter sig ikke (uaendret adfaerd)
  const editedHuman = { ...owner('Til dørs: 8 mangler gammel', '2026-11-01T00:00:00Z'), updated_at: '2026-11-05T00:00:00Z' };
  assert.equal(evaluateDoor({ issue: { number: N }, comments: [editedHuman, human] }).find((d) => d.krav === 8).status, 'ok');
  // og auto-beviset rykker ikke grænsen for genlukning
  assert.equal(lastMarkerAt([refreshed, human]), '2026-11-03T00:00:00Z');
});

test('auto-bevis: et fejlet tjek (mangler) overtrumfer en ældre menneskelig ok', () => {
  const door = evaluateDoor({
    issue: { number: N },
    comments: [owner('Til dørs: 8 ok tjekket', '2026-11-03T00:00:00Z'), proofBy('OWNER', 'ejer', ['Til dørs: 8 mangler auto-bevis: GET /api/h gav 500, forventet 200'])],
  });
  const k8 = door.find((d) => d.krav === 8);
  assert.equal(k8.status, 'mangler');
  assert.equal(k8.kilde, 'auto-bevis');
  assert.equal(k8.menneskeStatus, 'ok');
});

const doneExcept8 = () => owner([3, 4, 5, 6, 7].map((k) => `Til dørs: ${k} na ops`).join('\n'), '2026-11-01T00:00:00Z');
const mergedPr = [{ number: 9, state: 'closed', merged: true }];
const brandList = [{ issue: N, reason: 'x', since: '2026-10-29' }];
const openIssue = { number: N, state: 'open', labels: [] };

test('brand-regel: et brand-issue lukkes aldrig alene på auto-bevis for krav 8', () => {
  const door = evaluateDoor({ issue: { number: N }, prs: mergedPr, comments: [doneExcept8(), proofBy('OWNER', 'ejer', ['Til dørs: 8 ok auto-bevis: GET /api/h -> 200'])] });
  assert.deepEqual(missingKrav(door), []);
  const res = decideClose({ issue: openIssue, door, brandList });
  assert.equal(res.close, false);
  assert.match(res.reason, /menneskelig markering af krav 8/);
  // et ikke-brand-issue maa gerne lukke paa auto-bevis (de haarde ok-regler gaelder)
  assert.equal(decideClose({ issue: openIssue, door, brandList: [] }).close, true);
});

test('brand-regel: menneskelig 8 ok (før eller efter auto-bevis) lader brand-issuet lukke', () => {
  const auto8 = proofBy('OWNER', 'ejer', ['Til dørs: 8 ok auto-bevis: GET /api/h -> 200'], {}, '2026-11-04T10:00:00Z');
  const before = evaluateDoor({ issue: { number: N }, prs: mergedPr, comments: [doneExcept8(), owner('Til dørs: 8 ok set i prod', '2026-11-02T00:00:00Z'), auto8] });
  assert.equal(decideClose({ issue: openIssue, door: before, brandList }).close, true);
  const after = evaluateDoor({ issue: { number: N }, prs: mergedPr, comments: [doneExcept8(), auto8, owner('Til dørs: 8 ok set i prod', '2026-11-05T00:00:00Z')] });
  assert.equal(after.find((d) => d.krav === 8).kilde, 'markering af ejer');
  assert.equal(decideClose({ issue: openIssue, door: after, brandList }).close, true);
  // menneskelig 8 mangler foer auto-bevis tæller ikke som ok
  const human_no = evaluateDoor({ issue: { number: N }, prs: mergedPr, comments: [doneExcept8(), owner('Til dørs: 8 mangler fejler stadig', '2026-11-02T00:00:00Z'), auto8] });
  assert.equal(decideClose({ issue: openIssue, door: human_no, brandList }).close, false);
});

test('auto-bevis låser ikke op for genlukning efter en genåbning', () => {
  const comments = [owner([3, 4, 5, 6, 7].map((k) => `Til dørs: ${k} na ops`).join('\n'), '2026-11-01T00:00:00Z'), proofBy('OWNER', 'ejer', ['Til dørs: 8 ok auto-bevis'], {}, '2026-11-04T10:00:00Z')];
  assert.equal(lastMarkerAt(comments), '2026-11-01T00:00:00Z');
  const door = evaluateDoor({ issue: { number: N }, prs: mergedPr, comments });
  const res = decideClose({ issue: openIssue, door, reopened: '2026-11-03T00:00:00Z', lastMarker: lastMarkerAt(comments) });
  assert.equal(res.close, false);
  assert.match(res.reason, /genåbnet/);
  assert.equal(lastMarkerAt([proofBy('OWNER', 'ejer', ['Til dørs: 8 ok x'])]), null);
});

test('processIssue: en auto-bevis-kommentar er aldrig til-dørs-tabellen og redigeres ikke', () => {
  const proof = { ...proofBy('OWNER', 'ejer', ['Til dørs: 4 ok auto-bevis']), id: 55 };
  const { exec, calls } = fakeGh({ issues: { [N]: { issue: { number: N, state: 'open', title: 't', labels: [] }, comments: [proof], timeline: [] } } });
  const plan = processIssue({ number: N, repo: 'o/r', apply: true, execGh: exec, execGit: noGit, mainRef: 'main', registry: [], patchNotesText: '', brandList: [] });
  assert.equal(plan.commentAction, 'create');
  assert.equal(plan.door.find((d) => d.krav === 4).kilde, 'auto-bevis');
  assert.equal(calls.filter((c) => c.args.some((a) => a.includes('comments/55'))).length, 0);
});

// ---------------------------------------------------------------- internt arbejde (#7827)

const DONE = { number: N, labels: [{ name: 'claude:done' }] };
const MERGED = [{ number: 77, state: 'closed', merged: true }];
const verified = (pr = 77, issue = N) => owner(`<!-- merge-queue-closeout:v1 pr=${pr} issue=${issue} -->\nMerget. Verificeret: main-CI grøn.`);

test('isInternalChange: kun positivlisten er intern, og tom liste er det ikke', () => {
  assert.equal(isInternalChange(['scripts/a.mjs', '.github/workflows/x.yml', 'docs/a.md', 'README.md', 'backend/lib/a.test.js']), true);
  assert.equal(isInternalChange(['scripts/a.mjs', 'frontend/src/pages/A.jsx']), false);
  assert.equal(isInternalChange(['backend/lib/a.js']), false);
  assert.equal(isInternalChange(['database/2026-01-01-x.sql']), false);
  assert.equal(isInternalChange(['frontend/public/locales/en/help.json']), false);
  assert.equal(isInternalChange(['ukendt/fil.txt']), false);
  assert.equal(isInternalChange([]), false);
  assert.equal(isInternalChange(null), false);
});

test('internt done-issue med verificeret PR er 8 af 8 og lukkes', () => {
  const door = evaluateDoor({ issue: DONE, prs: MERGED, comments: [verified()], internalOnly: true });
  assert.deepEqual([3, 4, 5, 6, 7].map((k) => status(door, k)), ['na', 'na', 'na', 'na', 'na']);
  assert.equal(status(door, 8), 'ok');
  assert.equal(decideClose({ issue: { ...DONE, state: 'open' }, door }).close, true);
});

test('internt issue uden køens verificering mangler stadig krav 8', () => {
  const door = evaluateDoor({ issue: DONE, prs: MERGED, internalOnly: true });
  assert.equal(status(door, 3), 'na');
  assert.equal(status(door, 8), 'mangler');
  assert.equal(decideClose({ issue: { ...DONE, state: 'open' }, door }).close, false);
});

test('køens verificering skal gælde seneste PR og netop dette issue', () => {
  const prs = [...MERGED, { number: 78, state: 'closed', merged: true }];
  assert.equal(status(evaluateDoor({ issue: DONE, prs, comments: [verified(77)], internalOnly: true }), 8), 'mangler');
  assert.equal(status(evaluateDoor({ issue: DONE, prs, comments: [verified(78)], internalOnly: true }), 8), 'ok');
  assert.equal(status(evaluateDoor({ issue: DONE, prs: MERGED, comments: [verified(77, 1)], internalOnly: true }), 8), 'mangler');
});

test('en afventende køkommentar eller en fremmeds kommentar tæller ikke som verificeret', () => {
  const pending = owner(`<!-- merge-queue-closeout:v1 pr=77 issue=${N} -->\nMerget. Verifikation følger.`);
  assert.equal(queueVerified([pending], 77, N), false);
  const stranger = { ...verified(), author_association: 'NONE' };
  assert.equal(queueVerified([stranger], 77, N), false);
});

test('en menneskelig mangler på krav 8 holder et internt issue åbent', () => {
  const comments = [verified(), owner('Til dørs: 8 mangler se næste rigtige kørsel', '2026-11-01T10:00:00Z')];
  const door = evaluateDoor({ issue: DONE, prs: MERGED, comments, internalOnly: true });
  assert.equal(status(door, 8), 'mangler');
  assert.equal(decideClose({ issue: { ...DONE, state: 'open' }, door }).close, false);
});

test('reglen gælder ikke uden done, med åben PR, for epics eller spillervendte PRer', () => {
  const on = (issue, prs = MERGED, internalOnly = true) => status(evaluateDoor({ issue, prs, comments: [verified()], internalOnly }), 3);
  assert.equal(on({ number: N, labels: [{ name: 'claude:todo' }] }), 'mangler');
  assert.equal(on(DONE, [...MERGED, { number: 80, state: 'open', merged: false }]), 'mangler');
  assert.equal(on({ number: N, labels: [{ name: 'claude:done' }, { name: 'epic:progression' }] }), 'mangler');
  assert.equal(on(DONE, MERGED, false), 'mangler');
});

test('et brand-issue lukkes ikke alene på køens verificering', () => {
  const door = evaluateDoor({ issue: DONE, prs: MERGED, comments: [verified()], internalOnly: true });
  const res = decideClose({ issue: { ...DONE, state: 'open' }, door, brandList: [{ issue: N }] });
  assert.equal(res.close, false);
});

test('seneste PR vælges efter merge-tid, ikke PR-nummer', () => {
  const prs = [
    { number: 100, state: 'closed', merged: true, mergedAt: '2026-11-01T10:00:00Z' },
    { number: 90, state: 'closed', merged: true, mergedAt: '2026-11-02T10:00:00Z' },
  ];
  assert.equal(latestMerged(prs).number, 90);
  assert.equal(status(evaluateDoor({ issue: DONE, prs, comments: [verified(100)], internalOnly: true }), 8), 'mangler');
  assert.equal(status(evaluateDoor({ issue: DONE, prs, comments: [verified(90)], internalOnly: true }), 8), 'ok');
});

test('directCommits skiller squash-commits fra direkte main-commits', () => {
  const commits = [{ sha: 'a', subject: 'feat: x (#77)' }, { sha: 'b', subject: 'fix: direkte Refs #1' }];
  assert.deepEqual(directCommits(commits, MERGED).map((c) => c.sha), ['b']);
});

test('fetchIssueBundle: en direkte spiller-commit gør issuet ikke-internt', () => {
  const execGh = (args) => {
    const path = args.find((a) => a.startsWith('repos/')) || '';
    if (path.endsWith('/comments?per_page=100')) return '';
    if (path.includes('/timeline')) {
      return `${JSON.stringify({ event: 'cross-referenced', source: { issue: { number: 77, title: 'x', body: `Refs #${N}`, state: 'closed', pull_request: { merged_at: '2026-11-01T10:00:00Z' }, repository: { full_name: 'o/r' } } } })}\n`;
    }
    if (path.includes('/pulls/77/files')) return `${JSON.stringify({ filename: 'scripts/a.mjs' })}\n`;
    if (path.includes('/pulls/77')) return JSON.stringify({ merged_at: '2026-11-01T10:00:00Z', base: { ref: 'main' } });
    return JSON.stringify({ number: N, state: 'open', labels: [] });
  };
  const gitWith = (file) => (args) => {
    if (args[0] === 'log') return `abc1234\x1ffix: direkte\x1fRefs #${N}\x1e`;
    return `${file}\n`;
  };
  const run = (file) => fetchIssueBundle({ execGh, execGit: gitWith(file), repo: 'o/r', number: N, mainRef: 'main' }).internalOnly;
  assert.equal(run('frontend/src/pages/A.jsx'), false);
  assert.equal(run('docs/a.md'), true);
});
