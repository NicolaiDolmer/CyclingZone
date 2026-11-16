// Tests for scripts/til-doers-draft.mjs (#8266). Intet netvaerk: gh og fetch er fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DUP_BODY,
  buildHelpIndex,
  copenhagenDay,
  coveringNote,
  deliveredIssues,
  evaluatePr,
  extractCleanupSection,
  extractPatchNoteDraft,
  fetchRoadmap,
  hasFindings,
  helpPointers,
  isInternalPr,
  markerFor,
  masterplanMentions,
  parseArgs,
  parseBackupReminders,
  parsePatchNotes,
  planBranchCleanup,
  planComment,
  prIssueRefs,
  leaseDeleteArgs,
  fetchIssueStates,
  renderCleanup,
  renderDraft,
  runCleanup,
  runDraft,
} from './til-doers-draft.mjs';

const PATCH_NOTES = `export const PATCHES = [
{
  "version": "7.453",
  "date": "2026-11-16",
  "changes": [
    { "category": "fixed", "en": { "title": "A" }, "refs": [8196] },
    { "category": "improved", "en": { "title": "B" }, "refs": [6365, 6366] }
  ]
},
{
  "version": "7.440",
  "date": "2026-11-10",
  "changes": [
    { "category": "new", "en": { "title": "C" }, "refs": [7801] }
  ]
}
];`;

function pr(over = {}) {
  return {
    number: 9001,
    title: 'feat(training): ny knap på træningssiden (Refs #7801)',
    body: 'Refs #7801',
    createdAt: '2026-11-15T08:00:00Z',
    mergedAt: '2026-11-16T10:00:00Z',
    files: [{ path: 'frontend/src/pages/TrainingPage.tsx' }],
    changedFiles: 1,
    labels: [],
    ...over,
  };
}

const NOTES = parsePatchNotes(PATCH_NOTES);

// ---------------------------------------------------------------- patch notes

test('parsePatchNotes: hver note faar version, dato og refs', () => {
  assert.deepEqual(NOTES, [
    { version: '7.453', date: '2026-11-16', refs: [8196] },
    { version: '7.453', date: '2026-11-16', refs: [6365, 6366] },
    { version: '7.440', date: '2026-11-10', refs: [7801] },
  ]);
});

test('coveringNote: en aeldre note paa samme issue daekker ikke en ny PR', () => {
  assert.equal(coveringNote(NOTES, [7801], '2026-11-16'), null);
  assert.equal(coveringNote(NOTES, [7801], '2026-11-09').version, '7.440');
  assert.equal(coveringNote(NOTES, [6366], '2026-11-16').version, '7.453');
});

test('extractPatchNoteDraft: EN/DA paa samme linje, med citationstegn og fed', () => {
  const body = '## Hvad\nx\n\n## Patch note-udkast (til close-out)\n\nEN: "Riders rest."\n\n**DA:** Rytterne hviler.\n\n## Brugerverifikation\nEN: ikke denne';
  const d = extractPatchNoteDraft(body);
  assert.equal(d.en, 'Riders rest.');
  assert.equal(d.da, 'Rytterne hviler.');
  assert.match(d.heading, /Patch note-udkast/);
});

test('extractPatchNoteDraft: tekst paa linjerne efter EN:, og intet afsnit giver null', () => {
  const d = extractPatchNoteDraft('### Patch note\n- EN:\nFirst line\nsecond line\n\n- DA: Dansk');
  assert.equal(d.en, 'First line second line');
  assert.equal(d.da, 'Dansk');
  assert.equal(extractPatchNoteDraft('## Hvad\nintet'), null);
  assert.equal(extractPatchNoteDraft('<!-- ## Patch note -->\n## Hvad'), null);
});

// ---------------------------------------------------------------- refs og filer

test('prIssueRefs: Refs/Closes og rene nummer-scopes; "race-v6" er ikke issue #6', () => {
  assert.deepEqual(prIssueRefs(pr({ title: 'feat(race-v6): x (Refs #7865)', body: '' })), [{ issue: 7865, kind: 'refs' }]);
  assert.deepEqual(prIssueRefs(pr({ title: 'fix(7801): x', body: 'Closes #12' })), [
    { issue: 12, kind: 'closes' },
    { issue: 7801, kind: 'refs' },
  ]);
  assert.deepEqual(prIssueRefs(pr({ number: 50, title: 'fix(50): self', body: '' })), []);
});

