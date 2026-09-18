// scripts/weekly-steering-report.test.mjs
// Tests for soendagsrapport-rutinen (#5328).
//
// Alle gh/node/pwsh/Supabase-kald mockes via injicerede deps - ingen af
// disse tests rammer det virkelige gh CLI, Supabase eller netværket.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REPO,
  classifyPr,
  fetchOpenPrs,
  fetchLastHumanComment,
  formatPrQueueSection,
  isIceboxCandidate,
  groupIceboxCandidates,
  formatIceboxSection,
  extractMasterplanRefs,
  fetchClosedIssueNumbers,
  findClosedWithoutCheckmark,
  findHighPrioWithoutPlads,
  formatMasterplanSection,
  normalizeWords,
  roadmapItemHasPlanReference,
  formatPromiseCheckSection,
  runTokenHygieneCheck,
  formatBudgetSection,
  formatNumbersSection,
  parseArgs,
  generateReport,
  main,
} from './weekly-steering-report.mjs';

const NOW = new Date('2026-09-20T18:00:00Z'); // en soendag

// -------------------------------------------------------------------- classifyPr

test('classifyPr: DIRTY og BLOCKED laeses direkte fra mergeStateStatus', () => {
  assert.equal(classifyPr({ mergeStateStatus: 'DIRTY' }), 'DIRTY');
  assert.equal(classifyPr({ mergeStateStatus: 'BLOCKED' }), 'BLOCKED');
});

test('classifyPr: roede checks flages naar ikke DIRTY/BLOCKED', () => {
  const pr = { mergeStateStatus: 'CLEAN', statusCheckRollup: [{ conclusion: 'FAILURE' }] };
  assert.equal(classifyPr(pr), 'ROEDE-CHECKS');
});

test('classifyPr: draft uden problemer', () => {
  assert.equal(classifyPr({ mergeStateStatus: 'CLEAN', isDraft: true, statusCheckRollup: [] }), 'DRAFT');
});

test('classifyPr: OK naar alt er groent', () => {
  assert.equal(classifyPr({ mergeStateStatus: 'CLEAN', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }), 'OK');
});

// ------------------------------------------------------------------ fetchOpenPrs

test('fetchOpenPrs: kalder gh med korrekt repo + json-felter', () => {
  let calledWith;
  const execGh = (args) => { calledWith = args; return '[]'; };
  fetchOpenPrs(execGh, 'owner/repo');
  assert.deepEqual(calledWith, [
    'pr', 'list',
    '--repo', 'owner/repo',
    '--state', 'open',
    '--json', 'number,title,url,isDraft,mergeStateStatus,statusCheckRollup,updatedAt',
    '--limit', '100',
  ]);
});

// ----------------------------------------------------------- fetchLastHumanComment

test('fetchLastHumanComment: filtrerer bot-kommentarer fra, tager sidste menneske', () => {
  const execGh = () => JSON.stringify({
    comments: [
      { author: { login: 'coderabbitai[bot]' }, body: 'bot-stoej' },
      { author: { login: 'NicolaiDolmer' }, body: 'foerste' },
      { author: { login: 'github-actions' }, body: 'ci-stoej' },
      { author: { login: 'NicolaiDolmer' }, body: 'sidste ord' },
    ],
  });
  const result = fetchLastHumanComment(execGh, 'owner/repo', 42);
  assert.equal(result.author, 'NicolaiDolmer');
  assert.equal(result.body, 'sidste ord');
});

test('fetchLastHumanComment: null naar kun bots har kommenteret', () => {
  const execGh = () => JSON.stringify({ comments: [{ author: { login: 'dependabot[bot]' }, body: 'x' }] });
  assert.equal(fetchLastHumanComment(execGh, 'owner/repo', 1), null);
});

test('fetchLastHumanComment: null naar gh-kaldet fejler (isoleret, ikke fatalt)', () => {
  const execGh = () => { throw new Error('rate limited'); };
  assert.equal(fetchLastHumanComment(execGh, 'owner/repo', 1), null);
});

// -------------------------------------------------------------- formatPrQueueSection

test('formatPrQueueSection: ingen PRer', () => {
  assert.match(formatPrQueueSection([], new Map()), /✅/);
});

test('formatPrQueueSection: taeller BLOCKED/DIRTY korrekt', () => {
  const prs = [
    { number: 1, title: 'a', mergeStateStatus: 'BLOCKED', statusCheckRollup: [] },
    { number: 2, title: 'b', mergeStateStatus: 'DIRTY', statusCheckRollup: [] },
    { number: 3, title: 'c', mergeStateStatus: 'CLEAN', statusCheckRollup: [] },
  ];
  const out = formatPrQueueSection(prs, new Map());
  assert.match(out, /1 BLOCKED, 1 DIRTY af 3 aabne/);
});

