// #2216 A4 — Task 6: ability-drevet effekt-model (staffEffectFactor + specializationMatch)
// + rating-drevet staff-løn (staffSalaryFor). Erstatter A3's tier→udnyttelses-skalar.
// TDD-tests: gulv-adfærd, monotoni, specialiserings-loft/baseline, løn-kurve + bånd.
import test from "node:test";
import assert from "node:assert/strict";
import { staffEffectFactor, specializationMatch, effectiveBonus } from "./facilityEngine.js";
import {
  staffSalaryFor,
  STAFF_EFFECT_FACTOR_FLOOR,
  STAFF_EFFECT_FACTOR_SLOPE,
  STAFF_SPECIALIZATION,
  STAFF_SALARY_CURVE,
  FACILITY_BASE_EFFECT,
} from "./facilityConstants.js";

// ── staffEffectFactor ─────────────────────────────────────────────────────────

test("staffEffectFactor(null) = gulv STAFF_EFFECT_FACTOR_FLOOR", () => {
  // Rekalibreret (ejer-valg 2026-07-05, ±15%-gate): gulvet restaureret til 0.5.
  assert.equal(staffEffectFactor(null), STAFF_EFFECT_FACTOR_FLOOR);
  assert.equal(staffEffectFactor(null), 0.5);
  assert.equal(staffEffectFactor(undefined), 0.5);
});

test("staffEffectFactor({overall:99}) = gulv + hældning = 1.0", () => {
  assert.ok(Math.abs(staffEffectFactor({ overall: 99 }) - (STAFF_EFFECT_FACTOR_FLOOR + STAFF_EFFECT_FACTOR_SLOPE)) < 1e-9);
  assert.ok(Math.abs(staffEffectFactor({ overall: 99 }) - 1.0) < 1e-9);
});

test("staffEffectFactor: gulv ved overall 0, lineær i overall", () => {
  assert.ok(Math.abs(staffEffectFactor({ overall: 0 }) - STAFF_EFFECT_FACTOR_FLOOR) < 1e-9);
  // midtpunkt (rekalibreret): FLOOR + SLOPE·(50/99) = 0.5 + 0.5·(50/99)
  assert.ok(Math.abs(staffEffectFactor({ overall: 50 }) - (STAFF_EFFECT_FACTOR_FLOOR + STAFF_EFFECT_FACTOR_SLOPE * (50 / 99))) < 1e-9);
});

test("staffEffectFactor: strengt monotont stigende i overall", () => {
  let prev = -Infinity;
  for (let o = 0; o <= 99; o += 3) {
    const f = staffEffectFactor({ overall: o });
    assert.ok(f > prev, `overall ${o}: ${f} ikke > ${prev}`);
    prev = f;
  }
});

// ── specializationMatch ───────────────────────────────────────────────────────

test("specializationMatch: baseline 1.0 for generalist / manglende akse", () => {
  // Ingen staff → 1.0 (nul effekt).
  assert.equal(specializationMatch(null, { dimension: "physical", level: "youth" }), 1.0);
  // Staff uden dimensions/levels (fx ikke-training rolle uden de akser) → 1.0.
  assert.equal(specializationMatch({ overall: 70 }, { dimension: "physical", level: "youth" }), 1.0);
  // En perfekt generalist (alle akser = baseline-referencen) → 1.0.
  const generalist = {
    overall: STAFF_SPECIALIZATION.baselineOverall,
    dimensions: { physical: STAFF_SPECIALIZATION.baselineOverall, mental: STAFF_SPECIALIZATION.baselineOverall, technical: STAFF_SPECIALIZATION.baselineOverall },
    levels: { youth: STAFF_SPECIALIZATION.baselineOverall, junior: STAFF_SPECIALIZATION.baselineOverall, senior: STAFF_SPECIALIZATION.baselineOverall },
  };
  assert.ok(Math.abs(specializationMatch(generalist, { dimension: "physical", level: "youth" }) - 1.0) < 1e-9);
});

test("specializationMatch: > 1.0 når chefens dimension + niveau er stærke", () => {
  const strong = {
    overall: 80,
    dimensions: { physical: 95, mental: 40, technical: 40 },
    levels: { youth: 95, junior: 40, senior: 40 },
  };
  const m = specializationMatch(strong, { dimension: "physical", level: "youth" });
  assert.ok(m > 1.0, `forventede >1.0, fik ${m}`);
  // Og ≤ loftet.
  assert.ok(m <= STAFF_SPECIALIZATION.cap + 1e-9, `over loft: ${m}`);
});

