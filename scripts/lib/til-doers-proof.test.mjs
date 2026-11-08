// node --test scripts/lib/til-doers-proof.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROOF_MARKER_PREFIX,
  DRAFT_PREFIX,
  proofMarker,
  parseProofMarker,
  sameSha,
  parseProofDeclarations,
  proofDeclarationsForPr,
  declarationFor,
  evaluateSideProof,
  evaluateProdProof,
  evaluateProof,
  renderProofLine,
  renderProofComment,
  planProofComment,
  oneLine,
  flatLine,
  findProofOverdue,
} from './til-doers-proof.mjs';
import { MARKER, MARKER_LINE, parseMarkers } from './til-doers.mjs';

const N = 4242;
const PR = 77;
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const fence = (inner, lang = 'til-doers-proof') => ['```' + lang, ...inner, '```'].join('\n');
const goodBlock = fence([
  `issue: ${N}`,
  'side: /team | selector [data-testid="squad-table"]',
  'side: /team | tekst Trup',
  'prod: GET https://cyclingzone.org/api/health -> 200',
]);
const decl = () => declarationFor(parseProofDeclarations(goodBlock), N);
const goodSide = () => ({
  buildSha: SHA.slice(0, 9),
  loggedIn: true,
  mocks: false,
  results: [
    { path: '/team', kind: 'selector', value: '[data-testid="squad-table"]', found: true },
    { path: '/team', kind: 'tekst', value: 'Trup', found: true },
  ],
});
const goodProd = () => ({
  deployVerify: { conclusion: 'success', sha: SHA },
  results: [{ method: 'GET', url: 'https://cyclingzone.org/api/health', status: 200 }],
});

// ---------------------------------------------------------------- markoer

test('proofMarker har det aftalte format og kan læses tilbage', () => {
  const m = proofMarker({ pr: PR, issue: N, sha: SHA.toUpperCase() });
  assert.equal(m, `<!-- til-doers-proof:v1 pr=${PR} issue=${N} sha=${SHA} -->`);
  assert.ok(m.startsWith(PROOF_MARKER_PREFIX));
  assert.deepEqual(parseProofMarker(`x\n${m}\ny`), { pr: PR, issue: N, sha: SHA });
  assert.equal(parseProofMarker('<!-- til-doers-proof:v1 pr=1 issue=x sha=abc -->'), null);
  assert.throws(() => proofMarker({ pr: 0, issue: N, sha: SHA }), /positive/);
  assert.throws(() => proofMarker({ pr: PR, issue: N, sha: 'main' }), /hex-sha/);
});

test('sameSha: præfiks på mindst 7 tegn, aldrig tom eller ugyldig', () => {
  assert.equal(sameSha(SHA, SHA.slice(0, 7)), true);
  assert.equal(sameSha(SHA.slice(0, 9).toUpperCase(), SHA), true);
  assert.equal(sameSha(SHA, SHA.slice(0, 6)), false);
  assert.equal(sameSha(SHA, '1234567'), false);
  assert.equal(sameSha('', ''), false);
  assert.equal(sameSha(null, SHA), false);
});

// ---------------------------------------------------------------- deklaration

test('parseProofDeclarations læser issue, side og prod', () => {
  const { declarations, errors } = parseProofDeclarations(`Tekst\n\n${goodBlock}\n\nRefs #${N}`);
  assert.deepEqual(errors, []);
  assert.equal(declarations.length, 1);
  const d = declarations[0];
  assert.equal(d.issue, N);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.sides, [
    { path: '/team', kind: 'selector', value: '[data-testid="squad-table"]' },
    { path: '/team', kind: 'tekst', value: 'Trup' },
  ]);
  assert.deepEqual(d.prods, [{ method: 'GET', url: 'https://cyclingzone.org/api/health', status: 200 }]);
});