// -------------------------------------------------------------- icebox-kandidater

test('isIceboxCandidate: udelukker MASTERPLAN-refererede, bug, spillerfund, epic', () => {
  const masterplanNumbers = new Set([100]);
  assert.equal(isIceboxCandidate({ number: 100, labels: [] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 1, labels: [{ name: 'type:bug' }] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 2, labels: [{ name: 'cat:spillerfund' }] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 3, labels: [{ name: 'epic:foo' }] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 4, labels: [{ name: 'epic' }] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 5, labels: [{ name: 'cat:ui' }] }, masterplanNumbers), true);
});

test('isIceboxCandidate: haandterer bare label-strenge (ikke kun {name})', () => {
  const masterplanNumbers = new Set();
  assert.equal(isIceboxCandidate({ number: 1, labels: ['type:bug'] }, masterplanNumbers), false);
  assert.equal(isIceboxCandidate({ number: 2, labels: ['cat:ui'] }, masterplanNumbers), true);
});

test('groupIceboxCandidates: grupperer pr. foerste cat:-label, ellers uden-omraade', () => {
  const issues = [
    { number: 1, labels: [{ name: 'cat:ui' }] },
    { number: 2, labels: [{ name: 'cat:ui' }] },
    { number: 3, labels: [{ name: 'cat:backend' }] },
    { number: 4, labels: [] },
  ];
  const groups = groupIceboxCandidates(issues);
  assert.equal(groups.get('cat:ui').length, 2);
  assert.equal(groups.get('cat:backend').length, 1);
  assert.equal(groups.get('(uden omraade-label)').length, 1);
});

test('formatIceboxSection: tom liste', () => {
  assert.match(formatIceboxSection(new Map()), /Ingen icebox-kandidater/);
});

test('formatIceboxSection: viser total + issue-numre pr. gruppe', () => {
  const groups = new Map([['cat:ui', [{ number: 1 }, { number: 2 }]]]);
  const out = formatIceboxSection(groups);
  assert.match(out, /2 icebox-kandidat/);
  assert.match(out, /`#1`, `#2`/);
});

// ------------------------------------------------------------- MASTERPLAN-krydstjek

test('extractMasterplanRefs: ✅ i samme segment markerer alle #N i segmentet som checket', () => {
  const md = '✅ #100 lukket · #200 stadig aaben\nAnden linje uden markering #300';
  const refs = extractMasterplanRefs(md);
  assert.equal(refs.get(100), true);
  assert.equal(refs.get(200), false); // "·" adskiller segmentet fra ✅'et
  assert.equal(refs.get(300), false);
});

test('extractMasterplanRefs: samme nummer nævnt flere gange - checket ét sted er nok', () => {
  const md = '#42 under arbejde\n✅ #42 faerdig nu';
  const refs = extractMasterplanRefs(md);
  assert.equal(refs.get(42), true);
});

test('extractMasterplanRefs: ingen referencer giver tomt map', () => {
  assert.equal(extractMasterplanRefs('ingen numre her').size, 0);
});

test('findClosedWithoutCheckmark: kun lukkede OG ikke-checkede numre', () => {
  const refs = new Map([[1, false], [2, true], [3, false]]);
  const closedIssueNumbers = new Set([1, 2]); // 3 er ikke i sættet -> aaben
  assert.deepEqual(findClosedWithoutCheckmark(refs, closedIssueNumbers), [1]);
});

test('fetchClosedIssueNumbers: kalder gh med korrekt repo/state/limit, saetter hitLimit ved fuldt svar', () => {
  let calledWith;
  const execGh = (args) => { calledWith = args; return JSON.stringify([{ number: 1 }, { number: 2 }]); };
  const { numbers, hitLimit } = fetchClosedIssueNumbers(execGh, 'owner/repo', 2);
  assert.deepEqual(calledWith, ['issue', 'list', '--repo', 'owner/repo', '--state', 'closed', '--json', 'number', '--limit', '2']);
  assert.deepEqual([...numbers].sort(), [1, 2]);
  assert.equal(hitLimit, true); // 2 resultater == loftet 2 -> kan vaere afskaaret
});

test('fetchClosedIssueNumbers: hitLimit=false naar svaret er under loftet', () => {
  const execGh = () => JSON.stringify([{ number: 1 }]);
  const { hitLimit } = fetchClosedIssueNumbers(execGh, 'owner/repo', 10);
  assert.equal(hitLimit, false);
});

