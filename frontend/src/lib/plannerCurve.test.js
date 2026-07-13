import { test } from "node:test";
import assert from "node:assert/strict";
import { formValueAt, sampleFormCurves, CURVE_PEAK_AMPLITUDE } from "./plannerCurve.js";

const peak = { windowStartOrd: 100, windowEndOrd: 104, trainingQuality: 0.5 };
const center = 102;

test("formValueAt: potentiel top > realiseret top (koblingen synlig)", () => {
  const potential = formValueAt(center, 50, [peak], { realized: false });
  const realized = formValueAt(center, 50, [peak], { realized: true });
  assert.ok(potential > realized, `${potential} > ${realized}`);
  // Realiseret ≈ baseline + amp*tq; potentiel ≈ baseline + amp.
  assert.ok(potential - realized > 10, "kløften skal være mærkbar ved tq=0.5");
});

test("formValueAt: fuldt trænet (tq=1) → potentiel = realiseret", () => {
  const full = { ...peak, trainingQuality: 1 };
  assert.ok(Math.abs(formValueAt(center, 50, [full], { realized: false }) - formValueAt(center, 50, [full], { realized: true })) < 0.001);
});

test("formValueAt: langt fra peak ≈ baseline", () => {
  assert.ok(Math.abs(formValueAt(40, 50, [peak], { realized: true }) - 50) < 1);
});

test("formValueAt: payback-hul efter vinduet → under baseline", () => {
  const v = formValueAt(107, 50, [peak], { realized: true, paybackDays: 7 });
  assert.ok(v < 50, `payback-værdi ${v} skal være under baseline 50`);
});

test("formValueAt: klampes til [0,100]", () => {
  const hot = { windowStartOrd: 100, windowEndOrd: 104, trainingQuality: 1 };
  assert.ok(formValueAt(center, 95, [hot], { realized: false }) <= 100);
  assert.ok(formValueAt(center, 0, [], {}) >= 0);
});

test("sampleFormCurves: returnerer samples+1 punkter, potentiel ≥ realiseret ved peak", () => {
  const c = sampleFormCurves({ baseline: 50, peaks: [peak], startOrd: 80, endOrd: 130, samples: 50 });
  assert.equal(c.potential.length, 51);
  assert.equal(c.realized.length, 51);
  for (let i = 0; i < c.potential.length; i++) assert.ok(c.potential[i] >= c.realized[i] - 1e-9);
});

test("CURVE_PEAK_AMPLITUDE er en positiv display-konstant", () => {
  assert.ok(CURVE_PEAK_AMPLITUDE > 0);
});