test('isInternalPr: patch note- og docs-PR er intern, spillerkode og ukendt filliste er ikke', () => {
  assert.equal(isInternalPr(pr({ files: [{ path: 'frontend/src/data/patchNotes.js' }] })), true);
  assert.equal(isInternalPr(pr({ files: [{ path: 'frontend/src/data/patchNotes.js' }, { path: 'docs/NOW.md' }], changedFiles: 2 })), true);
  assert.equal(isInternalPr(pr()), false);
  assert.equal(isInternalPr(pr({ files: [{ path: 'scripts/a.mjs' }], changedFiles: 140 })), false);
  assert.equal(isInternalPr(pr({ files: [] })), false);
});

// ---------------------------------------------------------------- evaluatePr

const HELP_INDEX = buildHelpIndex(
  { sections: { dailytraining: { label: 'Daily training', trainNowBonus: 'x' }, auctions: { label: 'Auctions', bidding: 'x' } } },
  { sections: { dailytraining: { label: 'Daglig træning' }, auctions: { label: 'Auktioner' } } },
);

test('evaluatePr: spillervendt feat uden note faar skabelon og Hjaelp-pegepind', () => {
  const r = evaluatePr({ pr: pr({ body: 'Refs #7801\n\n## Patch note-udkast\nEN: New button.\nDA: Ny knap.' }), notes: NOTES, helpIndex: HELP_INDEX });
  assert.equal(r.patch.status, 'mangler');
  assert.equal(r.patch.entry.category, 'new');
  assert.equal(r.patch.entry.topic, 'Training');
  assert.deepEqual(r.patch.entry.refs, [7801]);
  assert.equal(r.patch.entry.en.body, 'New button.');
  assert.equal(r.patch.entry.da.body, 'Ny knap.');
  assert.equal(r.patch.entry.en.title, 'TODO');
  assert.equal(r.help.status, 'mangler');
  assert.equal(r.help.sections[0].key, 'dailytraining');
});

test('evaluatePr: note dateret efter merget, opt-out-linje og egen patchNotes.js daekker', () => {
  const merged = '2026-11-16T09:00:00Z';
  assert.equal(evaluatePr({ pr: pr({ title: 'fix: x (Refs #6366)', body: 'Refs #6366', mergedAt: merged }), notes: NOTES }).patch.status, 'ok');
  assert.equal(evaluatePr({ pr: pr({ title: 'fix: x', body: 'patch-notes: n/a — kun admin' }), notes: NOTES }).patch.status, 'ok');
  const own = pr({ title: 'fix: x', files: [{ path: 'frontend/src/App.tsx' }, { path: 'frontend/src/data/patchNotes.js' }], changedFiles: 2 });
  assert.equal(evaluatePr({ pr: own, notes: NOTES }).patch.status, 'ok');
});

test('evaluatePr: bag slukket kontakt venter, og en eksisterende note vinder', () => {
  const sw = pr({ title: 'feat(training): bonus bag slukket kontakt (Refs #7741)', body: 'Refs #7741\n## Patch note\nEN: Bonus.' });
  const r = evaluatePr({ pr: sw, notes: NOTES, helpIndex: HELP_INDEX });
  assert.equal(r.behindSwitch, true);
  assert.equal(r.patch.status, 'venter');
  assert.equal(r.patch.draft.en, 'Bonus.');
  assert.equal(r.help, null);
  const covered = pr({ title: 'feat: x bag slukket kontakt (Refs #8196)', body: 'Refs #8196' });
  assert.equal(evaluatePr({ pr: covered, notes: NOTES }).patch.status, 'ok');
});

test('evaluatePr: chore, intern sti og ops-scope kraever intet; fix kraever ikke Hjaelp', () => {
  assert.equal(evaluatePr({ pr: pr({ title: 'chore(7801): migration' }), notes: NOTES }).patch, null);
  assert.equal(evaluatePr({ pr: pr({ title: 'feat(ops): alarm', files: [{ path: 'backend/lib/x.js' }] }), notes: NOTES }).patch, null);
  const internal = evaluatePr({ pr: pr({ files: [{ path: 'scripts/x.mjs' }] }), notes: NOTES });
  assert.equal(internal.internal, true);
  assert.equal(internal.patch, null);
  const fix = evaluatePr({ pr: pr({ title: 'fix(training): x' }), notes: NOTES, helpIndex: HELP_INDEX });
  assert.equal(fix.patch.status, 'mangler');
  assert.equal(fix.help, null);
});