test('findHighPrioWithoutPlads: filtrerer issues der IKKE er i MASTERPLAN-refs', () => {
  const refs = new Map([[1, false]]);
  const openHighPrio = [{ number: 1, title: 'a' }, { number: 2, title: 'b' }];
  const result = findHighPrioWithoutPlads(openHighPrio, refs);
  assert.deepEqual(result.map((i) => i.number), [2]);
});

test('formatMasterplanSection: begge grene groent', () => {
  const out = formatMasterplanSection({ closedWithoutCheckmark: [], highPrioWithoutPlads: [] });
  assert.match(out, /Ingen lukkede issues uden ✅/);
  assert.match(out, /Ingen aabne `priority:high`/);
});

test('formatMasterplanSection: fund vises med issue-numre', () => {
  const out = formatMasterplanSection({ closedWithoutCheckmark: [5, 9], highPrioWithoutPlads: [{ number: 12, title: 'x' }] });
  assert.match(out, /`#5`, `#9`/);
  assert.match(out, /`#12`/);
});

// ------------------------------------------------------------------- loefte-tjek

test('normalizeWords: fjerner korte ord og stopord, lowercase, splitter paa ikke-bogstaver', () => {
  const words = normalizeWords('Dette er en kalender-fornyelse med traening');
  assert.deepEqual(words, ['kalender', 'fornyelse', 'traening']);
  assert.ok(!words.includes('med'));
  assert.ok(!words.includes('en'));
  assert.ok(!words.includes('er'));
  assert.ok(!words.includes('dette')); // stopord
});

test('roadmapItemHasPlanReference: finder match ved nok ord-overlap (ordret genbrug af titel-ord)', () => {
  const item = { title_da: 'Ungdomsakademi traening' };
  const masterplanText = 'Akademi: #5145 ungdomsakademi traening for unge spillere';
  const { hasReference, hits } = roadmapItemHasPlanReference(item, masterplanText);
  assert.equal(hits, 2);
  assert.equal(hasReference, true);
});

test('roadmapItemHasPlanReference: heuristikkens graense - engelsk titel mod dansk MASTERPLAN-tekst overlapper ofte IKKE (kendt begraensning, se caveat i filens header)', () => {
  const item = { title_en: 'Youth academy training' };
  const masterplanText = 'Akademi: #5145 traening for unge spillere'; // "academy" != "akademi", kun "training"~"traening" er ord-forskellige
  const { hasReference } = roadmapItemHasPlanReference(item, masterplanText);
  assert.equal(hasReference, false); // dokumenterer begraensningen, ikke et krav
});

test('roadmapItemHasPlanReference: ingen match uden overlap', () => {
  const item = { title_en: 'Completely unrelated feature xyz' };
  const masterplanText = 'Noget helt andet indhold uden overlap';
  const { hasReference } = roadmapItemHasPlanReference(item, masterplanText);
  assert.equal(hasReference, false);
});

test('roadmapItemHasPlanReference: tom titel giver ingen reference', () => {
  assert.equal(roadmapItemHasPlanReference({}, 'noget tekst').hasReference, false);
});

test('formatPromiseCheckSection: uden Supabase-env skriver forklaring', () => {
  const out = formatPromiseCheckSection([], '', false);
  assert.match(out, /sprunget over/);
});

test('formatPromiseCheckSection: alle loefter matcher giver groent', () => {
  const items = [{ id: 1, title_en: 'kalender fornyelse projekt' }];
  const out = formatPromiseCheckSection(items, 'stor tekst om kalender fornyelse projekt', true);
  assert.match(out, /Ingen loefter uden tekst-match i MASTERPLAN\.md/);
});

// ------------------------------------------------------------------------- budget

test('runTokenHygieneCheck: ok=true naar pwsh ikke kaster', () => {
  const execPwsh = () => 'Summary: 0 fail, 2 warn, 5 ok';
  const result = runTokenHygieneCheck(execPwsh);
  assert.equal(result.ok, true);
});

test('runTokenHygieneCheck: ok=false naar pwsh kaster (fx exit 1)', () => {
  const execPwsh = () => { const e = new Error('exit 1'); e.stdout = 'Summary: 1 fail, 0 warn'; throw e; };
  const result = runTokenHygieneCheck(execPwsh);
  assert.equal(result.ok, false);
  assert.match(result.output, /1 fail/);
});

test('formatBudgetSection: PASS/FAIL + summary-linje', () => {
  assert.match(formatBudgetSection({ ok: true, output: 'Summary: 0 fail, 1 warn, 3 ok' }), /PASS.*0 fail/);
  assert.match(formatBudgetSection({ ok: false, output: 'Summary: 1 fail' }), /FAIL.*1 fail/);
});

// ----------------------------------------------------------------------- numbers

