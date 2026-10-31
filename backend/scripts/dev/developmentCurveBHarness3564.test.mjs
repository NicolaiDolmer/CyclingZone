// #3564: harnessens rene dele. Params er syntetiske testværdier (den rigtige
// kalibrering er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDevelopmentCurveBParams } from "../../lib/developmentCurveB.ts";
import {
  HARNESS_DEFAULTS, difficultyRatio, evaluateGates, makeCohort, runCohort, steadyStateTop50, topReachedBy28,
} from "./developmentCurveBHarness3564.mjs";

const CURVE = validateDevelopmentCurveBParams({
  rate: 40, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 }, potentialCeiling: [0.4, 0.5, 0.6, 0.7, 0.85, 1],
});
const SHARES = { young: 0.1, old: 0.1 };
const OPTS = { ...HARNESS_DEFAULTS, raceDaysPerSeason: 20 };

test("kuld fra generatoren er deterministisk", () => {
  const a = makeCohort(5, { seed: "t" });
  const b = makeCohort(5, { seed: "t" });
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  assert.ok(a.every((r) => r.age === HARNESS_DEFAULTS.startAge && r.primary_type));
});

test("et kuld under kurven: ingen ratingfald, maks +1 pr. dato og pr. løbsdag, bane pr. alder", () => {
  const { riders, totals } = runCohort(makeCohort(4, { seed: "t2" }), { curveB: CURVE, shares: SHARES, opts: OPTS, endAge: 20 });
  assert.equal(totals.ratingDrops, 0);
  assert.equal(totals.overPerDate, 0);
  assert.equal(totals.overPerTick, 0);
  for (const r of riders) assert.deepEqual(r.trajectory.map((t) => t.age), [17, 18, 19, 20]);
});

test("målinger og gates: form og retning", () => {
  const riders = [
    { id: "a", trajectory: [{ age: 27, rating: 50 }, { age: 28, rating: 52 }, { age: 29, rating: 53 }] },
    { id: "b", trajectory: [{ age: 28, rating: 40 }, { age: 29, rating: 44 }] },
  ];
  assert.equal(topReachedBy28(riders), 50);
  const top = steadyStateTop50(riders, { minAge: 17, size: 2 });
  assert.equal(top.n, 2);
  assert.ok(difficultyRatio({ curveB: CURVE, low: 10, high: 85, cap: 95, age: 26 }) > difficultyRatio({ curveB: null, low: 10, high: 85, cap: 95, age: 26 }),
    "kurven gør lav-mod-høj-forskellen større end i dag");
  const gates = evaluateGates({
    milestones: { alle: { pct22: 60, pct25: 85, peakAgeMedian: 27.5 } },
    top50: { medianAge: 27.5, le23: 0 }, totals: { ratingDrops: 0, overPerDate: 0, overPerTick: 0 },
    existing: { ratingDrops: 0 }, difficulty: { curveB: 3, today: 2 },
  }, { tolerance: { pct: 1, top50MedianAge: 1, top50MaxLe23: 0 } });
  assert.ok(gates.every((g) => g.pass), JSON.stringify(gates));
  const failing = evaluateGates({
    milestones: { alle: { pct22: 80, pct25: 92, peakAgeMedian: 29 } },
    top50: { medianAge: 24, le23: 20 }, totals: { ratingDrops: 1, overPerDate: 1, overPerTick: 0 },
    existing: { ratingDrops: 0 }, difficulty: { curveB: 1, today: 2 },
  }, { tolerance: { pct: 1, top50MedianAge: 1, top50MaxLe23: 0 } });
  assert.ok(failing.every((g) => !g.pass), "dagens frontloadede form fejler alle gates");
});