test('evaluatePr: Til dørs-markering taeller kun fra PR-start, og help.json daekker Hjaelp', () => {
  const comments = (at) => [{ body: 'Til dørs: 7 na kun intern\nTil dørs: 6 ok afsnit skrevet', author_association: 'OWNER', created_at: at, user: { login: 'x' } }];
  const info = (at) => new Map([[7801, { number: 7801, state: 'open', labels: [], comments: comments(at) }]]);
  const after = evaluatePr({ pr: pr(), notes: NOTES, issues: info('2026-11-15T09:00:00Z'), helpIndex: HELP_INDEX });
  assert.equal(after.patch.status, 'ok');
  assert.equal(after.help.status, 'ok');
  const before = evaluatePr({ pr: pr(), notes: NOTES, issues: info('2026-11-01T09:00:00Z'), helpIndex: HELP_INDEX });
  assert.equal(before.patch.status, 'mangler');
  assert.equal(before.help.status, 'mangler');
  const outsider = new Map([[7801, { number: 7801, comments: [{ ...comments('2026-11-15T09:00:00Z')[0], author_association: 'NONE' }] }]]);
  assert.equal(evaluatePr({ pr: pr(), notes: NOTES, issues: outsider }).patch.status, 'mangler');
  const help = pr({ files: [{ path: 'frontend/src/App.tsx' }, { path: 'frontend/public/locales/en/help.json' }], changedFiles: 2 });
  assert.equal(evaluatePr({ pr: help, notes: NOTES }).help.status, 'ok');
});

test('deliveredIssues: lukket/claude:done eller Closes uden kontakt', () => {
  const results = [
    { pr: { number: 1 }, behindSwitch: false, refs: [{ issue: 10, kind: 'closes' }, { issue: 11, kind: 'refs' }] },
    { pr: { number: 2 }, behindSwitch: true, refs: [{ issue: 12, kind: 'closes' }, { issue: 13, kind: 'refs' }] },
  ];
  const issues = new Map([
    [11, { state: 'open', labels: [{ name: 'claude:todo' }] }],
    [12, { state: 'open', labels: [] }],
    [13, { state: 'open', labels: [{ name: 'claude:done' }] }],
  ]);
  assert.deepEqual([...deliveredIssues(results, issues)], [[10, 1], [13, 2]]);
});

// ---------------------------------------------------------------- masterplan, Hjaelp, backups

test('masterplanMentions: afsnit og uddrag, #12 matcher ikke #123', () => {
  const md = '# Plan\n## Rækkefølge\n1. Træning #7801 først\n2. Andet #123\n## Senere\n- #12 og #7801';
  assert.deepEqual(masterplanMentions(md, 7801), [
    { section: 'Rækkefølge', excerpt: '1. Træning #7801 først' },
    { section: 'Senere', excerpt: '- #12 og #7801' },
  ]);
  assert.equal(masterplanMentions(md, 12).length, 1);
});

test('helpPointers: ord fra titlen finder afsnit, ogsaa med ae for æ', () => {
  assert.equal(helpPointers('feat(train-now): bonus', HELP_INDEX)[0].key, 'dailytraining');
  assert.equal(helpPointers('fix: daglig traening', HELP_INDEX)[0].key, 'dailytraining');
  assert.deepEqual(helpPointers('fix: noget helt andet', HELP_INDEX), []);
});

test('parseBackupReminders: over dato, i dag, senere; "må ikke slettes" ignoreres', () => {
  const now = '> **⏰ Påmind ejeren:** fakturaer · slet `backup_1_20261101_riders` ~15/11 · slet `backup_2_x` + `backup_3_y` ~16/11 · slet `backup_4_*` ~26/11 · slet Railway-var `FOO` ~1/11.\n> **Åbent:** `backup_7153_wander_*` må ikke slettes';
  assert.deepEqual(parseBackupReminders(now, '2026-11-16'), [
    { names: ['backup_1_20261101_riders'], due: '2026-11-15', status: 'over' },
    { names: ['backup_2_x', 'backup_3_y'], due: '2026-11-16', status: 'i dag' },
    { names: ['backup_4_*'], due: '2026-11-26', status: 'senere' },
  ]);
});

test('parseBackupReminders: aarsskifte', () => {
  assert.equal(parseBackupReminders('slet `backup_a` ~28/12', '2027-01-03')[0].due, '2026-12-28');
  assert.equal(parseBackupReminders('slet `backup_b` ~3/1', '2026-12-28')[0].due, '2027-01-03');
});

