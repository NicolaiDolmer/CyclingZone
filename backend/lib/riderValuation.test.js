import test from "node:test";
import assert from "node:assert/strict";

import {
  ABILITY_KEYS,
  FEATURE_KEYS,
  riderAge,
  featurizeRider,
  predictBaseValue,
  riderOverall,
  riderSpecialty,
} from "./riderValuation.js";

const abilities = (val = 50, extra = {}) => {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = val;
  return { ...a, ...extra };
};

// Minimal model: alle coef=0 → predict = exp(intercept) for enhver rytter m. abilities.
const flatModel = (intercept, { floor = 0, convexity = 1 } = {}) => {
  const coef = {}, means = {}, stds = {};
  for (const k of FEATURE_KEYS) { coef[k] = 0; means[k] = 0; stds[k] = 1; }
  return { intercept, coef, means, stds, convexity_exponent: convexity, log_mean: intercept, floor };
};

test("riderAge computes whole years against a reference date", () => {
  assert.equal(riderAge("2000-06-06", "2026-06-06"), 26);
  assert.equal(riderAge(null, "2026-06-06"), null);
  assert.equal(riderAge("not-a-date", "2026-06-06"), null);
});

test("featurizeRider maps abilities + derives age/age_sq", () => {
  const f = featurizeRider({ birthdate: "2000-06-06", potentiale: 5, popularity: 10, is_u25: false }, abilities(60), { asOf: "2026-06-06" });
  assert.equal(f.climbing, 60);
  assert.equal(f.age, 26);
  assert.equal(f.age_sq, 26 * 26);
  assert.equal(f.potentiale, 5);
  assert.equal(f.popularity, 10);
  assert.equal(f.is_u25, 0);
});

test("featurizeRider treats null popularity as 0", () => {
  const f = featurizeRider({ popularity: null }, abilities(), {});
  assert.equal(f.popularity, 0);
});

test("predictBaseValue returns exp(intercept) for a zero-coefficient model", () => {
  const m = flatModel(Math.log(50000));
  const v = predictBaseValue({ birthdate: "2000-06-06" }, abilities(50), m, { asOf: "2026-06-06" });
  assert.ok(Math.abs(v - 50000) < 1, `forventede ~50000, fik ${v}`);
});

test("predictBaseValue clamps to the soft floor", () => {
  const m = flatModel(Math.log(1000), { floor: 20000 });
  const v = predictBaseValue({}, abilities(50), m, {});
  assert.equal(v, 20000);
});

test("predictBaseValue returns null when abilities are missing", () => {
  const m = flatModel(Math.log(50000));
  assert.equal(predictBaseValue({}, {}, m, {}), null);
  assert.equal(predictBaseValue({}, null, m, {}), null);
});

test("predictBaseValue returns null without a model", () => {
  assert.equal(predictBaseValue({}, abilities(), null, {}), null);
});

test("convexity exponent widens spread away from log_mean", () => {
  // intercept over log_mean → gamma>1 skubber værdien endnu højere.
  const m = flatModel(Math.log(100000), { convexity: 2 });
  m.log_mean = Math.log(50000);
  // Med coef=0 er logPred=intercept=ln(100000); adj = log_mean + (logPred-log_mean)*2
  const v = predictBaseValue({}, abilities(), m, {});
  assert.ok(v > 100000, `gamma>1 skal hæve værdien over rå, fik ${v}`);
});

test("riderSpecialty returns the top ability", () => {
  assert.equal(riderSpecialty(abilities(40, { climbing: 95 })), "climbing");
  assert.equal(riderSpecialty(abilities(40, { sprint: 88 })), "sprint");
});

test("riderOverall stays within 0-99 and weights by model coefs", () => {
  const m = flatModel(0);
  m.coef.climbing = 1; // kun klatring vægter
  const climber = riderOverall(abilities(20, { climbing: 90 }), m);
  const sprinter = riderOverall(abilities(20, { sprint: 90 }), m);
  assert.ok(climber >= 0 && climber <= 99);
  assert.ok(climber > sprinter, "klatrer skal score højere når kun climbing vægter");
});
