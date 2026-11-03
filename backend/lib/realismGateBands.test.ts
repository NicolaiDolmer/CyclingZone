// #7588 realisme-gate PR 2: schema og validator for de private bånd og
// kendt-rød-listen. Alle tal er syntetiske testværdier (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CELL_WILDCARD, REALISM_FINISHES, REALISM_GATE_BANDS_KEY, REALISM_GATE_KNOWN_RED_KEY, REALISM_METRICS, REALISM_METRIC_KEYS,
  REALISM_RACE_GROUPS, REALISM_TERRAINS, cellKey, parseCellKey, parseRealismGateBands, parseRealismGateKnownRed,
} from "./realismGateBands.ts";
import { STAGE_PROFILE_TYPES } from "./stageProfileTypes.js";

const BANDS = () => ({
  version: "test-2",
  _decisions: [
    { version: "test-1", date: "2001-01-01", quote: "syntetisk første beslutning" },
    { version: "test-2", date: "2001-02-03", quote: "syntetisk anden beslutning" },
  ],
  minRoutes: 3,
  params: { bigLeadSeconds: 11, hardCapSeconds: 22 },
  cells: {
    "stage_race|mountain|summit": { minRoutes: 4, gapTo10: { median: { min: 1, max: 2 }, p90: { max: 3 } }, bigLeadShare: { share: { max: 0.5 } } },
    "*|flat|*": { breakawayCaughtKmToGo: { median: { min: 1, max: 9 } }, overHardCapCount: { count: { max: 0 } } },
  },
  gcGroups: { "sr5-8": { gcFinalTo10: { median: { max: 7 } } } },
});

test("#7588 bånd: en gyldig værdi normaliseres (navne, versioner, celler)", () => {
  const b = parseRealismGateBands(BANDS());
  assert.equal(b.version, "test-2");
  assert.equal(b.decisions.length, 2);
  assert.equal(b.minRoutes, 3);
  assert.deepEqual(b.params, { bigLeadSeconds: 11, hardCapSeconds: 22 });
  assert.deepEqual(b.cells["stage_race|mountain|summit"], { minRoutes: 4, metrics: { gapTo10: { median: { min: 1, max: 2 }, p90: { max: 3 } }, bigLeadShare: { share: { max: 0.5 } } } });
  assert.deepEqual(b.gcGroups["sr5-8"].metrics.gcFinalTo10, { median: { max: 7 } });
  assert.equal(REALISM_GATE_BANDS_KEY, "realism_gate_bands");
  assert.equal(REALISM_GATE_KNOWN_RED_KEY, "realism_gate_known_red");
});

test("#7588 bånd: versionskravet (version + beslutning med dato og ordlyd for netop den version)", () => {
  const without = BANDS() as Record<string, unknown>;
  delete without.version;
  assert.throws(() => parseRealismGateBands(without), /version mangler/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), version: "" }), /version mangler/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), _decisions: [] }), /_decisions mangler/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), version: "test-3" }), /ingen beslutning bærer den aktuelle version/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), _decisions: [{ version: "test-2", date: "3/11", quote: "x" }] }), /dato/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), _decisions: [{ version: "test-2", date: "2001-02-03", quote: " " }] }), /ordlyd/);
  assert.equal(parseRealismGateBands({ ...BANDS(), version: 2, _decisions: [{ version: 2, date: "2001-02-03", quote: "x" }] }).version, "2");
});

test("#7588 bånd: ukendte navne, forkerte statistikker og forkert slags celle afvises", () => {
  const withCell = (cell: Record<string, unknown>, key = "stage_race|mountain|summit") => ({ ...BANDS(), cells: { [key]: cell } });
  assert.throws(() => parseRealismGateBands(withCell({ gapTo10: { median: { max: 1 } } }, "stage_race|moon|summit")), /ugyldig cellenøgle/);
  assert.throws(() => parseRealismGateBands(withCell({ gapTo10: { median: { max: 1 } } }, "stage_race|mountain")), /ugyldig cellenøgle/);
  assert.throws(() => parseRealismGateBands(withCell({ madeUpMetric: { median: { max: 1 } } })), /ukendt metrik/);
  assert.throws(() => parseRealismGateBands(withCell({ breakawayWinShare: { median: { max: 1 } } })), /statistik metrikken ikke har/);
  assert.throws(() => parseRealismGateBands(withCell({ gcFinalTo10: { median: { max: 1 } } })), /ikke hører til denne slags celle/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), gcGroups: { gt: { gapTo10: { median: { max: 1 } } } } }), /ikke hører til denne slags celle/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), gcGroups: { sr9: { gcFinalTo10: { median: { max: 1 } } } } }), /ukendt klassements-gruppe/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), extra: 1 }), /ukendt nøgle på øverste niveau/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), cells: {} }), /cells er tom/);
  assert.throws(() => parseRealismGateBands(withCell({ gapTo10: {} })), /intet bånd/);
});