// ---------------------------------------------------------------- oprydning

const NOW = new Date('2026-11-16T04:30:00Z');
const OLD = '2026-11-14T10:00:00Z';

test('planBranchCleanup: kun mergede branches uden nye commits, uden aaben PR, ikke beskyttede', () => {
  const branches = [
    { name: 'fix/a', sha: 'a1' },
    { name: 'fix/new-commit', sha: 'b2' },
    { name: 'feat/stack-base', sha: 'c1' },
    { name: 'fix/reopened', sha: 'd1' },
    { name: 'fix/too-new', sha: 'e1' },
    { name: 'main', sha: 'm1' },
    { name: 'fix/fork', sha: 'f1' },
    { name: 'fix/no-pr', sha: 'g1' },
  ];
  const mergedPrs = [
    { number: 1, headRefName: 'fix/a', headRefOid: 'a1', baseRefName: 'main', mergedAt: OLD },
    { number: 2, headRefName: 'fix/new-commit', headRefOid: 'b1', baseRefName: 'main', mergedAt: OLD },
    { number: 3, headRefName: 'feat/stack-base', headRefOid: 'c1', baseRefName: 'main', mergedAt: OLD },
    { number: 4, headRefName: 'fix/reopened', headRefOid: 'd1', baseRefName: 'main', mergedAt: OLD },
    { number: 5, headRefName: 'fix/too-new', headRefOid: 'e1', baseRefName: 'main', mergedAt: '2026-11-16T01:00:00Z' },
    { number: 6, headRefName: 'main', headRefOid: 'm1', baseRefName: 'main', mergedAt: OLD },
    { number: 7, headRefName: 'fix/fork', headRefOid: 'f1', baseRefName: 'main', mergedAt: OLD, isCrossRepository: true },
  ];
  const openPrs = [
    { number: 8, headRefName: 'feat/stacked', baseRefName: 'feat/stack-base' },
    { number: 9, headRefName: 'fix/reopened', baseRefName: 'main' },
  ];
  const plan = planBranchCleanup({ branches, mergedPrs, openPrs, now: NOW });
  assert.deepEqual(plan.deletions, [{ branch: 'fix/a', sha: 'a1', pr: 1 }]);
  assert.deepEqual(plan.skipped, { aaben: 2, nyCommit: 1, forNy: 1, beskyttet: 1 });
});

test('planBranchCleanup: loft pr. koersel', () => {
  const branches = [1, 2, 3].map((i) => ({ name: `b${i}`, sha: `s${i}` }));
  const mergedPrs = [1, 2, 3].map((i) => ({ number: i, headRefName: `b${i}`, headRefOid: `s${i}`, baseRefName: 'main', mergedAt: OLD }));
  const plan = planBranchCleanup({ branches, mergedPrs, openPrs: [], now: NOW, max: 2 });
  assert.equal(plan.deletions.length, 2);
  assert.equal(plan.udskudt, 1);
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

test('leaseDeleteArgs: sletning er betinget af den SHA planen saa', () => {
  assert.deepEqual(leaseDeleteArgs('https://github.com/o/n.git', 'feat/8266-x', SHA_A), [
    'push', '--porcelain', `--force-with-lease=refs/heads/feat/8266-x:${SHA_A}`, 'https://github.com/o/n.git', ':refs/heads/feat/8266-x',
  ]);
  assert.throws(() => leaseDeleteArgs('r', 'fix/a', 'a1'), /SHA/);
  assert.throws(() => leaseDeleteArgs('r', '--delete', SHA_A), /branch-navn/);
  assert.throws(() => leaseDeleteArgs('r', 'a..b', SHA_A), /branch-navn/);
});

function fakeGh(state) {
  const calls = [];
  const exec = (args, input) => {
    calls.push({ args, input });
    const a = args.join(' ');
    if (a.startsWith('pr list') && a.includes('--state open')) return JSON.stringify(state.open || []);
    if (a.startsWith('pr list') && a.includes('headRefOid')) return JSON.stringify(state.mergedHeads || []);
    if (a.startsWith('pr list')) return JSON.stringify(state.prs || []);
    if (a.includes('matching-refs')) return (state.refs || []).map((r) => JSON.stringify(r)).join('\n');
    if (args[0] === 'api' && args[1] === 'graphql') {
      const repository = {};
      for (const m of a.matchAll(/i(\d+): issueOrPullRequest/g)) {
        const issue = state.issues?.[m[1]] || { state: 'open', labels: [] };
        repository[`i${m[1]}`] = { state: issue.state.toUpperCase(), labels: { nodes: issue.labels } };
      }
      return JSON.stringify({ data: { repository } });
    }
    if (args[0] === 'api' && args[1] === '-X') return '{}';
    if (a.includes('/comments')) return (state.comments || []).map((c) => JSON.stringify(c)).join('\n');
    throw new Error(`uventet gh-kald: ${a}`);
  };
  return { exec, calls };
}

function fakeGit({ stale = [] } = {}) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    const branch = args.at(-1).replace(':refs/heads/', '');
    if (stale.includes(branch)) throw Object.assign(new Error('push fejlede'), { stderr: '! [rejected] (stale info)' });
    return '';
  };
  return { exec, calls };
}

