import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBuildStop, validateBuildStop, classifyWork, assertBuildStop, logBrandAdmissions, matchLoft, withIssueMeta, ghIssueMeta, findOwnerGo, ghOwnerGo, OWNER_LOGIN } from './lib/build-stop.mjs';

// Ingen netværk i testene: ejer-go-opslaget er default i assertBuildStop.
process.env.CZ_BUILD_STOP_NO_GH ??= '1';

const cfg = validateBuildStop({
  active: true,
  since: '2026-10-29',
  finishList: [
    { issue: 7260, area: 'race-engine' },
    { issue: 7266, area: 'taktik' },
    { issue: 6110, area: 'udvikling-2' },
  ],
  cleanupList: [{ issue: 6514, why: 'åben PR #6636' }],
  brandList: [{ issue: 7316, reason: 'træningsprogrammets hovedevne giver ingen fremgang', since: '2026-10-29' }],
});

test('issue på finishList er finish med sit område', () => {
  assert.deepEqual(classifyWork({ issue: 7260 }, cfg), { cls: 'finish', area: 'race-engine', reason: 'fase 1-listen: race-engine' });
});

test('issue på brandList er brand med begrundelse, issue på cleanupList er cleanup', () => {
  assert.equal(classifyWork({ issue: 7316 }, cfg).cls, 'brand');
  assert.match(classifyWork({ issue: 7316 }, cfg).reason, /hovedevne/);
  assert.equal(classifyWork({ issue: 6514 }, cfg).cls, 'cleanup');
});

test('undersøgelsesspor er exempt, ukendt issue er nyt', () => {
  assert.equal(classifyWork({ issue: 9999, kind: 'investigate' }, cfg).cls, 'exempt');
  assert.equal(classifyWork({ issue: 9999 }, cfg).cls, 'new');
});

test('assertBuildStop afviser nyt arbejde og nævner spec og hvordan det kommer på listen', () => {
  assert.throws(() => assertBuildStop([{ issue: 7260 }, { issue: 9999 }], cfg), /Byggestop \(spec 2026-10-29.*#9999 er nyt arbejde.*build-stop\.json/s);
  assert.doesNotThrow(() => assertBuildStop([{ issue: 7260 }, { issue: 7316 }, { issue: 6514 }], cfg));
});

test('active:false slipper alt igennem', () => {
  assert.doesNotThrow(() => assertBuildStop([{ issue: 9999 }], { ...cfg, active: false }));
});

test('validateBuildStop: brand uden begrundelse og dobbelte issues afvises', () => {
  assert.throws(() => validateBuildStop({ ...cfg, brandList: [{ issue: 5, reason: ' ', since: '2026-10-29' }] }), /begrundelse/);
  assert.throws(() => validateBuildStop({ ...cfg, brandList: [{ issue: 7260, reason: 'x', since: '2026-10-29' }] }), /#7260.*flere lister/);
});

test('loadBuildStop læser CZ_BUILD_STOP_FILE, og repoets egen fil er gyldig', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cz-build-stop-'));
  const file = path.join(dir, 'bs.json');
  writeFileSync(file, JSON.stringify({ active: false, since: '2026-10-29', finishList: [], cleanupList: [], brandList: [] }));
  assert.equal(loadBuildStop(file).active, false);
  const repo = loadBuildStop(new URL('./build-stop.json', import.meta.url));
  assert.equal(repo.active, true);
  assert.ok(repo.finishList.length > 0, 'fase 1-listen skal stå i repoets build-stop.json');
});

test('logBrandAdmissions skriver én linje pr. brand-spor til afslutningskortets log', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cz-build-stop-log-'));
  const log = path.join(dir, 'brand-log.jsonl');
  logBrandAdmissions([{ issue: 7316 }, { issue: 7260 }], cfg, { channel: 'claude', now: 1790000000000, file: log });
  assert.ok(existsSync(log));
  const lines = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].issue, 7316);
  assert.equal(lines[0].channel, 'claude');
  assert.match(lines[0].reason, /hovedevne/);
});

