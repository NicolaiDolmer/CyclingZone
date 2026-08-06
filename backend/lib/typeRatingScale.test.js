import test from "node:test";
import assert from "node:assert/strict";

import { calibratedTypeRating, calibratedBands } from "./typeRatingScale.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

// Simpel syntetisk kalibreringskurve: 101 punkter, jævnt fordelt 10..90
// (position p → raw 10 + 0.8*p).
const LINEAR_CURVE = Array.from({ length: 101 }, (_, p) => 10 + 0.8 * p);
const CALIBRATION = {
  types: {
    sprinter: { curve: LINEAR_CURVE },
    gc: { curve: LINEAR_CURVE },
  },
};

test("calibratedTypeRating: midtpunktet af kurven mapper til position ~50", () => {
  const p = calibratedTypeRating("sprinter", 50, CALIBRATION); // 10 + 0.8*50 = 50
  assert.equal(p, 50);
});

test("calibratedTypeRating: samme rå værdi giver SAMME kalibrerede tal i alle typer (skala-ærlighed)", () => {
  const rSprinter = calibratedTypeRating("sprinter", 74, CALIBRATION);
  const rGc = calibratedTypeRating("gc", 74, CALIBRATION);
  assert.equal(rSprinter, rGc);
});

test("calibratedTypeRating: monoton — højere rå værdi giver aldrig lavere kalibreret tal", () => {
  const values = [10, 20, 35, 50, 65, 80, 90];
  const ratings = values.map((v) => calibratedTypeRating("sprinter", v, CALIBRATION));
  for (let i = 1; i < ratings.length; i++) {
    assert.ok(ratings[i] >= ratings[i - 1], `${ratings[i - 1]} → ${ratings[i]} ved ${values[i]}`);
  }
});

test("calibratedTypeRating: interpolerer mellem kurve-punkter (ikke kun nærmeste)", () => {
  // 10 + 0.8*p = 34  → p = 30
  const r = calibratedTypeRating("sprinter", 34, CALIBRATION);
  assert.equal(r, 30);
});

test("kant: rå værdi UNDER kurvens range clamper til 1", () => {
  assert.equal(calibratedTypeRating("sprinter", 0, CALIBRATION), 1);
  assert.equal(calibratedTypeRating("sprinter", -50, CALIBRATION), 1);
});

test("kant: rå værdi OVER kurvens range clamper til 99", () => {
  assert.equal(calibratedTypeRating("sprinter", 99, CALIBRATION), 99);
  assert.equal(calibratedTypeRating("sprinter", 1000, CALIBRATION), 99);
});

test("kant: resultatet er altid heltal i [1,99]", () => {
  for (const raw of [10.4, 23, 50.5, 77, 90]) {
    const r = calibratedTypeRating("sprinter", raw, CALIBRATION);
    assert.ok(Number.isInteger(r), `${raw} → ${r} skal være heltal`);
    assert.ok(r >= 1 && r <= 99, `${raw} → ${r} skal ligge i [1,99]`);
  }
});

test("fail-safe: manglende kalibrering (null) returnerer rå værdi uændret (klampet)", () => {
  assert.equal(calibratedTypeRating("sprinter", 42, null), 42);
  assert.equal(calibratedTypeRating("sprinter", 150, null), 99); // klampet, ikke ekstrapoleret
  assert.equal(calibratedTypeRating("sprinter", -5, null), 1);
});

test("fail-safe: type mangler i kalibreringen returnerer rå værdi uændret", () => {
  assert.equal(calibratedTypeRating("puncheur", 42, CALIBRATION), 42);
});

test("fail-safe: kurve for kort (<2 punkter) returnerer rå værdi uændret", () => {
  const brokenCalibration = { types: { sprinter: { curve: [37] } } };
  assert.equal(calibratedTypeRating("sprinter", 42, brokenCalibration), 42);
});

test("fail-safe: kurve med ikke-numerisk indhold returnerer rå værdi uændret", () => {
  const brokenCalibration = { types: { sprinter: { curve: [1, null, 99] } } };
  assert.equal(calibratedTypeRating("sprinter", 42, brokenCalibration), 42);
});

test("fail-safe: ikke-numerisk rå værdi (undefined/NaN) går uændret igennem", () => {
  assert.equal(calibratedTypeRating("sprinter", undefined, CALIBRATION), undefined);
  assert.equal(calibratedTypeRating("sprinter", NaN, CALIBRATION), NaN);
  assert.equal(calibratedTypeRating("sprinter", "not-a-number", CALIBRATION), "not-a-number");
});

test("calibratedBands: transformerer now/ceilLo/ceilHi for HVER type gennem samme kalibrering", () => {
  const bands = [
    { key: "sprinter", now: 34, ceilLo: 50, ceilHi: 74 },
    { key: "gc", now: 34, ceilLo: 50, ceilHi: 74 },
  ];
  const out = calibratedBands(bands, CALIBRATION);
  assert.equal(out.length, 2);
  // Samme rå tal (34/50/74) → samme kalibrerede tal i begge typer (ellers selvmodsigende).
  assert.deepEqual(
    { now: out[0].now, ceilLo: out[0].ceilLo, ceilHi: out[0].ceilHi },
    { now: out[1].now, ceilLo: out[1].ceilLo, ceilHi: out[1].ceilHi },
  );
  assert.equal(out[0].now, 30);
  assert.equal(out[0].ceilLo, 50);
  assert.equal(out[0].ceilHi, 80);
});

test("calibratedBands: bevarer ceilLo>=now og ceilHi>=ceilLo efter transform (monoton)", () => {
  const bands = [
    { key: "sprinter", now: 12, ceilLo: 45, ceilHi: 45 }, // ceilLo==ceilHi (helt scoutet)
    { key: "sprinter", now: 88, ceilLo: 88, ceilHi: 91 },
  ];
  const out = calibratedBands(bands, CALIBRATION);
  for (const b of out) {
    assert.ok(b.ceilLo >= b.now, JSON.stringify(b));
    assert.ok(b.ceilHi >= b.ceilLo, JSON.stringify(b));
  }
});

test("calibratedBands: tom/manglende input giver tomt array, kaster ikke", () => {
  assert.deepEqual(calibratedBands(null, CALIBRATION), []);
  assert.deepEqual(calibratedBands(undefined, CALIBRATION), []);
  assert.deepEqual(calibratedBands([], CALIBRATION), []);
});

test("calibratedBands: uændrede felter ud over now/ceilLo/ceilHi følger med (fx key)", () => {
  const out = calibratedBands([{ key: "gc", now: 50, ceilLo: 50, ceilHi: 50, extra: "x" }], CALIBRATION);
  assert.equal(out[0].key, "gc");
  assert.equal(out[0].extra, "x");
});

// Integrationstest mod den ÆGTE committede kalibrering (backend/lib/typeRatingCalibration.json)
// — ingen mock/injection her, dette er default-parameter-stien produktionskoden bruger.
test("integration: standard-kalibreringen findes og dækker alle 8 RIDER_TYPE_KEYS", () => {
  for (const key of RIDER_TYPE_KEYS) {
    for (const raw of [1, 25, 50, 75, 99]) {
      const r = calibratedTypeRating(key, raw); // ingen calibration-param → default
      assert.ok(Number.isInteger(r) && r >= 1 && r <= 99, `${key}@${raw} → ${r}`);
    }
  }
});
