import test from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY_KEYS,
  outputScore,
  predictBaseValue,
  riderOverall,
  riderSpecialty,
} from "./riderValuation.js";

const abilities = (val = 50, extra = {}) => {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = val;
  return { ...a, ...extra };
};

test("outputScore averages the positive type-weights (flat abilities → that value)", () => {
  // Alle abilities = 50 → vægtet snit = 50 uanset type.
  assert.equal(outputScore(abilities(50), "gc"), 50);
  assert.equal(outputScore(abilities(50), "sprinter"), 50);
});

test("outputScore rewards a rider strong in their speciale", () => {
  // gc vægter climbing/time_trial/tempo/recovery højt.
  const strongGc = outputScore(abilities(40, { climbing: 90, time_trial: 90, tempo: 90, recovery: 90 }), "gc");
  const weakGc = outputScore(abilities(40), "gc");
  assert.ok(strongGc > weakGc, `stærk gc (${strongGc}) skal slå svag (${weakGc})`);
});

test("outputScore falls back to mean of abilities for unknown type", () => {
  assert.equal(outputScore(abilities(60), null), 60);
  assert.equal(outputScore(abilities(60), "ikke-en-type"), 60);
});

test("predictBaseValue = exp(a + b·output + offset[type])", () => {
  const model = { a: Math.log(1000), b: 0, offset: {} };
  // b=0 → output irrelevant → exp(a) = 1000.
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 1000);
});

test("predictBaseValue applies the type-offset", () => {
  const model = { a: Math.log(1000), b: 0, offset: { gc: Math.log(2) } };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 2000);
  // Type uden offset → neutral (offset 0).
  assert.equal(predictBaseValue({ primary_type: "sprinter" }, abilities(50), model), 1000);
});

test("predictBaseValue rises with output when b>0", () => {
  const model = { a: 0, b: 0.05, offset: {} };
  const lo = predictBaseValue({ primary_type: "gc" }, abilities(40), model);
  const hi = predictBaseValue({ primary_type: "gc" }, abilities(80), model);
  assert.ok(hi > lo, `højere output skal give højere værdi (${hi} > ${lo})`);
});

test("predictBaseValue returns null when abilities are missing", () => {
  const model = { a: 1, b: 0.1, offset: {} };
  assert.equal(predictBaseValue({ primary_type: "gc" }, {}, model), null);
  assert.equal(predictBaseValue({ primary_type: "gc" }, null, model), null);
});

test("predictBaseValue returns null without a usable model", () => {
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(), null), null);
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(), { offset: {} }), null);
});

test("predictBaseValue has no floor (worst riders can be small)", () => {
  // Lav a + lav output → lille værdi, ingen klamp opad til et gulv.
  const model = { a: Math.log(800), b: 0, offset: {} };
  assert.equal(predictBaseValue({ primary_type: "gc" }, abilities(50), model), 800);
});

test("riderSpecialty returns the top ability", () => {
  assert.equal(riderSpecialty(abilities(40, { climbing: 95 })), "climbing");
  assert.equal(riderSpecialty(abilities(40, { sprint: 88 })), "sprint");
});

test("riderOverall is the mean of abilities, clamped 0-99", () => {
  assert.equal(riderOverall(abilities(50)), 50);
  const high = riderOverall(abilities(99));
  assert.ok(high >= 0 && high <= 99);
});
