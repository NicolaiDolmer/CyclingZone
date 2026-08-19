import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDrainNeutralRate,
  computeWageNeutralA,
  projectedAnchorWage,
  WAGE_ANCHOR_EXPONENT,
} from "./marketValueLevelCorrectionNeutrality.js";

// Tallene her er hentet 1:1 fra scratchpad-måle-noten 19/8, afsnit 4
// (c = 0,6918, den 180-dages-medianen målingen brugte til sin egen dry-run),
// så en regression i formlerne fanges mod et allerede-verificeret facit.
const C_MEASURED = 0.6918;

test("computeDrainNeutralRate: 0,25 / 0,6918 ≈ 0,3614 (scratchpad-facit)", () => {
  const rateNew = computeDrainNeutralRate(0.25, C_MEASURED);
  assert.ok(Math.abs(rateNew - 0.3614) < 0.0005, `fik ${rateNew}`);
});

test("computeDrainNeutralRate er den algebraiske invers: (rate/c) x (c x værdi) = rate x værdi", () => {
  const rate = 0.25;
  const c = 0.42;
  const value = 12_345;
  const rateNew = computeDrainNeutralRate(rate, c);
  const startPriceOld = rate * value;
  const startPriceNew = rateNew * (c * value);
  assert.ok(Math.abs(startPriceNew - startPriceOld) < 1e-9);
});

test("computeDrainNeutralRate kaster på ugyldigt input", () => {
  assert.throws(() => computeDrainNeutralRate(0, 0.5));
  assert.throws(() => computeDrainNeutralRate(0.25, 0));
  assert.throws(() => computeDrainNeutralRate(0.25, -1));
  assert.throws(() => computeDrainNeutralRate(NaN, 0.5));
});

test("computeWageNeutralA: 23.300 x 0,6918^-0,55 ≈ 28.534 (scratchpad-facit)", () => {
  const aNew = computeWageNeutralA(23_300, C_MEASURED);
  assert.ok(Math.abs(aNew - 28_534) < 5, `fik ${aNew}`);
});

test("computeWageNeutralA: eksponenten er 0,55 (låst af design-sessionen 17/8)", () => {
  assert.equal(WAGE_ANCHOR_EXPONENT, 0.55);
});

test("computeWageNeutralA kaster på ugyldigt input", () => {
  assert.throws(() => computeWageNeutralA(0, 0.5));
  assert.throws(() => computeWageNeutralA(23_300, 0));
  assert.throws(() => computeWageNeutralA(23_300, -1));
});

// Sanity-tjek: løn i kroner FØR (gammel A, gammel anker) == løn i kroner
// EFTER (ny A, ny anker = c x gammel anker), for de 5 eksempel-ryttere fra
// scratchpad-noten 19/8 afsnit 4c (op til afrunding).
test("neutralitet holder for 5 eksempel-ryttere (op til Math.round)", () => {
  const A_OLD = 23_300;
  const A_NEW = computeWageNeutralA(A_OLD, C_MEASURED);
  const examples = [
    { label: "Billig (~P5)", anchorOld: 1_020 },
    { label: "Median (~P50)", anchorOld: 4_951 },
    { label: "Dyr (~P90)", anchorOld: 57_625 },
    { label: "Dyrest (max)", anchorOld: 23_756_219 },
    { label: "Ungt talent", anchorOld: 4_450_124 },
  ];
  for (const { label, anchorOld } of examples) {
    const wageBefore = projectedAnchorWage(anchorOld, A_OLD);
    const anchorNew = anchorOld * C_MEASURED;
    const wageAfter = projectedAnchorWage(anchorNew, A_NEW);
    // Afrundingsslør: begge sider rundes til nærmeste heltal (Math.round),
    // så en difference på 1 kr. er tilladt for store beløb.
    assert.ok(
      Math.abs(wageAfter - wageBefore) <= 1,
      `${label}: løn før=${wageBefore} løn efter=${wageAfter} (anker ${anchorOld} → ${anchorNew})`
    );
  }
});

test("projectedAnchorWage respekterer gulvet (default 250)", () => {
  assert.equal(projectedAnchorWage(1, 23_300), 250);
  assert.equal(projectedAnchorWage(0, 23_300), 250);
  assert.equal(projectedAnchorWage(null, 23_300), 250);
});