test('runCleanup: dry-run sletter intet, --apply sletter med lease, flyttet spids afvises', () => {
  const state = {
    refs: [{ ref: 'refs/heads/fix/a', object: { sha: SHA_A } }, { ref: 'refs/heads/fix/b', object: { sha: SHA_B } }],
    mergedHeads: [
      { number: 1, headRefName: 'fix/a', headRefOid: SHA_A, baseRefName: 'main', mergedAt: OLD },
      { number: 2, headRefName: 'fix/b', headRefOid: SHA_B, baseRefName: 'main', mergedAt: OLD },
    ],
    open: [],
  };
  const dryGit = fakeGit();
  const r1 = runCleanup({ execGh: fakeGh(state).exec, execGit: dryGit.exec, repo: 'o/n', now: NOW, log: () => {} });
  assert.equal(r1.applied, false);
  assert.equal(r1.deleted.length, 2);
  assert.equal(dryGit.calls.length, 0);

  const wetGit = fakeGit();
  const r2 = runCleanup({ execGh: fakeGh(state).exec, execGit: wetGit.exec, repo: 'o/n', now: NOW, apply: true, log: () => {} });
  assert.deepEqual(wetGit.calls.map((c) => c[2]), [`--force-with-lease=refs/heads/fix/a:${SHA_A}`, `--force-with-lease=refs/heads/fix/b:${SHA_B}`]);
  assert.ok(wetGit.calls.every((c) => c[3] === 'https://github.com/o/n.git'));
  assert.equal(r2.deleted.length, 2);

  // Nogen skubbede til fix/b efter opgoerelsen: serveren afviser, intet tabes.
  const staleGit = fakeGit({ stale: ['fix/b'] });
  const r3 = runCleanup({ execGh: fakeGh(state).exec, execGit: staleGit.exec, repo: 'o/n', now: NOW, apply: true, log: () => {} });
  assert.deepEqual(r3.deleted.map((d) => d.branch), ['fix/a']);
  assert.equal(r3.errors.length, 1);
  assert.match(r3.errors[0], /fix\/b: .*stale info/);
});

// ---------------------------------------------------------------- kommentar og rendering

test('planComment: opret kun ved fund, opdater dagens, toem dubletter, ignorer fremmede', () => {
  const day = '2026-11-16';
  const body = `${markerFor(day)}\nny`;
  assert.deepEqual(planComment({ comments: [], day, body, findings: false }), []);
  assert.deepEqual(planComment({ comments: [], day, body, findings: true }), [{ op: 'create', body }]);
  const bot = (id, at, b = `${markerFor(day)}\ngammel`) => ({ id, body: b, created_at: at, user: { login: 'github-actions[bot]' }, author_association: 'CONTRIBUTOR' });
  const comments = [
    bot(2, '2026-11-16T08:00:00Z'),
    bot(1, '2026-11-16T07:00:00Z'),
    { id: 3, body: `${markerFor(day)}\nfalsk`, created_at: '2026-11-16T06:00:00Z', user: { login: 'someone' }, author_association: 'NONE' },
    bot(4, '2026-11-15T07:00:00Z', `${markerFor('2026-11-15')}\ni går`),
  ];
  assert.deepEqual(planComment({ comments, day, body, findings: false }), [
    { op: 'update', id: 1, body },
    { op: 'update', id: 2, body: DUP_BODY },
  ]);
  assert.deepEqual(planComment({ comments: [bot(1, 'x', body)], day, body, findings: true }), []);
});