test('parseProofDeclarations tåler CRLF, #N, "text" og relativ prod-rute', () => {
  const body = fence([`issue: #${N}`, 'side: /a | text Hej', 'prod: get /api/health -> 204']).replace(/\n/g, '\r\n');
  const d = parseProofDeclarations(body).declarations[0];
  assert.equal(d.issue, N);
  assert.deepEqual(d.errors, []);
  assert.equal(d.sides[0].kind, 'tekst');
  assert.deepEqual(d.prods[0], { method: 'GET', url: '/api/health', status: 204 });
});

test('side-tjek uden selector eller tekst afvises', () => {
  for (const line of ['side: /team', 'side: /team |', 'side: /team | selector', 'side: /team | farve rød']) {
    const d = parseProofDeclarations(fence([`issue: ${N}`, line])).declarations[0];
    assert.equal(d.sides.length, 0, line);
    assert.match(d.errors.join('\n'), /uden selector eller tekst afvises/, line);
  }
});

test('side skal være en rute, ikke en ekstern URL', () => {
  const d = parseProofDeclarations(fence([`issue: ${N}`, 'side: https://evil.example | tekst x', 'side: //evil.example | tekst x'])).declarations[0];
  assert.equal(d.sides.length, 0);
  assert.equal(d.errors.length, 2);
});

test('kun GET: POST, DELETE og andre metoder afvises', () => {
  for (const m of ['POST', 'DELETE', 'PUT', 'PATCH', 'HEAD']) {
    const d = parseProofDeclarations(fence([`issue: ${N}`, `prod: ${m} https://cyclingzone.org/api/x -> 200`])).declarations[0];
    assert.equal(d.prods.length, 0, m);
    assert.match(d.errors.join('\n'), /kun GET/, m);
  }
});

test('prod-URL: kun https uden login-oplysninger, og status skal være gyldig', () => {
  const bad = [
    'prod: GET http://cyclingzone.org/x -> 200',
    'prod: GET https://user:pw@cyclingzone.org/x -> 200',
    'prod: GET ftp://x -> 200',
    'prod: GET https://cyclingzone.org/x -> 999',
    'prod: GET https://cyclingzone.org/x 200',
  ];
  const d = parseProofDeclarations(fence([`issue: ${N}`, ...bad])).declarations[0];
  assert.equal(d.prods.length, 0);
  assert.equal(d.errors.length, bad.length);
});

test('blok uden issue, ukendte linjer, tom blok og ulukket blok giver fejl', () => {
  assert.match(parseProofDeclarations(fence(['side: /a | tekst x'])).errors[0], /uden issue/);
  const unknown = parseProofDeclarations(fence([`issue: ${N}`, 'side: /a | tekst x', 'post: /a'])).declarations[0];
  assert.match(unknown.errors[0], /ukendt linje/);
  assert.match(parseProofDeclarations(fence([`issue: ${N}`])).declarations[0].errors[0], /ingen tjek/);
  assert.match(parseProofDeclarations('```til-doers-proof\nissue: 1\n').errors[0], /ikke lukket/);
  const two = parseProofDeclarations(fence([`issue: ${N}`, 'issue: 5', 'side: /a | tekst x'])).declarations[0];
  assert.match(two.errors[0], /kun ét issue/);
});

test('Codex P2: en ulukket eller issue-løs blok gør alle deklarationer til udkast', () => {
  const unclosed = `${goodBlock}\n\n\`\`\`til-doers-proof\nissue: ${N}\nprod: GET /api/ekstra -> 200\n`;
  const parsed = parseProofDeclarations(unclosed);
  assert.match(parsed.errors[0], /ikke lukket/);
  const d = declarationFor(parsed, N);
  assert.match(d.errors.join('\n'), /ugyldig til-doers-proof-blok/);
  assert.equal(evaluateProdProof({ declaration: d, sha: SHA, prod: goodProd() }).udfald, 'udkast');
  assert.equal(evaluateSideProof({ declaration: d, sha: SHA, side: goodSide() }).udfald, 'udkast');
  const noIssue = declarationFor(parseProofDeclarations(`${goodBlock}\n${fence(['prod: GET /api/x -> 200'])}`), N);
  assert.equal(evaluateProdProof({ declaration: noIssue, sha: SHA, prod: goodProd() }).udfald, 'udkast');
});