// #7336 loft (ejer 4/11): de tre loft-områder + brand/forkert info-label må
// bygges uden liste; listerne gælder stadig som fallback.
const loft = {
  areas: [
    { area: 'race-engine', labels: ['cat:race-engine'], titleKeywords: ['[motor]', 'løbsfilm'], epics: [7260] },
    { area: 'taktik', labels: ['cat:taktik'], titleKeywords: ['[taktik]'], epics: [7266] },
    { area: 'udvikling-2', labels: ['epic:progression'], titleKeywords: ['udvikling 2.0'], epics: [6110] },
  ],
  brandLabels: ['brand', 'forkert-info'],
};
const loftCfg = validateBuildStop({ ...cfg, loft });

test('loft: label, titel-nøgleord og forælder-epic matcher hvert sit område', () => {
  assert.equal(classifyWork({ issue: 9001, labels: ['cat:race-engine'] }, loftCfg).cls, 'loft');
  assert.equal(classifyWork({ issue: 9001, labels: [{ name: 'CAT:Taktik' }] }, loftCfg).area, 'taktik');
  assert.equal(classifyWork({ issue: 9002, title: '[motor] Udbrud lukkes for sent', labels: [] }, loftCfg).area, 'race-engine');
  assert.equal(classifyWork({ issue: 9003, title: 'Løbsfilm viser forkert gruppe', labels: [] }, loftCfg).area, 'race-engine');
  assert.equal(classifyWork({ issue: 9004, title: 'Ny kurve', labels: [], parent: 6110 }, loftCfg).area, 'udvikling-2');
  assert.match(classifyWork({ issue: 9004, title: 'x', labels: [], parent: 6110 }, loftCfg).reason, /under epic #6110/);
});

test('loft: brand- og forkert info-label er brand, også uden for områderne', () => {
  const c = classifyWork({ issue: 9005, title: 'Akademi viser -0', labels: ['forkert-info'] }, loftCfg);
  assert.equal(c.cls, 'brand');
  assert.match(c.reason, /forkert-info/);
});

test('loft: uden for områderne og uden brand-label er stadig nyt arbejde', () => {
  assert.equal(classifyWork({ issue: 9006, title: '[sponsor] Ny sponsorside', labels: ['type:feature'], parent: 1234 }, loftCfg).cls, 'new');
  assert.equal(classifyWork({ issue: 9006 }, loftCfg).cls, 'new');
  assert.equal(matchLoft({ issue: 9006, title: 'motorvej' }, loft), null, 'nøgleordet er "[motor]", ikke ordet motor');
});

test('loft: listerne gælder stadig som fallback og går forud', () => {
  assert.equal(classifyWork({ issue: 7316, labels: ['cat:race-engine'] }, loftCfg).cls, 'brand');
  assert.equal(classifyWork({ issue: 6514 }, loftCfg).cls, 'cleanup');
});

test('loft: assertBuildStop henter labels kun for spor uden for listerne og returnerer dem beriget', () => {
  const asked = [];
  const meta = { 9101: { title: '[taktik] Ordrer før start', labels: [], parent: null }, 9102: { title: 'Ny butik', labels: ['brand'], parent: null } };
  const fetchMeta = n => { asked.push(n); return meta[n] || null; };
  const admitted = assertBuildStop([{ issue: 7260 }, { issue: 9101 }, { issue: 9102 }], loftCfg, { fetchMeta });
  assert.deepEqual(asked, [9101, 9102]);
  assert.deepEqual(admitted.map(t => classifyWork(t, loftCfg).cls), ['finish', 'loft', 'brand']);
});

test('loft: brand-label logges til afslutningskortet ligesom brandList', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cz-build-stop-loft-'));
  const log = path.join(dir, 'brand-log.jsonl');
  const admitted = assertBuildStop([{ issue: 9102 }, { issue: 9101 }], loftCfg, { fetchMeta: n => (n === 9102 ? { title: 'x', labels: ['brand'], parent: null } : { title: '[taktik] y', labels: [], parent: null }) });
  logBrandAdmissions(admitted, loftCfg, { channel: 'claude', now: 1790000000000, file: log });
  const lines = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(l => [l.issue, l.reason]), [[9102, 'brand-label brand']]);
});