test('renderCleanup + extractCleanupSection: afsnittet kan genbruges ved naeste koersel', () => {
  const section = renderCleanup({ applied: true, deleted: [{ branch: 'fix/a', sha: 'abcdef1234', pr: 1 }], udskudt: 0, errors: [] }, '2026-11-16');
  assert.match(section, /Slettet: 1 mergede remote branches/);
  assert.match(section, /`fix\/a` \(PR #1, abcdef123\)/);
  const body = `før\n${section}\nefter`;
  assert.equal(extractCleanupSection(body), section);
  assert.equal(extractCleanupSection('intet'), '');
  assert.match(renderCleanup({ error: 'nej' }, '2026-11-16'), /Oprydningen fejlede: nej/);
});

test('renderDraft og hasFindings', () => {
  const r = evaluatePr({ pr: pr(), notes: NOTES, helpIndex: HELP_INDEX });
  const body = renderDraft({ day: '2026-11-16', days: 3, results: [r], masterplan: [], roadmap: null, backups: [], cleanup: '' });
  assert.ok(body.startsWith(markerFor('2026-11-16')));
  assert.match(body, /PR #9001/);
  assert.match(body, /"refs": \[\s*7801\s*\]/);
  assert.match(body, /Ikke tjekket/);
  assert.equal(hasFindings({ results: [r], masterplan: [], roadmap: null, backups: [], cleanup: '' }), true);
  assert.equal(hasFindings({ results: [], masterplan: [], roadmap: { items: [] }, backups: [{ status: 'senere' }], cleanup: '' }), false);
  assert.equal(hasFindings({ results: [], masterplan: [], roadmap: null, backups: [{ status: 'over' }], cleanup: '' }), true);
});

test('fetchRoadmap: uden env springes over; med env kun GET og fejl rapporteres', async () => {
  assert.equal(await fetchRoadmap({ env: {}, issues: [1] }), null);
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, method: opts.method });
    const rows = url.includes('roadmap_items') ? [{ id: 'r', issue_ref: 7, status: 'planned', title_en: 'X' }] : [];
    return { ok: true, json: async () => rows };
  };
  const res = await fetchRoadmap({ fetchImpl, env: { SUPABASE_URL: 'https://db.example/', SUPABASE_SERVICE_KEY: 'k' }, issues: [7, 8] });
  assert.deepEqual(res.items, [{ id: 'r', issue_ref: 7, status: 'planned', title_en: 'X', table: 'roadmap_items' }]);
  assert.ok(seen.every((s) => s.method === 'GET'));
  assert.match(seen[0].url, /issue_ref=in\.\(7,8\)/);
  assert.match(seen[0].url, /flag_key=is\.null/);
  const failing = await fetchRoadmap({ fetchImpl: async () => ({ ok: false, status: 401 }), env: { SUPABASE_URL: 'u', SUPABASE_SERVICE_KEY: 'k' }, issues: [7] });
  assert.match(failing.error, /HTTP 401/);
});

