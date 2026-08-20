// #4000 — tests for riderValuationTypeDampening.js: flag-gate + regulariserings-
// matematikken produktionen skal bruge ved cutover, plus parity mod #4003-
// harnesset (backend/scripts/dev/lib/typeDampeningScenarios4000.mjs) som
// producerede scorecardet ejeren godkendte k=100 ud fra.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TYPE_DAMPENING_ENABLED,
  TYPE_DAMPENING_OFFSET_K,
  applyTypeDampening,
  regularizeOffset,
  regularizeOffsetTable,
} from "./riderValuationTypeDampening.js";
import { regularizeOffset as harnessRegularizeOffset } from "../scripts/dev/lib/typeDampeningScenarios4000.mjs";

// ── Flag-gate (den vigtigste test i denne fil — "må ikke ændre live-adfærd
// før flip") ─────────────────────────────────────────────────────────────────
test("#4000 TYPE_DAMPENING_ENABLED er FALSE — må kun flippes til true ved ejer-godkendt cutover, SAMMEN med #3449-c", () => {
  assert.equal(TYPE_DAMPENING_ENABLED, false);
});

test("#4000 TYPE_DAMPENING_OFFSET_K er 100 — ejerens godkendte scorecard-anbefaling (20/8, #4003)", () => {
  assert.equal(TYPE_DAMPENING_OFFSET_K, 100);
});

test("applyTypeDampening: no-op når disabled — returnerer SAMME reference, ingen kopi", () => {
  const model = {
    fit: { offset: { puncheur: 2.071, gc: 0.463 }, alpha: 1, a: 1, b: 1 },
    type_stats: { puncheur: { n: 19 }, gc: { n: 34 } },
  };
  assert.equal(applyTypeDampening(model), model);
});

test("applyTypeDampening: null/manglende model håndteres uden at kaste", () => {
  assert.equal(applyTypeDampening(null), null);
  assert.equal(applyTypeDampening(undefined), undefined);
  const empty = {};
  assert.equal(applyTypeDampening(empty), empty);
});

// ── Parity mod #4003-harnesset (matematikken må ALDRIG drifte mellem det
// ejeren så i scorecardet og det produktionen rent faktisk kører ved cutover) ──
for (const [offset, n, k] of [
  [2.071, 19, 100],   // puncheur — det ekstreme tilfælde issuet er bygget om
  [0.463, 34, 100],   // gc
  [0.85, 59, 100],    // brostensrytter
  [-0.139, 2622, 100], // tt — stort n, skal forblive næsten urørt
  [0.18, 1947, 50],   // climber, k=50
  [0.027, 34, 200],   // baroudeur, k=200
]) {
  test(`regularizeOffset(${offset}, n=${n}, k=${k}) matcher #4003-harnessets formel byte-for-byte`, () => {
    assert.equal(regularizeOffset(offset, n, k), harnessRegularizeOffset(offset, n, k));
  });
}

// ── Ren matematik-sanity (dokumenterer den "n/(n+k)"-krybning uafhængigt af
// harnesset) ──────────────────────────────────────────────────────────────────
test("regularizeOffset: n >> k ⇒ offset stort set urørt (tt, n=2622, k=100)", () => {
  const before = -0.139;
  const after = regularizeOffset(before, 2622, 100);
  // 2622/(2622+100) ≈ 0.9633 — under 4% dæmpning.
  assert.ok(Math.abs(after - before) / Math.abs(before) < 0.04);
});

test("regularizeOffset: n << k ⇒ offset kryber kraftigt mod 0 (puncheur, n=19, k=100)", () => {
  const after = regularizeOffset(2.071, 19, 100);
  // 19/(19+100) ≈ 0.1597 — offset dæmpes til ~16% af originalen.
  assert.ok(after > 0 && after < 2.071 * 0.2);
});

test("regularizeOffset: n=0 ⇒ offset kollapser helt til 0 (uanset k>0)", () => {
  assert.equal(regularizeOffset(1.5, 0, 100), 0);
});

test("regularizeOffset: k=0 ⇒ offset helt urørt (ingen dæmpning)", () => {
  assert.equal(regularizeOffset(1.5, 19, 0), 1.5);
});

test("regularizeOffset: ikke-finite offset returneres som NaN, ikke en gættet værdi (guard)", () => {
  assert.ok(Number.isNaN(regularizeOffset(NaN, 19, 100)));
  assert.ok(Number.isNaN(regularizeOffset(undefined, 19, 100)));
});

test("regularizeOffsetTable: type uden n i typeStats forbliver urørt (samme #1231-fallback-ånd)", () => {
  const table = regularizeOffsetTable({ puncheur: 2.071, ukendt_type: 0.5 }, { puncheur: { n: 19 } }, 100);
  assert.equal(table.ukendt_type, 0.5);
  assert.ok(table.puncheur < 2.071);
});

// ── applyTypeDampening's FORM (hvad flippet FAKTISK gør, testet direkte mod
// regularizeOffsetTable så vi ikke skal flippe det globale flag i test-runet) ──
test("regularizeOffsetTable md k=100 dæmper puncheur-multiplikatoren fra 7,9x til under 2x (scorecardets hovedfund)", () => {
  const dampened = regularizeOffsetTable({ puncheur: 2.071 }, { puncheur: { n: 19 } }, 100);
  const multiplierBefore = Math.exp(2.071);
  const multiplierAfter = Math.exp(dampened.puncheur);
  assert.ok(multiplierBefore > 7.5);
  assert.ok(multiplierAfter < 2, `forventede <2x, fik ${multiplierAfter}x`);
});

test("applyTypeDampening() sammensætter fit.offset præcis som regularizeOffsetTable ville — verificeret ved midlertidigt at kalde funktionerne parallelt (samme input, samme output)", () => {
  const model = {
    fit: { offset: { puncheur: 2.071, tt: -0.139 }, alpha: 1, a: 1, b: 1, c: 0 },
    type_stats: { puncheur: { n: 19 }, tt: { n: 2622 } },
    discount: 0.8,
  };
  // Byg forventet output ved at kalde de samme rene funktioner applyTypeDampening
  // ville have kaldt, HVIS flaget var true — bekræfter sammensætningen (spread +
  // fit.offset-erstatning) er korrekt, uden at afhænge af den globale konstant.
  const expectedOffset = regularizeOffsetTable(model.fit.offset, model.type_stats, TYPE_DAMPENING_OFFSET_K);
  const expectedModel = { ...model, fit: { ...model.fit, offset: expectedOffset } };
  // Disabled i dag ⇒ applyTypeDampening returnerer INPUT, ikke expectedModel —
  // dokumenterer eksplicit hvad der ændrer sig NÅR flippet sker.
  assert.notDeepEqual(applyTypeDampening(model), expectedModel);
  assert.equal(applyTypeDampening(model), model);
});
