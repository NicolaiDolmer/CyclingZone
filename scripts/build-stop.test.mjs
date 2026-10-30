import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBuildStop, validateBuildStop, classifyWork, assertBuildStop, logBrandAdmissions } from './lib/build-stop.mjs';

const cfg = validateBuildStop({
  active: true,
  since: '2026-10-29',
  areaCap: 3,
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

test('validateBuildStop: mere end areaCap områder på finishList afvises', () => {
  const four = { ...cfg, finishList: [...cfg.finishList, { issue: 1, area: 'akademi' }] };
  assert.throws(() => validateBuildStop(four), /4 områder.*loft 3/);
});

test('validateBuildStop: brand uden begrundelse og dobbelte issues afvises', () => {
  assert.throws(() => validateBuildStop({ ...cfg, brandList: [{ issue: 5, reason: ' ', since: '2026-10-29' }] }), /begrundelse/);
  assert.throws(() => validateBuildStop({ ...cfg, brandList: [{ issue: 7260, reason: 'x', since: '2026-10-29' }] }), /#7260.*flere lister/);
});

test('loadBuildStop læser CZ_BUILD_STOP_FILE, og repoets egen fil er gyldig', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cz-build-stop-'));
  const file = path.join(dir, 'bs.json');
  writeFileSync(file, JSON.stringify({ active: false, since: '2026-10-29', areaCap: 3, finishList: [], cleanupList: [], brandList: [] }));
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