test('runDraft: dry-run skriver intet; --apply opretter én kommentar, naeste koersel opdaterer den', async () => {
  const files = {
    'frontend/src/data/patchNotes.js': PATCH_NOTES,
    'docs/MASTERPLAN.md': '## Rækkefølge\n1. Træning #7801\n',
    'docs/NOW.md': 'slet `backup_1` ~15/11',
    'frontend/public/locales/en/help.json': '{"sections":{"dailytraining":{"label":"Daily training"}}}',
    'frontend/public/locales/da/help.json': '{}',
  };
  const read = (p) => files[p] || '';
  const state = { prs: [pr()], issues: { 7801: { state: 'open', labels: [{ name: 'claude:done' }] } }, comments: [] };
  const now = new Date('2026-11-16T12:00:00Z');
  const opts = { repo: 'o/n', now, env: {}, read, log: () => {} };

  const dry = fakeGh(state);
  const r1 = await runDraft({ ...opts, execGh: dry.exec });
  assert.deepEqual(r1.actions.map((a) => a.op), ['create']);
  assert.equal(dry.calls.filter((c) => c.args[1] === '-X').length, 0);
  assert.match(r1.body, /Patch note mangler/);
  assert.match(r1.body, /#7801 \(PR #9001\) i "Rækkefølge"/);
  assert.match(r1.body, /backup_1/);

  const wet = fakeGh(state);
  await runDraft({ ...opts, execGh: wet.exec, apply: true });
  const posts = wet.calls.filter((c) => c.args[1] === '-X');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].args.slice(0, 4), ['api', '-X', 'POST', 'repos/o/n/issues/7911/comments']);
  const posted = JSON.parse(posts[0].input).body;

  const again = fakeGh({ ...state, comments: [{ id: 77, body: posted, created_at: '2026-11-16T12:00:00Z', user: { login: 'github-actions[bot]' } }] });
  const r3 = await runDraft({ ...opts, execGh: again.exec, apply: true });
  assert.deepEqual(r3.actions, []);
  assert.equal(again.calls.filter((c) => c.args[1] === '-X').length, 0);

  const withCleanup = fakeGh({ ...state, comments: [{ id: 77, body: posted, created_at: '2026-11-16T12:00:00Z', user: { login: 'github-actions[bot]' } }] });
  const env = { CLEANUP_REPORT: JSON.stringify({ applied: true, deleted: [], udskudt: 0, errors: [] }) };
  const r4 = await runDraft({ ...opts, env, execGh: withCleanup.exec, apply: true });
  assert.deepEqual(r4.actions.map((a) => [a.op, a.id]), [['update', 77]]);
  assert.match(r4.body, /Oprydning 16\/11/);
  // Uden ny rapport bevares dagens oprydnings-afsnit.
  const keep = fakeGh({ ...state, comments: [{ id: 77, body: r4.body, created_at: '2026-11-16T12:00:00Z', user: { login: 'github-actions[bot]' } }] });
  const r5 = await runDraft({ ...opts, execGh: keep.exec, apply: true });
  assert.deepEqual(r5.actions, []);
});

test('runDraft: intern PR med Refs til et lukket issue udenfor masterplanen tjekkes stadig i roadmap', async () => {
  const internal = pr({ number: 9002, title: 'chore: leverings-metadata (Refs #7801)', body: 'Refs #7801', files: [{ path: 'scripts/x.mjs' }] });
  const gh = fakeGh({ prs: [internal], issues: { 7801: { state: 'closed', labels: [] } }, comments: [] });
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => (url.includes('roadmap_items') ? [{ id: 'r', issue_ref: 7801, status: 'planned', title_en: 'Levering' }] : []) };
  };
  const r = await runDraft({ execGh: gh.exec, repo: 'o/n', now: new Date('2026-11-16T12:00:00Z'), env: { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'k' }, fetchImpl, read: () => '', log: () => {} });
  assert.ok(seen.some((u) => /issue_ref=in\.\(7801\)/.test(u)));
  assert.match(r.body, /#7801 roadmap-punkt "Levering" står som planned/);
  // Kommentarer hentes ikke for en intern PR (kun #7911-traaden).
  assert.equal(gh.calls.filter((c) => c.args.join(' ').includes('issues/7801/comments')).length, 0);
});

test('fetchIssueStates: 50 issues pr. GraphQL-kald, PR-numre og manglende noder haandteres', () => {
  const issues = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(i + 1), { state: i % 2 ? 'closed' : 'open', labels: [{ name: 'x' }] }]));
  const gh = fakeGh({ issues });
  const map = fetchIssueStates(gh.exec, 'o/n', [...Array.from({ length: 60 }, (_, i) => i + 1), 3, -1]);
  assert.equal(gh.calls.length, 2);
  assert.equal(map.size, 60);
  assert.deepEqual(map.get(1), { number: 1, state: 'open', labels: [{ name: 'x' }] });
  assert.equal(map.get(2).state, 'closed');
  assert.match(gh.calls[0].args.at(-1), /repository\(owner: "o", name: "n"\)/);
});

test('copenhagenDay og parseArgs', () => {
  assert.equal(copenhagenDay(new Date('2026-11-16T23:30:00Z')), '2026-11-17');
  assert.equal(copenhagenDay(new Date('2026-07-01T21:59:00Z')), '2026-07-01');
  assert.deepEqual(parseArgs(['draft', '--days', '2', '--apply']).days, 2);
  assert.equal(parseArgs(['cleanup', '--max', '5']).max, 5);
  assert.throws(() => parseArgs(['nope']), /Brug/);
  assert.throws(() => parseArgs(['draft', '--days', 'x']), /days/);
  assert.throws(() => parseArgs(['draft', '--repo', 'a b']), /repo/);
  assert.throws(() => parseArgs(['draft', '--bogus']), /Ukendt/);
});
