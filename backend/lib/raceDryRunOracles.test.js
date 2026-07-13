import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRaceStructuralOracles, minDistinctWinners, evaluateAbilityLivenessOracle, evaluateIncidentBoundsOracle, evaluatePeakCouplingScorecard, evaluatePeakNeutralityOracle } from "./raceDryRunOracles.js";

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

// ── evaluateIncidentBoundsOracle (S4, #1176) ─────────────────────────────────

const healthyIncidentStats = (over = {}) => ({
  stages: 300,
  meanDnfRatePct: 0.8,
  meanIncidentRatePct: 3.0,
  maxIncidentSharePct: 4.5,
  abandonShareOfIncidents: 0.25,
  perProfile: {
    itt: { stages: 50, meanDnfRatePct: 0.1, meanIncidentRatePct: 0.3 },
    flat: { stages: 100, meanDnfRatePct: 0.7, meanIncidentRatePct: 2.5 },
    cobbles: { stages: 50, meanDnfRatePct: 1.2, meanIncidentRatePct: 4.0 },
  },
  ...over,
});

test("incident-bounds-oracle: ingen data (stages=0) → ingen brud", () => {
  assert.deepEqual(evaluateIncidentBoundsOracle({ stages: 0 }), []);
  assert.deepEqual(evaluateIncidentBoundsOracle(null), []);
});

test("incident-bounds-oracle: sund kalibrering giver ingen brud", () => {
  assert.deepEqual(evaluateIncidentBoundsOracle(healthyIncidentStats()), []);
});

