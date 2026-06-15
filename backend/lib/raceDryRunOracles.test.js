import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRaceStructuralOracles, minDistinctWinners, evaluateAbilityLivenessOracle } from "./raceDryRunOracles.js";

const healthyTerrain = (over = {}) => ({
  terrain: "flat", keyAb: "sprint", races: 300,
  winnerKeyAvg: 76, fieldMedianKey: 18, distinct: 34,
  ...over,
});
const healthyGc = { winnerCumSeconds: 0, minCumSeconds: 0 };
const healthyValue = { topDecileMedian: 2_000_000, bottomDecileMedian: 9_000 };

test("strukturelle oracles: sund baseline giver ingen brud", () => {
  const failures = evaluateRaceStructuralOracles({
    terrainResults: [healthyTerrain(), healthyTerrain({ terrain: "mountain", keyAb: "climbing", winnerKeyAvg: 88, fieldMedianKey: 23, distinct: 27 })],
    gc: healthyGc,
    value: healthyValue,
  });
  assert.deepEqual(failures, []);
});

test("inverteret motor fanges: vinder-nøgleevne under felt-median (#1198 race-M1)", () => {
  const failures = evaluateRaceStructuralOracles({
    terrainResults: [healthyTerrain({ winnerKeyAvg: 9, fieldMedianKey: 18 })],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /belønner ikke evnen/);
});

test("monopol-degeneration fanges: 1 distinkt vinder på 300 løb (#1198 race-M2)", () => {
  const failures = evaluateRaceStructuralOracles({
    terrainResults: [healthyTerrain({ distinct: 1 })],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /monopol-degeneration/);
});

test("minDistinctWinners: absolut gulv 2 (pool-størrelse gør andels-gulve falske)", () => {
  // Ved count=140 hvor hele puljen kører hvert løb er 2-5 distinkte vindere
  // legitimt — kun totalt monopol (distinkt=1 over flere løb) er broken.
  assert.equal(minDistinctWinners(300), 2);
  assert.equal(minDistinctWinners(10), 2);
  assert.equal(minDistinctWinners(1), 1);
});

test("inverteret GC fanges: vinderen har ikke laveste samlede tid (#1198 race-M6)", () => {
  const failures = evaluateRaceStructuralOracles({
    gc: { winnerCumSeconds: 5400, minCumSeconds: 0 },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /laveste-tid-vinder/);
});

test("GC-oracle fejler højt ved ikke-finite tider (parse-hul må ikke blive grønt)", () => {
  const failures = evaluateRaceStructuralOracles({
    gc: { winnerCumSeconds: NaN, minCumSeconds: 0 },
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /kunne ikke udlede/);
});

test("flad/inverteret værdimodel fanges: top-decil ikke dyrere end bund-decil (#1198 race-M5)", () => {
  const inverted = evaluateRaceStructuralOracles({
    value: { topDecileMedian: 9_000, bottomDecileMedian: 2_000_000 },
  });
  assert.equal(inverted.length, 1);
  assert.match(inverted[0], /flad\/inverteret/);

  const flat = evaluateRaceStructuralOracles({
    value: { topDecileMedian: 1000, bottomDecileMedian: 1000 },
  });
  assert.equal(flat.length, 1);
});

test("liveness-oracle: levende evner (gevinst ≥ gulv) giver ingen brud", () => {
  const failures = evaluateAbilityLivenessOracle([
    { ability: "sprint", terrain: "flat", mode: "neutral", rankGain: 1.8 },
    { ability: "climbing", terrain: "mountain", mode: "neutral", rankGain: 2.4 },
  ]);
  assert.deepEqual(failures, []);
});

test("liveness-oracle: en dødvægt-evne (gevinst < gulv) fanges (#1122)", () => {
  const failures = evaluateAbilityLivenessOracle([
    { ability: "tempo", terrain: "mountain", mode: "neutral", rankGain: 0.01 },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /dødvægt/);
});

test("liveness-oracle: gulvet er konfigurerbart", () => {
  const ok = evaluateAbilityLivenessOracle([{ ability: "durability", terrain: "mountain", mode: "condition", rankGain: 0.2 }], { floor: 0.1 });
  assert.deepEqual(ok, []);
  const bad = evaluateAbilityLivenessOracle([{ ability: "durability", terrain: "mountain", mode: "condition", rankGain: 0.2 }], { floor: 0.5 });
  assert.equal(bad.length, 1);
});

test("liveness-oracle: mode-bevidst gulv (seam-modes lavere) (#1122)", () => {
  const sens = [{ ability: "durability", terrain: "mountain", mode: "condition", rankGain: 0.04 }];
  // default-gulv 0.05 → fanges som dødvægt
  assert.equal(evaluateAbilityLivenessOracle(sens).length, 1);
  // seam-gulv 0.02 for condition → levende
  assert.deepEqual(evaluateAbilityLivenessOracle(sens, { floorByMode: { condition: 0.02 } }), []);
  // terræn-kraft (neutral) påvirkes ikke af condition-gulvet
  const neutral = [{ ability: "tempo", terrain: "mountain", mode: "neutral", rankGain: 0.04 }];
  assert.equal(evaluateAbilityLivenessOracle(neutral, { floorByMode: { condition: 0.02 } }).length, 1);
});
