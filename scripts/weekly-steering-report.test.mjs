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
  computePlayerSignal,
  formatPlayerSignalSection,
} from './weekly-steering-report.mjs';

// ---------------------------------------------------------------- spillersignal (#7783)

const SIG_NOW = new Date('2026-11-08T18:00:00Z');
const DAYS_AGO = (d) => new Date(SIG_NOW.getTime() - d * 86400000).toISOString();

// Syntetiske data: 12 aktive managere (u1..u12), 1 inaktiv, 1 admin, 1 AI.
function buildSignalData() {
  const users = [];
  const teams = [];
  for (let i = 1; i <= 12; i += 1) {
    users.push({ id: `u${i}`, role: 'manager', last_seen: DAYS_AGO(1) });
    teams.push({ id: `t${i}`, user_id: `u${i}`, is_ai: false, is_test_account: false, is_bank: false });
  }
  users.push({ id: 'old', role: 'manager', last_seen: DAYS_AGO(40) });
  teams.push({ id: 'told', user_id: 'old', is_ai: false });
  users.push({ id: 'adm', role: 'admin', last_seen: DAYS_AGO(0) });
  teams.push({ id: 'tadm', user_id: 'adm', is_ai: false });
  users.push({ id: 'ai', role: 'manager', last_seen: DAYS_AGO(0) });
  teams.push({ id: 'tai', user_id: 'ai', is_ai: true });

  const items = [
    { id: 'hi', issue_ref: 111, title_da: 'Hoej | prioritet #5', title_en: 'High', status: 'active', approved: true, created_at: DAYS_AGO(90) },
    { id: 'lo', issue_ref: 222, title_da: 'Lav prioritet', title_en: 'Low', status: 'planned', approved: true, created_at: DAYS_AGO(90) },
    { id: 'new', issue_ref: 333, title_da: 'Nyt punkt', title_en: 'New', status: 'active', approved: true, created_at: DAYS_AGO(2) },
    { id: 'done', issue_ref: 444, title_da: 'Leveret', title_en: 'Shipped', status: 'shipped', approved: true, created_at: DAYS_AGO(90) },
    { id: 'draft', issue_ref: 666, title_da: 'Hemmelig kladde', title_en: 'Draft', status: 'active', approved: false, created_at: DAYS_AGO(1) },
  ];

  // Hver aktiv manager stemmer paa 12 punkter (10 fyldstof + hi + lo) saa de har eget snit.
  const votes = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let f = 0; f < 10; f += 1) {
      votes.push({ item_id: `filler${f}`, user_id: `u${i}`, importance_score: 3, created_at: DAYS_AGO(30), updated_at: DAYS_AGO(30) });
    }
    votes.push({ item_id: 'hi', user_id: `u${i}`, importance_score: 6, created_at: DAYS_AGO(20), updated_at: i <= 3 ? DAYS_AGO(1) : DAYS_AGO(20) });
    votes.push({ item_id: 'lo', user_id: `u${i}`, importance_score: 1, created_at: DAYS_AGO(20), updated_at: DAYS_AGO(20) });
  }
  // 3 stemmer paa det nye punkt (under graensen)
  for (const u of ['u1', 'u2', 'u3']) {
    votes.push({ item_id: 'new', user_id: u, importance_score: 5, created_at: DAYS_AGO(1), updated_at: DAYS_AGO(1) });
  }
  // stemmer fra inaktiv/admin/AI skal ignoreres
  for (const u of ['old', 'adm', 'ai']) {
    for (let f = 0; f < 12; f += 1) votes.push({ item_id: 'hi', user_id: u, importance_score: 1, created_at: DAYS_AGO(5), updated_at: DAYS_AGO(5) });
  }

  const issues = [
    { id: 'k1', issue_ref: 555, title_da: 'Aaben fejl', title_en: 'Open bug', status: 'confirmed', published: true },
    { id: 'k2', issue_ref: 556, title_da: 'Lukket fejl', title_en: 'Fixed bug', status: 'fixed', published: true },
    { id: 'k3', issue_ref: null, title_da: 'Ikke publiceret', title_en: 'Hidden', status: 'checking', published: false },
  ];
  const reports = [
    { issue_id: 'k1', user_id: 'u1' },
    { issue_id: 'k1', user_id: 'u2' },
    { issue_id: 'k1', user_id: 'u2' }, // dublet taelles ikke to gange
    { issue_id: 'k2', user_id: 'u3' },
  ];
  return { users, teams, votes, items, issues, reports, feedbackNew: 7 };
}

test('computePlayerSignal: daekning taeller kun aktive managere (ikke admin/AI/inaktive)', () => {
  const s = computePlayerSignal(buildSignalData(), SIG_NOW, new Set());
  assert.equal(s.coverage.eligible, 13); // 12 + den inaktive; admin og AI er ude
  assert.equal(s.coverage.active7, 12);
  assert.equal(s.coverage.voted7, 3); // kun u1-u3 har aendret/afgivet stemmer inden for 7 dage
  assert.equal(s.coverage.voted30, 12);
  assert.equal(s.feedbackNew, 7);
});