test("incident-bounds-oracle: DNF-rate under bånd fanges", () => {
  const failures = evaluateIncidentBoundsOracle(healthyIncidentStats({ meanDnfRatePct: 0.1 }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /DNF-rate/);
});

test("incident-bounds-oracle: DNF-rate over bånd fanges", () => {
  const failures = evaluateIncidentBoundsOracle(healthyIncidentStats({ meanDnfRatePct: 3.0 }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /DNF-rate/);
});

test("incident-bounds-oracle: hård cap-brud fanges (maxIncidentSharePct > cap)", () => {
  const failures = evaluateIncidentBoundsOracle(healthyIncidentStats({ maxIncidentSharePct: 6.5 }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /hård cap brudt/);
});

test("incident-bounds-oracle: cap er konfigurerbar via targets", () => {
  const stats = healthyIncidentStats({ maxIncidentSharePct: 6.5 });
  assert.deepEqual(evaluateIncidentBoundsOracle(stats, { maxFieldSharePct: 10 }), []);
});

test("incident-bounds-oracle: abandon-andel udenfor 25%±10pp fanges", () => {
  const tooLow = evaluateIncidentBoundsOracle(healthyIncidentStats({ abandonShareOfIncidents: 0.05 }));
  assert.equal(tooLow.length, 1);
  assert.match(tooLow[0], /abandon-andel/);

  const tooHigh = evaluateIncidentBoundsOracle(healthyIncidentStats({ abandonShareOfIncidents: 0.5 }));
  assert.equal(tooHigh.length, 1);
  assert.match(tooHigh[0], /abandon-andel/);
});

test("incident-bounds-oracle: ITT skal have LAVESTE uheldsrate — fanges hvis ikke", () => {
  const stats = healthyIncidentStats({
    perProfile: {
      itt: { stages: 50, meanDnfRatePct: 0.5, meanIncidentRatePct: 5.0 }, // højere end flat!
      flat: { stages: 100, meanDnfRatePct: 0.7, meanIncidentRatePct: 2.5 },
      cobbles: { stages: 50, meanDnfRatePct: 1.2, meanIncidentRatePct: 6.0 },
    },
  });
  const failures = evaluateIncidentBoundsOracle(stats);
  assert.equal(failures.filter((f) => f.startsWith("itt:")).length, 1);
});

test("incident-bounds-oracle: cobbles skal have HØJESTE uheldsrate — fanges hvis ikke", () => {
  const stats = healthyIncidentStats({
    perProfile: {
      itt: { stages: 50, meanDnfRatePct: 0.1, meanIncidentRatePct: 0.3 },
      flat: { stages: 100, meanDnfRatePct: 0.7, meanIncidentRatePct: 2.5 },
      cobbles: { stages: 50, meanDnfRatePct: 0.5, meanIncidentRatePct: 1.0 }, // lavere end flat!
    },
  });
  const failures = evaluateIncidentBoundsOracle(stats);
  assert.equal(failures.filter((f) => f.startsWith("cobbles:")).length, 1);
});

test("incident-bounds-oracle: ttt behandles som solo-profil på lige fod med itt", () => {
  const stats = healthyIncidentStats({
    perProfile: {
      ttt: { stages: 20, meanDnfRatePct: 0.05, meanIncidentRatePct: 0.2 },
      flat: { stages: 100, meanDnfRatePct: 0.7, meanIncidentRatePct: 2.5 },
      cobbles: { stages: 50, meanDnfRatePct: 1.2, meanIncidentRatePct: 4.0 },
    },
  });
  assert.deepEqual(evaluateIncidentBoundsOracle(stats), []);
});

test("incident-bounds-oracle: kun én profil (ingen sammenligning mulig) → ingen ordens-brud", () => {
  const stats = healthyIncidentStats({
    perProfile: { flat: { stages: 300, meanDnfRatePct: 0.8, meanIncidentRatePct: 3.0 } },
  });
  assert.deepEqual(evaluateIncidentBoundsOracle(stats), []);
});

// ── S5 (#2224): peak-koblings-scorecard ───────────────────────────────────────
// Kontrollerede eksperimenter (samme felt/seed, kun tq varierer): peak_realiseret
// skal skalere monotont med traeningskvalitet; payback er tq-uafhængig; "behind"
// (lav tq) får målbart mindre top end "on track" (høj tq).

const healthyCoupling = (over = {}) => ({
  ladder: [
    { tq: 0.0, peak: 0.004, meanRank: 8.0 },
    { tq: 0.5, peak: 0.010, meanRank: 5.5 },
    { tq: 1.0, peak: 0.020, meanRank: 3.0 },
  ],
  payback: [
    { tq: 0.0, payback: -0.01 },
    { tq: 1.0, payback: -0.01 },
  ],
  onTrackMeanRank: 3.0,
  behindMeanRank: 8.0,
  ...over,
});

test("peak-koblings-scorecard: sund baseline → ingen brud", () => {
  assert.deepEqual(evaluatePeakCouplingScorecard(healthyCoupling()), []);
});

test("peak-koblings-scorecard: peak IKKE monoton i tq → brud", () => {
  const obs = healthyCoupling({
    ladder: [
      { tq: 0.0, peak: 0.02, meanRank: 3.0 },  // høj peak ved tq=0 (invers)
      { tq: 0.5, peak: 0.01, meanRank: 5.5 },
      { tq: 1.0, peak: 0.004, meanRank: 8.0 },
    ],
  });
  const f = evaluatePeakCouplingScorecard(obs);
  assert.ok(f.some((x) => /monoton/i.test(x)), f.join(" | "));
});

test("peak-koblings-scorecard: payback afhænger af tq → brud", () => {
  const obs = healthyCoupling({ payback: [{ tq: 0.0, payback: -0.02 }, { tq: 1.0, payback: -0.005 }] });
  const f = evaluatePeakCouplingScorecard(obs);
  assert.ok(f.some((x) => /payback/i.test(x)), f.join(" | "));
});

test("peak-koblings-scorecard: on track ikke målbart bedre end behind → brud", () => {
  const obs = healthyCoupling({ onTrackMeanRank: 7.8, behindMeanRank: 8.0 }); // 0.2 < margin
  const f = evaluatePeakCouplingScorecard(obs, { minTopMargin: 1.0 });
  assert.ok(f.some((x) => /behind|top|margin/i.test(x)), f.join(" | "));
});

test("peak-koblings-scorecard: meanRank må ikke forværres når tq stiger", () => {
  const obs = healthyCoupling({
    ladder: [
      { tq: 0.0, peak: 0.004, meanRank: 3.0 },
      { tq: 0.5, peak: 0.010, meanRank: 5.5 },
      { tq: 1.0, peak: 0.020, meanRank: 8.0 }, // højere tq → værre placering (invers)
    ],
  });
  const f = evaluatePeakCouplingScorecard(obs);
  assert.ok(f.some((x) => /placering|rank/i.test(x)), f.join(" | "));
});

test("peak-koblings-scorecard: tom/manglende data → ingen brud (n/a som øvrige oracles)", () => {
  assert.deepEqual(evaluatePeakCouplingScorecard({}), []);
  assert.deepEqual(evaluatePeakCouplingScorecard(null), []);
});

// ── S5 (#2224): peak-neutralitets-oracle ──────────────────────────────────────
// To lige-stærke ryttere A og B i de samme to løb; A topper for løb 1, B for løb 2.
// Peaken skal virke DÉR den er sat, og INGEN må dominere begge løb (ellers lækker
// peaken globalt = bug). Ranks er middel over seeds; lavere = bedre.

const healthyNeutrality = (over = {}) => ({
  rankA_r1: 2.0, rankB_r1: 5.0, // A topper løb 1 → bedre dér
  rankA_r2: 5.0, rankB_r2: 2.0, // B topper løb 2 → bedre dér
  ...over,
});

test("peak-neutralitet: modsatte planer, hver dominerer kun eget mål → ingen brud", () => {
  assert.deepEqual(evaluatePeakNeutralityOracle(healthyNeutrality()), []);
});

test("peak-neutralitet: A dominerer BEGGE løb (peak lækker globalt) → brud", () => {
  const f = evaluatePeakNeutralityOracle(healthyNeutrality({ rankA_r2: 1.5, rankB_r2: 3.0 }));
  assert.ok(f.some((x) => /domin|begge|neutral/i.test(x)), f.join(" | "));
});

test("peak-neutralitet: peak virker ikke ved eget mål (A ikke bedre i løb 1) → brud", () => {
  const f = evaluatePeakNeutralityOracle(healthyNeutrality({ rankA_r1: 5.0, rankB_r1: 2.0 }));
  assert.ok(f.length > 0, "forventede brud når A ikke topper sit eget mål-løb");
});

test("peak-neutralitet: tom/manglende data → ingen brud", () => {
  assert.deepEqual(evaluatePeakNeutralityOracle({}), []);
  assert.deepEqual(evaluatePeakNeutralityOracle(null), []);
});