test('andre kodeblokke ignoreres, og flere blokke for samme issue slås sammen', () => {
  const body = [fence(['issue: 1', 'side: /x | tekst y'], 'js'), fence([`issue: ${N}`, 'side: /a | tekst x']), fence([`issue: ${N}`, 'prod: GET /api/h -> 200']), fence(['issue: 9', 'side: /b | tekst z'])].join('\n\n');
  const { declarations } = parseProofDeclarations(body);
  assert.deepEqual(declarations.map((d) => d.issue), [9, N]);
  const d = declarationFor({ declarations }, N);
  assert.equal(d.sides.length, 1);
  assert.equal(d.prods.length, 1);
  assert.equal(declarationFor({ declarations }, 1), null);
});

test('en blok for et issue PR\'en ikke refererer får en fejl', () => {
  const body = `${fence(['issue: 999', 'side: /a | tekst x'])}\n${goodBlock}\nRefs #${N}`;
  const parsed = proofDeclarationsForPr({ title: 'ops: x', body });
  assert.deepEqual(declarationFor(parsed, N).errors, []);
  assert.match(declarationFor(parsed, 999).errors[0], /refererer ikke #999/);
  const scoped = proofDeclarationsForPr({ title: `fix(${N}): x`, body: goodBlock });
  assert.deepEqual(declarationFor(scoped, N).errors, []);
});

// ---------------------------------------------------------------- krav 4

test('krav 4 ok kun med erklæret tjek, merge-SHA, logget ind, uden mocks og fundet', () => {
  const r = evaluateSideProof({ declaration: decl(), sha: SHA, side: goodSide() });
  assert.equal(r.udfald, 'ok');
  assert.match(r.tekst, /\/team selector/);
  assert.match(r.tekst, /abcdef1/);
});

test('krav 4 bliver udkast når forholdene ikke holder', () => {
  const cases = [
    [{ declaration: null, side: goodSide() }, /ingen til-doers-proof-deklaration/],
    [{ declaration: { ...decl(), sides: [] }, side: { ...goodSide(), derived: ['/team', '/board'] } }, /ingen erklæret side-tjek.*udledte sider.*\/board/],
    [{ declaration: decl(), side: null }, /ikke kørt/],
    [{ declaration: decl(), side: { ...goodSide(), buildSha: '1234567' } }, /ikke fra merge-SHA/],
    [{ declaration: decl(), side: { ...goodSide(), buildSha: undefined } }, /ikke fra merge-SHA/],
    [{ declaration: decl(), side: { ...goodSide(), loggedIn: false } }, /ikke logget ind/],
    [{ declaration: decl(), side: { ...goodSide(), mocks: true } }, /mocks/],
    [{ declaration: decl(), side: { ...goodSide(), mocks: undefined } }, /mocks/],
    [{ declaration: { ...decl(), errors: ['linje 3: noget'] }, side: goodSide() }, /deklarationen har fejl/],
    [{ declaration: decl(), side: { ...goodSide(), results: [goodSide().results[0]] } }, /kunne ikke køre: \/team tekst Trup/],
    [{ declaration: decl(), side: { ...goodSide(), results: [goodSide().results[0], { ...goodSide().results[1], found: undefined, error: 'timeout' }] } }, /timeout/],
  ];
  for (const [input, re] of cases) {
    const r = evaluateSideProof({ sha: SHA, ...input });
    assert.equal(r.udfald, 'udkast', String(re));
    assert.match(r.tekst, re);
  }
});

test('krav 4 mangler når et tjek kørte under rigtige forhold og ikke blev fundet', () => {
  const side = goodSide();
  side.results[1].found = false;
  const r = evaluateSideProof({ declaration: decl(), sha: SHA, side });
  assert.equal(r.udfald, 'mangler');
  assert.match(r.tekst, /ikke fundet.*Trup/);
  // forkert build vejer tungere end et ikke-fundet: et andet build beviser intet
  assert.equal(evaluateSideProof({ declaration: decl(), sha: SHA, side: { ...side, buildSha: '1234567' } }).udfald, 'udkast');
});

// ---------------------------------------------------------------- krav 8

test('krav 8 ok kun når alle prod-tjek består efter grøn Deploy verify', () => {
  const r = evaluateProdProof({ declaration: decl(), sha: SHA, prod: goodProd() });
  assert.equal(r.udfald, 'ok');
  assert.match(r.tekst, /GET https:\/\/cyclingzone\.org\/api\/health -> 200 efter grøn Deploy verify/);
  const later = { ...goodProd(), deployVerify: { conclusion: 'success', sha: '9999999', containsMerge: true } };
  assert.equal(evaluateProdProof({ declaration: decl(), sha: SHA, prod: later }).udfald, 'ok');
});

test('krav 8 bliver udkast uden grøn Deploy verify, uden deklaration eller når et tjek ikke kørte', () => {
  const cases = [
    [{ declaration: null, prod: goodProd() }, /ingen til-doers-proof-deklaration/],
    [{ declaration: { ...decl(), prods: [] }, prod: goodProd() }, /ingen erklæret prod-tjek/],
    [{ declaration: decl(), prod: null }, /Deploy verify er ikke grøn \(ikke kørt\)/],
    [{ declaration: decl(), prod: { ...goodProd(), deployVerify: { conclusion: 'failure', sha: SHA } } }, /ikke grøn \(failure\)/],
    [{ declaration: decl(), prod: { ...goodProd(), deployVerify: { conclusion: null, sha: SHA } } }, /ikke grøn/],
    [{ declaration: decl(), prod: { ...goodProd(), deployVerify: { conclusion: 'success', sha: '9999999' } } }, /dækker ikke merge-SHA/],
    [{ declaration: decl(), prod: { ...goodProd(), results: [] } }, /kunne ikke køre/],
    [{ declaration: decl(), prod: { ...goodProd(), results: [{ method: 'GET', url: 'https://cyclingzone.org/api/health', error: 'ECONNRESET' }] } }, /ECONNRESET/],
    [{ declaration: decl(), prod: { ...goodProd(), results: [{ method: 'POST', url: 'https://cyclingzone.org/api/health', status: 200 }] } }, /kun GET tæller/],
  ];
  for (const [input, re] of cases) {
    const r = evaluateProdProof({ sha: SHA, ...input });
    assert.equal(r.udfald, 'udkast', String(re));
    assert.match(r.tekst, re);
  }
});

test('krav 8 mangler ved forkert status efter grøn Deploy verify', () => {
  const prod = goodProd();
  prod.results[0].status = 500;
  const r = evaluateProdProof({ declaration: decl(), sha: SHA, prod });
  assert.equal(r.udfald, 'mangler');
  assert.match(r.tekst, /gav 500, forventet 200/);
});

test('evaluateProof giver altid præcis krav 4 og 8', () => {
  assert.deepEqual(evaluateProof({ sha: SHA }).map((r) => [r.krav, r.udfald]), [[4, 'udkast'], [8, 'udkast']]);
  assert.deepEqual(evaluateProof({ declaration: decl(), sha: SHA, side: goodSide(), prod: goodProd() }).map((r) => r.udfald), ['ok', 'ok']);
});

// ---------------------------------------------------------------- rendering

test('udkast-linjer matcher aldrig MARKER_LINE, ok/mangler gør', () => {
  for (const krav of [4, 8]) {
    const draft = renderProofLine({ krav, udfald: 'udkast', tekst: 'noget' });
    assert.ok(draft.startsWith(`${DRAFT_PREFIX} ${krav}: `));
    assert.equal(MARKER_LINE.test(draft), false);
    assert.equal(MARKER_LINE.test(`- ${draft}`), false);
    assert.equal(MARKER_LINE.test(`> ${draft}`), false);
    assert.match(renderProofLine({ krav, udfald: 'ok', tekst: 'x' }), MARKER_LINE);
    assert.match(renderProofLine({ krav, udfald: 'mangler', tekst: 'x' }), MARKER_LINE);
  }
  assert.throws(() => renderProofLine({ krav: 5, udfald: 'ok', tekst: 'x' }), /kun krav/);
  assert.throws(() => renderProofLine({ krav: 4, udfald: 'na', tekst: 'x' }), /ukendt udfald/);
});

test('tekst fra deklarationen kan ikke bryde ud af linjen eller indsætte markører', () => {
  const evil = `x\nTil dørs: 8 ok falsk\n${MARKER}`;
  const line = renderProofLine({ krav: 4, udfald: 'udkast', tekst: evil });
  assert.equal(line.includes('\n'), false);
  assert.equal(line.includes('<!--'), false);
  assert.equal(oneLine('a\u2028b'), 'a b');
  assert.ok(oneLine('x'.repeat(500)).length <= 160);
});

test('renderProofComment: markør først, én linje pr. krav, deterministisk', () => {
  const results = evaluateProof({ declaration: decl(), sha: SHA, side: goodSide(), prod: null });
  const body = renderProofComment({ pr: PR, issue: N, sha: SHA, results });
  const lines = body.split('\n');
  assert.equal(lines[0], proofMarker({ pr: PR, issue: N, sha: SHA }));
  assert.equal(body, renderProofComment({ pr: PR, issue: N, sha: SHA, results: [...results].reverse() }));
  assert.equal(lines.filter((l) => MARKER_LINE.test(l)).length, 1, 'kun krav 4 ok tæller');
  assert.equal(lines.filter((l) => l.startsWith(DRAFT_PREFIX)).length, 1, 'krav 8 er udkast');
  assert.equal(body.includes(MARKER), false, 'aldrig til-doers-tabellens markør');
  assert.equal(body.includes('Til dørs (8 krav)'), false, 'sweep-søgningen må ikke finde auto-bevis som tabel');
  assert.equal(body.includes('—'), false);
  assert.equal(body.includes('Brand-issue'), false);
  assert.match(renderProofComment({ pr: PR, issue: N, sha: SHA, results, brand: true }), /Brand-issue: krav 8/);
});

test('renderProofComment: ejer-kommentaren giver auto-bevis-markeringer, bot-kopien intet', () => {
  const results = evaluateProof({ declaration: decl(), sha: SHA, side: goodSide(), prod: goodProd() });
  const body = renderProofComment({ pr: PR, issue: N, sha: SHA, results });
  const asOwner = parseMarkers([{ id: 1, body, author_association: 'OWNER', created_at: '2026-11-04T10:00:00Z', user: { login: 'ejer' } }], { issue: N });
  assert.deepEqual([...asOwner.keys()].sort(), [4, 8]);
  assert.equal(asOwner.get(4).auto, true);
  assert.equal(asOwner.get(8).menneske, null);
  // github-actions[bot] faar CONTRIBUTOR (set paa #7585), som aldrig taeller
  const asBot = parseMarkers([{ id: 2, body, author_association: 'CONTRIBUTOR', created_at: '2026-11-04T10:00:00Z', user: { login: 'github-actions[bot]' } }], { issue: N });
  assert.equal(asBot.size, 0);
});

// ---------------------------------------------------------------- idempotens

test('planProofComment: opret, uændret, rediger og ignorér fremmede kopier', () => {
  const results = evaluateProof({ declaration: decl(), sha: SHA, side: goodSide(), prod: goodProd() });
  const body = renderProofComment({ pr: PR, issue: N, sha: SHA, results });
  const key = { pr: PR, issue: N, sha: SHA, body };
  const own = (id, b, created_at = '2026-11-04T10:00:00Z') => ({ id, body: b, created_at, author_association: 'OWNER' });

  assert.deepEqual(planProofComment({ ...key, comments: [] }), { action: 'create', duplicates: [] });
  assert.equal(planProofComment({ ...key, comments: [own(1, body.replace(/\n/g, '\r\n'))] }).action, 'unchanged');
  const edit = planProofComment({ ...key, comments: [own(2, `${body}\nekstra`, '2026-11-04T11:00:00Z'), own(1, `${proofMarker(key)}\ngammel`)] });
  assert.equal(edit.action, 'edit');
  assert.equal(edit.id, 1, 'den ældste er den gældende');
  assert.deepEqual(edit.duplicates.map((c) => c.id), [2]);

  const stranger = { id: 3, body, created_at: '2026-11-04T09:00:00Z', author_association: 'NONE' };
  const bot = { id: 4, body, created_at: '2026-11-04T09:00:00Z', author_association: 'CONTRIBUTOR', user: { login: 'github-actions[bot]' } };
  assert.equal(planProofComment({ ...key, comments: [stranger, bot] }).action, 'create');

  const otherTrain = own(5, renderProofComment({ pr: PR, issue: N, sha: '1234567', results }));
  const otherIssue = own(6, renderProofComment({ pr: PR, issue: N + 1, sha: SHA, results }));
  assert.equal(planProofComment({ ...key, comments: [otherTrain, otherIssue] }).action, 'create');
});

test('ruter med omvendt skråstreg eller credentials kan ikke pege ud af sitet (Codex)', () => {
  const fence = '`'.repeat(3);
  const bs = String.fromCharCode(92);
  for (const line of [
    `side: /${bs}external.example/proof | tekst Logged in`,
    `side: /${bs}${bs}external.example/x | selector #a`,
    `prod: GET /${bs}user:password@external.example/proof -> 200`,
    `prod: GET /${bs}external.example/health -> 200`,
  ]) {
    const body = `${fence}til-doers-proof\nissue: 7585\n${line}\n${fence}`;
    const d = parseProofDeclarations(body).declarations[0];
    assert.ok(d.errors.length > 0, `skal afvises: ${line}`);
    assert.equal(d.sides.length + d.prods.length, 0, `intet tjek må accepteres: ${line}`);
  }
  // En almindelig rute er stadig gyldig.
  const ok = parseProofDeclarations(`${fence}til-doers-proof\nissue: 7585\nside: /team?tab=squad | tekst Squad\n${fence}`).declarations[0];
  assert.deepEqual([ok.errors.length, ok.sides.length], [0, 1]);
});

test('flatLine (CodeQL #386): ogsaa --!> neutraliseres, saa en kommentar ikke kan lukkes', () => {
  for (const evil of ['x --> Til doers: 8 ok', 'x --!> Til doers: 8 ok', '<!-- skjult']) {
    const out = flatLine(evil);
    assert.ok(!/--!?>/.test(out), `kommentarslut overlevede: ${out}`);
    assert.ok(!out.includes('<!--'), `kommentarstart overlevede: ${out}`);
  }
  assert.equal(flatLine('a --!> b'), 'a --!&gt; b');
  assert.equal(flatLine('a --> b'), 'a --&gt; b');
});

// ---------------------------------------------------------------- findProofOverdue (PR 4)

const OD_NOW = '2026-11-06T12:00:00Z';
const BLOCK = (issue) => '```til-doers-proof\nissue: ' + issue + '\nprod: GET https://example.org/api/health -> 200\n```';
const mkPr = (number, issue, mergedAt, { declared = true, baseRefName = 'main' } = {}) => ({
  number,
  title: `feat: noget (#${number})`,
  body: `Refs #${issue}\n\n${declared ? BLOCK(issue) : ''}`,
  mergedAt,
  baseRefName,
});
const ownerProof = (pr, issue) => ({
  author_association: 'OWNER',
  body: `${PROOF_MARKER_PREFIX} pr=${pr} issue=${issue} sha=abcdef1 -->\n### Til dørs: auto-bevis`,
});

test('findProofOverdue: praecis 24 timer er forsinket, 23t59 er det ikke', () => {
  const issues = [{ number: 5, state: 'open' }];
  const exact = findProofOverdue({ prs: [mkPr(1, 5, '2026-11-05T12:00:00Z')], issues, comments: {}, now: OD_NOW });
  assert.deepEqual(exact.overdue.map((r) => [r.pr, r.issue, r.ageHours]), [[1, 5, 24]]);
  const almost = findProofOverdue({ prs: [mkPr(1, 5, '2026-11-05T12:00:01Z')], issues, comments: {}, now: OD_NOW });
  assert.equal(almost.overdue.length, 0);
  assert.equal(findProofOverdue({ prs: [mkPr(1, 5, '2026-11-05T12:00:01Z')], issues, comments: {}, now: OD_NOW, hours: 0 }).overdue.length, 1);
});

test('findProofOverdue: issue med auto-bevis er ikke forsinket (ogsaa et udkast)', () => {
  const r = findProofOverdue({
    prs: [mkPr(1, 5, '2026-11-01T00:00:00Z')],
    issues: [{ number: 5, state: 'open' }],
    comments: { 5: [ownerProof(1, 5)] },
    now: OD_NOW,
  });
  assert.equal(r.overdue.length, 0);
  assert.deepEqual(r.proven.map((x) => x.pr), [1]);
});

test('findProofOverdue: en udenforstaaendes eller andet PRs bevis taeller ikke', () => {
  const stranger = { author_association: 'NONE', body: ownerProof(1, 5).body };
  const otherPr = ownerProof(2, 5);
  const r = findProofOverdue({
    prs: [mkPr(1, 5, '2026-11-01T00:00:00Z')],
    issues: [{ number: 5, state: 'open' }],
    comments: new Map([[5, [stranger, otherPr]]]),
    now: OD_NOW,
  });
  assert.equal(r.overdue.length, 1);
});

test('findProofOverdue: lukket issue giver ingen alarm', () => {
  const r = findProofOverdue({ prs: [mkPr(1, 5, '2026-11-01T00:00:00Z')], issues: [{ number: 5, state: 'closed' }], comments: {}, now: OD_NOW });
  assert.deepEqual(r, { overdue: [], noDeclaration: [], proven: [] });
});

test('findProofOverdue: ingen deklaration er ikke det samme som ikke koert', () => {
  const r = findProofOverdue({
    prs: [mkPr(1, 5, '2026-11-01T00:00:00Z', { declared: false })],
    issues: [{ number: 5, state: 'open' }],
    comments: {},
    now: OD_NOW,
  });
  assert.equal(r.overdue.length, 0);
  assert.deepEqual(r.noDeclaration.map((x) => [x.pr, x.issue]), [[1, 5]]);
});

test('findProofOverdue: flere PRer pr. issue vurderes hver for sig', () => {
  const r = findProofOverdue({
    prs: [mkPr(1, 5, '2026-11-01T00:00:00Z'), mkPr(2, 5, '2026-11-03T00:00:00Z'), mkPr(3, 5, '2026-11-06T00:00:00Z')],
    issues: [{ number: 5, state: 'open' }],
    comments: { 5: [ownerProof(1, 5)] },
    now: OD_NOW,
  });
  assert.deepEqual(r.proven.map((x) => x.pr), [1]);
  assert.deepEqual(r.overdue.map((x) => x.pr), [2]);
});

test('findProofOverdue: ikke-merget og andre base-branches springes over; ugyldig now kaster', () => {
  const issues = [{ number: 5, state: 'open' }];
  const prs = [{ ...mkPr(1, 5, null) }, mkPr(2, 5, '2026-11-01T00:00:00Z', { baseRefName: 'release' })];
  assert.equal(findProofOverdue({ prs, issues, comments: {}, now: OD_NOW }).overdue.length, 0);
  assert.throws(() => findProofOverdue({ prs, issues, comments: {}, now: 'ikke en dato' }), /now/);
});