test("specializationMatch: svag akse giver < baseline-boost (men aldrig < gulv)", () => {
  const strong = { overall: 80, dimensions: { physical: 95, mental: 40, technical: 40 }, levels: { youth: 95, junior: 40, senior: 40 } };
  const onStrong = specializationMatch(strong, { dimension: "physical", level: "youth" });
  const onWeak = specializationMatch(strong, { dimension: "mental", level: "senior" });
  assert.ok(onStrong > onWeak, "stærk akse skal matche højere end svag akse");
  assert.ok(onWeak >= STAFF_SPECIALIZATION.floor - 1e-9, `under gulv: ${onWeak}`);
});

test("specializationMatch: loftet håndhæves ved max akser", () => {
  // Rekalibreret (ejer-valg 2026-07-05): med de restaurerede vægte (0.25 + 0.15) rammer
  // MAX-akser (99,99) præcis 1 + 0.25 + 0.15 = 1.4 = cap. Cap'en er dermed BINDENDE ved
  // ekstremer (og lig raw-værdien her); invariant: aldrig over cap.
  const max = { overall: 99, dimensions: { physical: 99, mental: 99, technical: 99 }, levels: { youth: 99, junior: 99, senior: 99 } };
  const m = specializationMatch(max, { dimension: "physical", level: "youth" });
  assert.ok(m <= STAFF_SPECIALIZATION.cap + 1e-9, `over loft: ${m}`);
  assert.ok(Math.abs(m - STAFF_SPECIALIZATION.cap) < 1e-9, `forventede cap ${STAFF_SPECIALIZATION.cap}, fik ${m}`);
});

// ── staffSalaryFor ────────────────────────────────────────────────────────────

test("staffSalaryFor: strengt monotont stigende i overall", () => {
  let prev = -Infinity;
  for (let o = 20; o <= 99; o += 2) {
    const s = staffSalaryFor(o);
    assert.ok(s > prev, `overall ${o}: løn ${s} ikke > ${prev}`);
    prev = s;
  }
});

test("staffSalaryFor: i kalibrerings-bånd (positiv, loftet)", () => {
  // Rating-drevet løn skal ligge i et fornuftigt bånd over hele overall-spannet.
  const lo = staffSalaryFor(STAFF_SALARY_CURVE.minOverall);
  const hi = staffSalaryFor(99);
  assert.ok(lo >= STAFF_SALARY_CURVE.floor, `bund-løn ${lo} under gulv ${STAFF_SALARY_CURVE.floor}`);
  assert.ok(hi <= STAFF_SALARY_CURVE.cap, `top-løn ${hi} over loft ${STAFF_SALARY_CURVE.cap}`);
  assert.ok(hi > lo, "top-løn skal være over bund-løn");
});

test("staffSalaryFor: heltal (rene CZ$)", () => {
  for (const o of [30, 50, 70, 90, 99]) assert.equal(staffSalaryFor(o), Math.round(staffSalaryFor(o)));
});

// ── effectiveBonus (ny model) ─────────────────────────────────────────────────

test("effectiveBonus: display-magnitude = base × staffEffectFactor (INGEN specialisering)", () => {
  // Med staff-objekt (overall 99): fuld faktor 1.0.
  assert.equal(effectiveBonus("training", 5, { overall: 99 }), FACILITY_BASE_EFFECT.training[5] * 1.0);
  // Uden staff (null): gulv (rekalibreret 0.5).
  assert.equal(effectiveBonus("training", 5, null), FACILITY_BASE_EFFECT.training[5] * STAFF_EFFECT_FACTOR_FLOOR);
  // Intet bygget = 0.
  assert.equal(effectiveBonus("training", 0, null), 0);
  // Ukendt track = 0.
  assert.equal(effectiveBonus("bogus", 3, { overall: 80 }), 0);
});

test("effectiveBonus: bagud-kompat — integer staffTier stadig gyldigt kald", () => {
  // Adapter: et heltals-tier skal fortsat give en gyldig, monoton bonus (A3-UI/A1-service-kald).
  const t5 = effectiveBonus("training", 5, 5);
  const t1 = effectiveBonus("training", 5, 1);
  const none = effectiveBonus("training", 5, null);
  assert.ok(t5 > t1, "højere tier → højere bonus");
  assert.ok(t1 > none, "tier 1 > ingen staff");
  assert.ok(t5 <= FACILITY_BASE_EFFECT.training[5] + 1e-9, "aldrig over base (faktor ≤ 1)");
});
