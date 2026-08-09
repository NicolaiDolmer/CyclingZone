import test from "node:test";
import assert from "node:assert/strict";

import { selectTypesBaseline, YOUTH_BASELINE_AGE_THRESHOLD } from "./riderTypesBaselineSelect.js";

const ADULT = { mean: { climbing: 1 }, std: { climbing: 1 } };
const YOUTH = { mean: { climbing: 2 }, std: { climbing: 2 } };

test("selectTypesBaseline: alder under grænsen → ungdoms-baseline", () => {
  assert.equal(selectTypesBaseline(21, ADULT, YOUTH), YOUTH);
  assert.equal(selectTypesBaseline(16, ADULT, YOUTH), YOUTH);
});

test(`selectTypesBaseline: alder ${YOUTH_BASELINE_AGE_THRESHOLD}+ → voksen-baseline (bit-identisk sti)`, () => {
  assert.equal(selectTypesBaseline(22, ADULT, YOUTH), ADULT);
  assert.equal(selectTypesBaseline(35, ADULT, YOUTH), ADULT);
});

test("selectTypesBaseline: grænsen er EKSKLUSIV øvre (22 er IKKE ungdom)", () => {
  assert.equal(selectTypesBaseline(21.999, ADULT, YOUTH), YOUTH);
  assert.equal(selectTypesBaseline(22, ADULT, YOUTH), ADULT);
});

test("selectTypesBaseline: ukendt alder (null/undefined/NaN) → VOKSEN-baseline (konservativ fallback)", () => {
  assert.equal(selectTypesBaseline(null, ADULT, YOUTH), ADULT);
  assert.equal(selectTypesBaseline(undefined, ADULT, YOUTH), ADULT);
  assert.equal(selectTypesBaseline(NaN, ADULT, YOUTH), ADULT);
});

test("selectTypesBaseline: manglende youthBaseline (null/undefined) → VOKSEN for ALLE aldre (bagudkompatibel nul-ændring)", () => {
  assert.equal(selectTypesBaseline(16, ADULT, null), ADULT);
  assert.equal(selectTypesBaseline(16, ADULT, undefined), ADULT);
  assert.equal(selectTypesBaseline(35, ADULT, undefined), ADULT);
});

test("selectTypesBaseline: custom threshold respekteres", () => {
  assert.equal(selectTypesBaseline(24, ADULT, YOUTH, 25), YOUTH);
  assert.equal(selectTypesBaseline(25, ADULT, YOUTH, 25), ADULT);
});