test('loft: afvisning nævner loftet, og et utilgængeligt GitHub åbner aldrig porten', () => {
  assert.throws(
    () => assertBuildStop([{ issue: 9201 }], loftCfg, { fetchMeta: () => ({ title: 'Ny sponsorside', labels: [], parent: null }) }),
    /Loftet \(ejer 4\/11\): #9201 er uden for loftet.*race-engine, taktik, udvikling-2.*ejerens go/s,
  );
  assert.throws(() => assertBuildStop([{ issue: 9202 }], loftCfg, { fetchMeta: () => null }), /#9202 \(labels kunne ikke læses fra GitHub\)/);
});

test('loft: uden loft-felt hentes intet (gammel adfærd)', () => {
  assert.throws(() => assertBuildStop([{ issue: 9999 }], cfg, { fetchMeta: () => assert.fail('ingen opslag uden loft') }), /Byggestop/);
  assert.deepEqual(withIssueMeta([{ issue: 1 }], cfg, () => assert.fail('nej')), [{ issue: 1 }]);
});

test('loft: spor med labels hentes ikke igen', () => {
  const items = withIssueMeta([{ issue: 9301, labels: ['cat:taktik'] }], loftCfg, () => assert.fail('allerede beriget'));
  assert.equal(classifyWork(items[0], loftCfg).cls, 'loft');
});

test('loft: validateBuildStop afviser dubletter og tomme områder', () => {
  assert.throws(() => validateBuildStop({ ...cfg, loft: { ...loft, areas: [loft.areas[0], loft.areas[0]] } }), /står to gange/);
  assert.throws(() => validateBuildStop({ ...cfg, loft: { ...loft, areas: [{ area: 'tom', labels: [], titleKeywords: [], epics: [] }] } }), /matcher intet/);
  assert.throws(() => validateBuildStop({ ...cfg, loft: { ...loft, brandLabels: [] } }), /brandLabels/);
});

test('loft: repoets build-stop.json har de tre loft-områder og brand-labels', () => {
  const repo = loadBuildStop(new URL('./build-stop.json', import.meta.url));
  assert.deepEqual(repo.loft.areas.map(a => a.area), ['race-engine', 'taktik', 'udvikling-2']);
  assert.ok(repo.loft.brandLabels.includes('brand'));
  assert.ok(repo.loft.areas.find(a => a.area === 'udvikling-2').epics.includes(6110));
  assert.ok(repo.loft.areas.find(a => a.area === 'race-engine').epics.includes(7260));
});

test('ghIssueMeta: læser titel, labels og forælder, og giver null ved fejl', () => {
  const prev = process.env.CZ_BUILD_STOP_NO_GH;
  delete process.env.CZ_BUILD_STOP_NO_GH;
  try {
    const out = JSON.stringify({ data: { repository: { issue: { title: 'T', labels: { nodes: [{ name: 'cat:taktik' }] }, parent: { number: 7266 } } } } });
    let args;
    assert.deepEqual(ghIssueMeta(42, { exec: (cmd, a) => { args = [cmd, ...a]; return out; } }), { title: 'T', labels: ['cat:taktik'], parent: 7266 });
    assert.equal(args[0], 'gh');
    assert.ok(args.includes('n=42'));
    assert.equal(ghIssueMeta(42, { exec: () => { throw Error('gh mangler'); } }), null);
    assert.equal(ghIssueMeta(42, { exec: () => JSON.stringify({ data: { repository: { issue: null } } }) }), null);
  } finally {
    if (prev === undefined) delete process.env.CZ_BUILD_STOP_NO_GH; else process.env.CZ_BUILD_STOP_NO_GH = prev;
  }
});

test('loft: alle opslag deler én frist, så et langsomt GitHub ikke overlever hookens timeout', () => {
  let clock = 0;
  const seen = [];
  const slow = (n, { timeout }) => { seen.push([n, timeout]); clock += 30000; return null; };
  const items = withIssueMeta([{ issue: 9401 }, { issue: 9402 }, { issue: 9403 }], loftCfg, slow, { budgetMs: 45000, now: () => clock });
  assert.deepEqual(seen, [[9401, 20000], [9402, 15000]], 'andet opslag får kun restfristen, tredje springes over');
  assert.ok(items.every(t => t.metaUnavailable), 'alle forbliver nye (fail closed)');
});

// #7336 ejer-go-markør (ejer 23/11): ejerens ja som markør på issuet.
const goComment = (body, login = OWNER_LOGIN) => ({ author: { login }, body });
const GOOD = 'Ejer-go: "Ja, byg den"\n\n<!-- build-stop: ejer-go area=sponsor -->';

test('ejer-go: markør + citat fra ejerens konto tæller med sit område', () => {
  assert.deepEqual(findOwnerGo([goComment(GOOD)]), { area: 'sponsor', quote: 'Ja, byg den' });
  assert.deepEqual(findOwnerGo([{ login: 'nicolaidolmer', body: GOOD.replace('"Ja, byg den"', '“Kør”') }]), { area: 'sponsor', quote: 'Kør' });
  assert.deepEqual(findOwnerGo([{ user: { login: OWNER_LOGIN }, body: GOOD.replace('sponsor', 'udvikling-2') }]).area, 'udvikling-2');
  assert.deepEqual(findOwnerGo([goComment(GOOD.replaceAll('\n', '\r\n'))]), { area: 'sponsor', quote: 'Ja, byg den' }, 'CRLF fra GitHub');
  assert.deepEqual(findOwnerGo([goComment('Eksempel:\n```\n<!-- build-stop: ejer-go area=forkert -->\n```\n' + GOOD)]).area, 'sponsor', 'kode før en ægte markør skader ikke');
});

test('ejer-go: forkert format eller forkert konto tæller ikke', () => {
  const bad = [
    goComment(GOOD, 'someone-else'), // anden konto (repoet er offentligt)
    goComment('<!-- build-stop: ejer-go area=sponsor -->'), // intet citat
    goComment('"Ja"\n<!-- build-stop: ejer-go -->'), // intet område
    goComment('"Ja"\n<!-- build-stop: ejer-go area= -->'),
    goComment('"Ja"\n<!-- build-stop: ejer-go area=<omraade> -->'), // skabelon-pladsholder
    goComment('"Ja"\n<!-- build-stop: go area=sponsor -->'), // forkert nøgleord
    goComment('"Ja"\nbuild-stop: ejer-go area=sponsor'), // ikke en HTML-kommentar
    goComment('"Ja"\n`<!-- build-stop: ejer-go area=sponsor -->`'), // inline-kode
    goComment('"Ja"\n```\n<!-- build-stop: ejer-go area=sponsor -->\n```'), // kodeblok
    goComment('""\n<!-- build-stop: ejer-go area=sponsor -->'), // tomt citat
    goComment('"Ja"\n~~~\n<!-- build-stop: ejer-go area=sponsor -->\n~~~'), // tilde-kodeblok (Codex P2)
    goComment('"Ja"\n```md\n<!-- build-stop: ejer-go area=sponsor -->'), // uafsluttet kodeblok
    goComment('"Ja"\n    <!-- build-stop: ejer-go area=sponsor -->'), // indrykket kode
    goComment('"Ja"\n> <!-- build-stop: ejer-go area=sponsor -->'), // citeret svar
    goComment('"Ja" <!-- build-stop: ejer-go area=sponsor -->'), // ikke alene på linjen
  ];
  for (const c of bad) assert.equal(findOwnerGo([c]), null, c.body);
  assert.equal(findOwnerGo(null), null);
  assert.equal(findOwnerGo([goComment(GOOD)], { ownerLogin: '' }), null);
});

test('ejer-go: classifyWork gør et nyt issue til finish med markørens område, listerne går forud', () => {
  const c = classifyWork({ issue: 9501, ownerGo: { area: 'sponsor', quote: 'Ja' } }, loftCfg);
  assert.deepEqual(c, { cls: 'finish', area: 'sponsor', reason: 'ejer-go-markør på issuet: sponsor' });
  assert.equal(classifyWork({ issue: 7316, ownerGo: { area: 'x', quote: 'Ja' } }, cfg).cls, 'brand');
  assert.equal(classifyWork({ issue: 9501, ownerGo: null }, cfg).cls, 'new');
  assert.equal(classifyWork({ issue: 9501, ownerGo: { area: '' } }, cfg).cls, 'new');
});

test('ejer-go: assertBuildStop læser markøren kun for spor der ellers er nye, også uden loft', () => {
  const asked = [];
  const fetchGo = n => { asked.push(n); return n === 9601 ? { area: 'sponsor', quote: 'Ja' } : null; };
  const admitted = assertBuildStop([{ issue: 7260 }, { issue: 9601 }], cfg, { fetchGo });
  assert.deepEqual(asked, [9601]);
  assert.deepEqual(admitted.map(t => classifyWork(t, cfg).cls), ['finish', 'finish']);
  assert.throws(() => assertBuildStop([{ issue: 9602 }], cfg, { fetchGo }), /#9602 er nyt arbejde.*build-stop-go\.mjs/s);
});

test('ejer-go: med loft hentes labels først, og markøren kun hvis issuet stadig er nyt', () => {
  const order = [];
  const fetchMeta = n => { order.push(['meta', n]); return n === 9701 ? { title: '[taktik] x', labels: [], parent: null } : { title: 'Ny side', labels: [], parent: null }; };
  const fetchGo = n => { order.push(['go', n]); return { area: 'sponsor', quote: 'Ja' }; };
  const admitted = assertBuildStop([{ issue: 9701 }, { issue: 9702 }], loftCfg, { fetchMeta, fetchGo });
  assert.deepEqual(order, [['meta', 9701], ['meta', 9702], ['go', 9702]]);
  assert.deepEqual(admitted.map(t => classifyWork(t, loftCfg).cls), ['loft', 'finish']);
});

test('ejer-go: timeout eller fejl er som før (fail closed), og fristen deles med label-opslagene', () => {
  assert.throws(() => assertBuildStop([{ issue: 9801 }], loftCfg, { fetchMeta: () => null, fetchGo: () => null }), /Loftet.*#9801/s);
  let clock = 0;
  const seen = [];
  const slowMeta = () => { clock += 40000; return { title: 'x', labels: [], parent: null }; };
  const fetchGo = (n, { timeout }) => { seen.push([n, timeout]); return { area: 'a', quote: 'Ja' }; };
  const items = withIssueMeta([{ issue: 9802 }, { issue: 9803 }], loftCfg, slowMeta, { budgetMs: 45000, now: () => clock, fetchGo });
  assert.deepEqual(seen, [[9802, 5000]], 'markøren får kun restfristen; efter fristen springes den over');
  assert.equal(classifyWork(items[0], loftCfg).cls, 'finish');
  assert.equal(classifyWork(items[1], loftCfg).cls, 'new');
});

test('ghOwnerGo: læser alle sider via gh og bruger samme parser; null ved fejl og timeout', () => {
  const prev = process.env.CZ_BUILD_STOP_NO_GH;
  delete process.env.CZ_BUILD_STOP_NO_GH;
  try {
    let call;
    const lines = [JSON.stringify({ login: 'someone-else', body: GOOD.replace('sponsor', 'fremmed') }), JSON.stringify({ login: OWNER_LOGIN, body: GOOD })].join('\n');
    assert.deepEqual(ghOwnerGo(42, { exec: (cmd, a, o) => { call = [cmd, a, o]; return lines; } }), { area: 'sponsor', quote: 'Ja, byg den' });
    assert.equal(call[0], 'gh');
    assert.ok(call[1].includes('--paginate'));
    assert.ok(call[1].includes('repos/NicolaiDolmer/CyclingZone/issues/42/comments?per_page=100'));
    assert.equal(call[2].timeout, 10000, 'kort timeout');
    assert.equal(ghOwnerGo(42, { exec: () => { const e = Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } }), null);
    assert.equal(ghOwnerGo(42, { exec: () => 'ikke json' }), null);
    assert.equal(ghOwnerGo(42, { exec: () => '' }), null);
    assert.equal(ghOwnerGo(0, { exec: () => assert.fail('ugyldigt issue slår ikke op') }), null);
    if (process.env.NODE_TEST_CONTEXT) assert.equal(ghOwnerGo(42), null, 'default-gh slår aldrig op under node --test');
  } finally {
    if (prev === undefined) delete process.env.CZ_BUILD_STOP_NO_GH; else process.env.CZ_BUILD_STOP_NO_GH = prev;
  }
  process.env.CZ_BUILD_STOP_NO_GH = '1';
  try {
    assert.equal(ghOwnerGo(42, { exec: () => assert.fail('ingen netværk i tests') }), null);
  } finally {
    if (prev === undefined) delete process.env.CZ_BUILD_STOP_NO_GH; else process.env.CZ_BUILD_STOP_NO_GH = prev;
  }
});
