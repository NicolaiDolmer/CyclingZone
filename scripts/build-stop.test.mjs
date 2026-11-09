import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBuildStop, validateBuildStop, classifyWork, assertBuildStop, logBrandAdmissions, matchLoft, withIssueMeta, ghIssueMeta } from './lib/build-stop.mjs';

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