test('formatNumbersSection: uden Supabase-env forklarer fallback (ingen MCP fra script)', () => {
  const out = formatNumbersSection({ ok: false }, false);
  assert.match(out, /ikke sat/);
  assert.match(out, /infisical/);
});

test('formatNumbersSection: fejl fra monday-numbers.mjs vises', () => {
  const out = formatNumbersSection({ ok: false, error: 'boom' }, true);
  assert.match(out, /boom/);
});

// -------------------------------------------------------------------------- parseArgs

test('parseArgs: defaults', () => {
  const args = parseArgs([]);
  assert.equal(args.repo, DEFAULT_REPO);
  assert.equal(args.out, null);
  assert.equal(args.skipNumbers, false);
});

test('parseArgs: --skip-numbers/--out/--repo/--now/--days', () => {
  const args = parseArgs(['--skip-numbers', '--out', 'x.md', '--repo', 'a/b', '--now', '2026-01-01', '--days', '10']);
  assert.equal(args.skipNumbers, true);
  assert.equal(args.out, 'x.md');
  assert.equal(args.repo, 'a/b');
  assert.equal(args.days, 10);
});

// ---------------------------------------------------------------------- generateReport

test('generateReport: samler alle 7 sektioner (fuldt mockede deps, ingen Supabase-env)', async () => {
  const deps = {
    execGh: (args) => {
      if (args[0] === 'pr') return '[]';
      if (args[0] === 'issue' && args.includes('priority:low')) return '[]';
      if (args[0] === 'issue' && args.includes('priority:high')) return '[]';
      if (args[0] === 'issue') return '[]'; // triage:new
      return '[]';
    },
    execNode: () => { throw new Error('skal ikke kaldes uden Supabase-env'); },
    execPwsh: () => 'Summary: 0 fail, 0 warn, 5 ok',
    readFile: () => '# MASTERPLAN\nIngen refs her.',
  };
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    const report = await generateReport({ repo: DEFAULT_REPO, now: NOW, days: 7, skipNumbers: false }, deps);
    for (const heading of ['## 1. Tal', '## 2. PR-koe', '## 3. Triage-kandidater', '## 4. Icebox-kandidater', '## 5. MASTERPLAN mod GitHub', '## 6. Loefte-tjek', '## 7. Budget']) {
      assert.ok(report.includes(heading), `mangler sektion: ${heading}`);
    }
    assert.match(report, /Read-only/);
  } finally {
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_KEY = savedKey;
  }
});

test('generateReport: en fejlende gh-hentning noteres i "Forbehold", vaelter ikke resten af rapporten', async () => {
  const deps = {
    execGh: (args) => {
      if (args[0] === 'pr') throw new Error('gh: rate limited');
      return '[]';
    },
    execPwsh: () => 'Summary: 0 fail',
    readFile: () => '# MASTERPLAN',
  };
  const report = await generateReport({ repo: DEFAULT_REPO, now: NOW, days: 7, skipNumbers: true }, deps);
  assert.match(report, /Forbehold under koerslen/);
  assert.match(report, /rate limited/);
  assert.ok(report.includes('## 7. Budget')); // resten af rapporten blev stadig bygget
});

// ---------------------------------------------------------------------------- main

test('main: exit 2 ved ugyldige argumenter', async () => {
  const errors = [];
  const code = await main(['--days', 'nope'], { errorLog: (e) => errors.push(e) });
  assert.equal(code, 2);
  assert.equal(errors.length, 1);
});

test('main: exit 0 og skriver til stdout uden --out', async () => {
  const logs = [];
  const deps = {
    execGh: () => '[]',
    execPwsh: () => 'Summary: 0 fail',
    readFile: () => '# MASTERPLAN',
    log: (l) => logs.push(l),
    errorLog: () => {},
  };
  const code = await main(['--skip-numbers', '--now', NOW.toISOString()], deps);
  assert.equal(code, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Styringsrapport/);
});

test('main: --out skriver fil via injiceret writeFile/mkdir', async () => {
  const logs = [];
  const written = {};
  const deps = {
    execGh: () => '[]',
    execPwsh: () => 'Summary: 0 fail',
    readFile: () => '# MASTERPLAN',
    writeFile: (path, content) => { written.path = path; written.content = content; },
    mkdir: () => {},
    log: (l) => logs.push(l),
    errorLog: () => {},
  };
  const code = await main(['--skip-numbers', '--now', NOW.toISOString(), '--out', 'docs/audits/2026-09-20-styringsrapport.md'], deps);
  assert.equal(code, 0);
  assert.equal(written.path, 'docs/audits/2026-09-20-styringsrapport.md');
  assert.match(written.content, /Styringsrapport/);
  assert.match(logs[0], /Skrev docs\/audits/);
});
