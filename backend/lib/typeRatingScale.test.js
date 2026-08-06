import test from "node:test";
import assert from "node:assert/strict";

import { typeRatingPercentile, percentileBands } from "./typeRatingScale.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

// Simpel syntetisk tabel: 101 punkter, jævnt fordelt 10..90 (percentil p → 10 + 0.8*p).
const LINEAR_QUANTILES = Array.from({ length: 101 }, (_, p) => 10 + 0.8 * p);
const TABLE = {
  types: {
    sprinter: { quantiles: LINEAR_QUANTILES },
    gc: { quantiles: LINEAR_QUANTILES },
  },
};

test("typeRatingPercentile: median-værdien mapper til percentil ~50", () => {
  const p = typeRatingPercentile("sprinter", 50, TABLE); // 10 + 0.8*50 = 50
  assert.equal(p, 50);
});

test("typeRatingPercentile: samme rå værdi giver SAMME percentil i alle typer (skala-ærlighed)", () => {
  const pSprinter = typeRatingPercentile("sprinter", 74, TABLE);
  const pGc = typeRatingPercentile("gc", 74, TABLE);
  assert.equal(pSprinter, pGc);
});

test("typeRatingPercentile: monoton — højere rå værdi giver aldrig lavere percentil", () => {
  const values = [10, 20, 35, 50, 65, 80, 90];
  const percentiles = values.map((v) => typeRatingPercentile("sprinter", v, TABLE));
  for (let i = 1; i < percentiles.length; i++) {
    assert.ok(percentiles[i] >= percentiles[i - 1], `${percentiles[i - 1]} → ${percentiles[i]} ved ${values[i]}`);
  }
});

test("typeRatingPercentile: interpolerer mellem breakpoints (ikke kun nærmeste)", () => {
  // 10 + 0.8*p = 34  → p = 30
  const p = typeRatingPercentile("sprinter", 34, TABLE);
  assert.equal(p, 30);
});

test("kant: rå værdi UNDER tabellens range clamper til 1", () => {
  assert.equal(typeRatingPercentile("sprinter", 0, TABLE), 1);
  assert.equal(typeRatingPercentile("sprinter", -50, TABLE), 1);
});

test("kant: rå værdi OVER tabellens range clamper til 99", () => {
  assert.equal(typeRatingPercentile("sprinter", 99, TABLE), 99);
  assert.equal(typeRatingPercentile("sprinter", 1000, TABLE), 99);
});

test("kant: resultatet er altid heltal i [1,99]", () => {
  for (const raw of [10.4, 23, 50.5, 77, 90]) {
    const p = typeRatingPercentile("sprinter", raw, TABLE);
    assert.ok(Number.isInteger(p), `${raw} → ${p} skal være heltal`);
    assert.ok(p >= 1 && p <= 99, `${raw} → ${p} skal ligge i [1,99]`);
  }
});

test("fail-safe: tom tabel (null) returnerer rå værdi uændret (klampet)", () => {
  assert.equal(typeRatingPercentile("sprinter", 42, null), 42);
  assert.equal(typeRatingPercentile("sprinter", 150, null), 99); // klampet, ikke ekstrapoleret
  assert.equal(typeRatingPercentile("sprinter", -5, null), 1);
});

test("fail-safe: type mangler i tabellen returnerer rå værdi uændret", () => {
  assert.equal(typeRatingPercentile("puncheur", 42, TABLE), 42);
});

test("fail-safe: kvantil-array for kort (<2 punkter) returnerer rå værdi uændret", () => {
  const brokenTable = { types: { sprinter: { quantiles: [37] } } };
  assert.equal(typeRatingPercentile("sprinter", 42, brokenTable), 42);
});

test("fail-safe: kvantil-array med ikke-numerisk indhold returnerer rå værdi uændret", () => {
  const brokenTable = { types: { sprinter: { quantiles: [1, null, 99] } } };
  assert.equal(typeRatingPercentile("sprinter", 42, brokenTable), 42);
});

test("fail-safe: ikke-numerisk rå værdi (undefined/NaN) går uændret igennem", () => {
  assert.equal(typeRatingPercentile("sprinter", undefined, TABLE), undefined);
  assert.equal(typeRatingPercentile("sprinter", NaN, TABLE), NaN);
  assert.equal(typeRatingPercentile("sprinter", "not-a-number", TABLE), "not-a-number");
});

test("percentileBands: transformerer now/ceilLo/ceilHi for HVER type gennem samme tabel", () => {
  const bands = [
    { key: "sprinter", now: 34, ceilLo: 50, ceilHi: 74 },
    { key: "gc", now: 34, ceilLo: 50, ceilHi: 74 },
  ];
  const out = percentileBands(bands, TABLE);
  assert.equal(out.length, 2);
  // Samme rå tal (34/50/74) → samme percentiler i begge typer (ellers selvmodsigende).
  assert.deepEqual(
    { now: out[0].now, ceilLo: out[0].ceilLo, ceilHi: out[0].ceilHi },
    { now: out[1].now, ceilLo: out[1].ceilLo, ceilHi: out[1].ceilHi },
  );
  assert.equal(out[0].now, 30);
  assert.equal(out[0].ceilLo, 50);
  assert.equal(out[0].ceilHi, 80);
});

test("percentileBands: bevarer ceilLo>=now og ceilHi>=ceilLo efter transform (monoton)", () => {
  const bands = [
    { key: "sprinter", now: 12, ceilLo: 45, ceilHi: 45 }, // ceilLo==ceilHi (helt scoutet)
    { key: "sprinter", now: 88, ceilLo: 88, ceilHi: 91 },
  ];
  const out = percentileBands(bands, TABLE);
  for (const b of out) {
    assert.ok(b.ceilLo >= b.now, JSON.stringify(b));
    assert.ok(b.ceilHi >= b.ceilLo, JSON.stringify(b));
  }
});

test("percentileBands: tom/manglende input giver tomt array, kaster ikke", () => {
  assert.deepEqual(percentileBands(null, TABLE), []);
  assert.deepEqual(percentileBands(undefined, TABLE), []);
  assert.deepEqual(percentileBands([], TABLE), []);
});

test("percentileBands: uændrede felter ud over now/ceilLo/ceilHi følger med (fx key)", () => {
  const out = percentileBands([{ key: "gc", now: 50, ceilLo: 50, ceilHi: 50, extra: "x" }], TABLE);
  assert.equal(out[0].key, "gc");
  assert.equal(out[0].extra, "x");
});

// Integrationstest mod den ÆGTE committede tabel (backend/lib/typeRatingQuantiles.json)
// — ingen mock/injection her, dette er default-parameter-stien produktionskoden bruger.
test("integration: default-tabellen findes og dækker alle 8 RIDER_TYPE_KEYS", () => {
  for (const key of RIDER_TYPE_KEYS) {
    for (const raw of [1, 25, 50, 75, 99]) {
      const p = typeRatingPercentile(key, raw); // ingen table-param → default-tabellen
      assert.ok(Number.isInteger(p) && p >= 1 && p <= 99, `${key}@${raw} → ${p}`);
    }
  }
});