test("#7588 bånd: grænserne skal være tal, mindst én grænse, og min <= max", () => {
  const band = (b: unknown) => ({ ...BANDS(), cells: { "*|*|*": { gapTo10: { median: b } } } });
  assert.throws(() => parseRealismGateBands(band({})), /mangler både min og max/);
  assert.throws(() => parseRealismGateBands(band({ max: "x" })), /ikke er et tal/);
  assert.throws(() => parseRealismGateBands(band({ max: true })), /ikke er et tal/);
  assert.throws(() => parseRealismGateBands(band({ min: 2, max: 1 })), /min større end max/);
  assert.throws(() => parseRealismGateBands(band({ max: 1, warn: 2 })), /ukendt nøgle/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), minRoutes: 0 }), /minRoutes/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), minRoutes: 1.5 }), /minRoutes/);
});

test("#7588 bånd: M4/M5 kræver deres tærskel i params", () => {
  assert.throws(() => parseRealismGateBands({ ...BANDS(), params: { hardCapSeconds: 22 } }), /bigLeadSeconds mangler/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), params: { bigLeadSeconds: 11 } }), /hardCapSeconds mangler/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), params: { bigLeadSeconds: 0, hardCapSeconds: 22 } }), /ikke et tal > 0/);
  assert.throws(() => parseRealismGateBands({ ...BANDS(), params: { madeUp: 1 } }), /ukendt parameter/);
});

test("#7588 bånd: fejlbeskeder indeholder aldrig konfigurationens værdier", () => {
  const secret = 987654321;
  const cases: unknown[] = [
    { ...BANDS(), cells: { "*|*|*": { gapTo10: { median: { min: secret, max: secret - 1 } } } } },
    { ...BANDS(), minRoutes: secret + 0.5 },
    { ...BANDS(), version: "v-987654321" },
    { ...BANDS(), params: { bigLeadSeconds: -secret, hardCapSeconds: 22 } },
  ];
  for (const raw of cases) {
    try { parseRealismGateBands(raw); assert.fail("skulle afvises"); } catch (e) {
      assert.doesNotMatch(String((e as Error).message), /987654321/);
    }
  }
});

const KNOWN_RED = () => ({
  version: "test-1",
  entries: [
    { cell: "stage_race|mountain|*", metric: "breakawayMaxLead", stat: "median", issue: "#6912", direction: "above", tolerance: 0.1 },
    { cell: "sr5-8", metric: "gcFinalTo10", stat: "median", issue: "#1", direction: "above" },
  ],
});

test("#7588 kendt-rød-liste: gyldig værdi normaliseres", () => {
  const k = parseRealismGateKnownRed(KNOWN_RED());
  assert.equal(k.version, "test-1");
  assert.equal(k.entries.length, 2);
  assert.deepEqual(k.entries[1], { cell: "sr5-8", metric: "gcFinalTo10", stat: "median", issue: "#1", direction: "above" });
  assert.deepEqual(parseRealismGateKnownRed({ version: "x", entries: [] }).entries, []);
});

test("#7588 kendt-rød-liste: hver post peger på et issue, en gyldig celle/metrik og en retning", () => {
  const entry = (over: Record<string, unknown>) => ({ version: "t", entries: [{ ...KNOWN_RED().entries[0], ...over }] });
  assert.throws(() => parseRealismGateKnownRed({ entries: [] }), /mangler version/);
  assert.throws(() => parseRealismGateKnownRed({ version: "t" }), /mangler entries/);
  assert.throws(() => parseRealismGateKnownRed(entry({ issue: "6912" })), /issue/);
  assert.throws(() => parseRealismGateKnownRed(entry({ cell: "x|y|z" })), /ugyldig celle/);
  assert.throws(() => parseRealismGateKnownRed(entry({ metric: "nope" })), /ukendt metrik/);
  assert.throws(() => parseRealismGateKnownRed(entry({ metric: "gcFinalTo10" })), /hører ikke til cellens slags/);
  assert.throws(() => parseRealismGateKnownRed(entry({ stat: "share" })), /statistik/);
  assert.throws(() => parseRealismGateKnownRed(entry({ direction: "worse" })), /retning/);
  assert.throws(() => parseRealismGateKnownRed(entry({ tolerance: -1 })), /tolerance/);
  const dup = KNOWN_RED();
  dup.entries.push({ ...dup.entries[0] });
  assert.throws(() => parseRealismGateKnownRed(dup), /to gange/);
});

test("#7588 katalog: navnene er komplette og uden tal", () => {
  assert.deepEqual([...REALISM_TERRAINS], [...STAGE_PROFILE_TYPES]);
  assert.ok(REALISM_RACE_GROUPS.includes("gt") && REALISM_FINISHES.includes("summit"));
  for (const key of REALISM_METRIC_KEYS) {
    const s = REALISM_METRICS[key];
    assert.match(s.id, /^M\d+(\/M\d+)?$/);
    assert.ok(s.stats.length > 0);
    // "nr. 10" er en placering, ikke et balance-tal; alt andet tal er forbudt.
    assert.doesNotMatch(s.label.replace(/nr\. 10\b/g, ""), /\d/, `${key}: en rød doms tekst er uden tal`);
  }
  const ids = new Set(REALISM_METRIC_KEYS.flatMap((k) => REALISM_METRICS[k].id.split("/")));
  for (let i = 1; i <= 11; i++) assert.ok(ids.has(`M${i}`), `M${i} har en metrik`);
  assert.deepEqual(parseCellKey(cellKey("gt", CELL_WILDCARD, "descent")), { group: "gt", terrain: "*", finish: "descent" });
  assert.equal(parseCellKey(42), null);
});