test('computePlayerSignal: top/bund rangerer kun punkter med mindst 10 stemmere, nye holdes for sig', () => {
  const s = computePlayerSignal(buildSignalData(), SIG_NOW, new Set());
  assert.deepEqual(s.top.map((t) => t.id), ['hi', 'lo']);
  assert.equal(s.top[0].voters, 12); // inaktiv/admin/AI-stemmer taeller ikke
  assert.ok(s.top[0].lift > 0 && s.top[1].lift < 0);
  assert.equal(s.thinCount, 1);
  assert.equal(s.thin[0].id, 'new');
  assert.ok(!s.top.some((t) => t.id === 'done'), 'leverede punkter rangeres ikke');
});

test('computePlayerSignal: flyttet mest sammenligner mod stemmer uaendret siden for 7 dage siden', () => {
  const s = computePlayerSignal(buildSignalData(), SIG_NOW, new Set());
  // u1-u3 har aendret i ugen, men alle gav 6, saa snittet er uaendret: ingen flyt.
  assert.equal(s.movedMost.length, 0);
});

test('computePlayerSignal: hoeje punkter uden for MASTERPLAN krydstjekkes paa issue_ref', () => {
  const data = buildSignalData();
  assert.deepEqual(computePlayerSignal(data, SIG_NOW, new Set()).outsidePlan.map((t) => t.id), ['hi']);
  assert.deepEqual(computePlayerSignal(data, SIG_NOW, new Set([111])).outsidePlan, []);
});

test('computePlayerSignal: aabne fejl taeller unikke spillere og ignorerer lukkede/upublicerede', () => {
  const s = computePlayerSignal(buildSignalData(), SIG_NOW, new Set());
  assert.equal(s.openIssues.total, 1);
  assert.equal(s.openIssues.top[0].reports, 2);
});

test('formatPlayerSignalSection: kun tal og titler, aldrig user_id, og pipe/#N i titler escapes', () => {
  const out = formatPlayerSignalSection(computePlayerSignal(buildSignalData(), SIG_NOW, new Set()), true);
  for (const heading of ['### Dækning', '### Top 10', '### Bund 5', '### Flyttet mest', '### Åbne fejl', '### Ubehandlet feedback', '### Høje punkter uden for MASTERPLAN']) {
    assert.ok(out.includes(heading), `mangler ${heading}`);
  }
  assert.ok(!/\bu\d+\b/.test(out), 'user_id lækket');
  assert.ok(out.includes('Hoej \\| prioritet `#5`'));
  assert.match(out, /7 feedback-besked/);
});

test('formatPlayerSignalSection: uden env forklarer og springer over', () => {
  assert.match(formatPlayerSignalSection(null, false), /ikke sat/);
});

test('generateReport: sektion 8 bruger injiceret hentning og fanger fejl uden at vaelte rapporten', async () => {
  const saved = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY];
  process.env.SUPABASE_URL = 'http://test.invalid';
  process.env.SUPABASE_SERVICE_KEY = 'x';
  const base = {
    execGh: () => '[]',
    execNode: () => 'tal',
    execPwsh: () => 'Summary: 0 fail',
    readFile: () => '# MASTERPLAN #111',
    fetchActiveRoadmapItems: async () => [],
  };
  try {
    const ok = await generateReport({ repo: DEFAULT_REPO, now: SIG_NOW, days: 7, skipNumbers: true }, { ...base, fetchPlayerSignalData: async () => buildSignalData() });
    assert.ok(ok.includes('## 8. Spillersignal'));
    assert.ok(ok.includes('### Dækning'));
    assert.match(ok.split('### Høje punkter uden for MASTERPLAN')[1], /Ingen\. ✅/); // #111 staar i MASTERPLAN

    const bad = await generateReport({ repo: DEFAULT_REPO, now: SIG_NOW, days: 7, skipNumbers: true }, { ...base, fetchPlayerSignalData: async () => { throw new Error('db nede'); } });
    assert.match(bad, /Spillersignal kunne ikke hentes: db nede/);
    assert.ok(bad.includes('## 7. Budget'));
  } finally {
    if (saved[0] === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved[0];
    if (saved[1] === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = saved[1];
  }
});

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

test('computePlayerSignal: ikke-godkendte kladder (fx fra split) vises aldrig i den offentlige rapport', () => {
  const data = buildSignalData();
  data.votes.push({ item_id: 'draft', user_id: 'u1', importance_score: 6, created_at: DAYS_AGO(1), updated_at: DAYS_AGO(1) });
  const out = formatPlayerSignalSection(computePlayerSignal(data, SIG_NOW, new Set()), true);
  assert.ok(!out.includes('Hemmelig kladde'));
  assert.ok(!out.includes('666'));
});
