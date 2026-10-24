import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAscendingOrder, coarseClassOf, positionBucket, measureOrderVariation, positionDistance, detectOrderVariationViolations,
  assertOrderVariationBands, REAL_STAGE_RACES, POSITION_BUCKETS,
} from "./stageOrderVariationGate.js";

// Test-bånd (ikke de rigtige; de står privat i balance-internals/2757-a2/).
const BANDS = Object.freeze({ ascendingShareMax: 0.5, identicalShareMax: 0.5, identicalCountFloor: 1, distinctShareMin: 0.5, positionDistanceMax: 0.9, minRoutesPerStageCount: 2 });

test("#2757 isAscendingOrder: crescendo-skabelonen genkendes, finalen og tidskørsler tæller ikke", () => {
  assert.equal(isAscendingOrder(["rolling", "hilly", "medium_mountain", "hilly"]), true, "ejerens skabelon");
  assert.equal(isAscendingOrder(["itt", "flat", "hilly", "mountain", "flat"]), true, "prolog og sprint-finale ændrer ikke skabelonen");
  assert.equal(isAscendingOrder(["hilly", "rolling", "medium_mountain", "hilly"]), false);
  assert.equal(isAscendingOrder(["hilly", "hilly", "hilly", "flat"]), false, "én klasse er ikke en skabelon");
  assert.equal(isAscendingOrder(["flat", "mountain", "hilly"]), false, "for få vejetaper før finalen");
});

test("#2757 grove klasser og placeringskasser", () => {
  assert.equal(coarseClassOf("rolling"), "flat");
  assert.equal(coarseClassOf("medium_mountain"), "hilly");
  assert.equal(coarseClassOf("high_mountain"), "mountain");
  assert.equal(coarseClassOf("itt_hilly"), "tt");
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => positionBucket(i, 5)), ["first", "early", "middle", "late", "last"]);
});

test("#2757 referencen: rigtige løb har afstand 0 til sig selv og summer til løbenes etaper", () => {
  assert.equal(positionDistance(REAL_STAGE_RACES.positions, REAL_STAGE_RACES.positions), 0);
  const first = Object.values(REAL_STAGE_RACES.positions.first).reduce((s, x) => s + x, 0);
  assert.equal(first, REAL_STAGE_RACES.races, "én første etape pr. løb");
  assert.deepEqual(Object.keys(REAL_STAGE_RACES.positions), [...POSITION_BUCKETS]);
});

test("#2757 målet og gaten: skabelon-dominans og ens rækkefølger er brud; et varieret sæt er grønt", () => {
  const template = ["rolling", "hilly", "medium_mountain", "hilly"];
  const mono = Array.from({ length: 6 }, (_, i) => ({ key: `r${i}`, types: template }));
  const m = measureOrderVariation(mono);
  assert.equal(m.ascending, 6);
  assert.equal(m.distinct, 1);
  assert.deepEqual(m.byStageCount.map((s) => [s.stages, s.maxIdentical, s.routes]), [[4, 6, 6]]);
  const v = detectOrderVariationViolations(m, BANDS);
  assert.equal(v.length, 3, v.join(" | "));
  const varied = [
    ["hilly", "rolling", "medium_mountain", "hilly"], ["hilly", "flat", "mountain", "hilly"], ["flat", "hilly", "flat", "mountain"],
    ["itt", "hilly", "mountain", "flat", "hilly"], ["hilly", "mountain", "flat", "hilly", "mountain"], ["flat", "hilly", "flat", "mountain", "itt"],
  ].map((types, i) => ({ key: `v${i}`, types }));
  assert.deepEqual(detectOrderVariationViolations(measureOrderVariation(varied), BANDS), []);
});

test("#2757 båndene er fail-closed", () => {
  assert.throws(() => assertOrderVariationBands(null), /missing/);
  assert.throws(() => assertOrderVariationBands({ ...BANDS, ascendingShareMax: "0.4" }), /ascendingShareMax/);
  assert.equal(assertOrderVariationBands(BANDS), BANDS);
});
