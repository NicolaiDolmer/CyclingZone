import test from "node:test";
import assert from "node:assert/strict";

import {
  calibrateSalaryRate, projectedSalary, wageBillsByDivision,
  wageBillContinuityGate, talentFixGate, runawayGate,
} from "./salaryDecoupling.js";

// rows: { current_production_value, current_salary, division, is_talent }
const ROWS = [
  { current_production_value: 100_000, current_salary: 30_000, division: 1 },
  { current_production_value: 200_000, current_salary: 60_000, division: 1 },
  { current_production_value: 50_000, current_salary: 15_000, division: 2 },
];

test("calibrateSalaryRate: bevarer den globale lønbyrde (Σsalary / Σcpv)", () => {
  const rate = calibrateSalaryRate(ROWS);
  // (30k+60k+15k) / (100k+200k+50k) = 105k / 350k = 0,3
  assert.ok(Math.abs(rate - 0.3) < 1e-9, `rate=${rate}`);
  const projTotal = ROWS.reduce((s, r) => s + projectedSalary(r.current_production_value, rate), 0);
  const curTotal = ROWS.reduce((s, r) => s + r.current_salary, 0);
  assert.ok(Math.abs(projTotal - curTotal) <= ROWS.length, `proj ${projTotal} ≈ cur ${curTotal}`);
});

test("calibrateSalaryRate: ignorerer rækker uden salary/cpv; tom → null", () => {
  const rate = calibrateSalaryRate([
    { current_production_value: 100_000, current_salary: 30_000, division: 1 },
    { current_production_value: 0, current_salary: 999, division: 1 },
    { current_production_value: 5000, current_salary: null, division: 1 },
  ]);
  assert.ok(Math.abs(rate - 0.3) < 1e-9);
  assert.equal(calibrateSalaryRate([]), null);
});

test("projectedSalary: max(1, round(cpv·rate))", () => {
  assert.equal(projectedSalary(100_000, 0.3), 30_000);
  assert.equal(projectedSalary(0, 0.3), 1);
  assert.equal(projectedSalary(2, 0.3), 1);
});

test("wageBillsByDivision: summerer nuværende + projiceret pr. division", () => {
  const bills = wageBillsByDivision(ROWS, 0.3);
  assert.equal(bills[1].current, 90_000);
  assert.equal(bills[1].projected, 90_000);
  assert.equal(bills[1].count, 2);
  assert.equal(bills[2].current, 15_000);
});

test("wageBillContinuityGate (G1): pass når hver division er inden for tolerance", () => {
  const bills = wageBillsByDivision(ROWS, 0.3);
  assert.equal(wageBillContinuityGate(bills, 0.15).pass, true);
  const drifted = { 1: { current: 100_000, projected: 140_000, count: 2 } };
  assert.equal(wageBillContinuityGate(drifted, 0.15).pass, false);
});

test("talentFixGate (G2): talent-løn < sponsor OG lavere løn/værdi end i dag", () => {
  const talents = [{ current_production_value: 60_000, value_v4: 5_560_000 }];
  const g = talentFixGate(talents, 0.3, { sponsor: 240_000, oldRate: 0.067 });
  assert.equal(g.pass, true, JSON.stringify(g));
  assert.equal(talentFixGate(talents, 4.0, { sponsor: 240_000, oldRate: 0.067 }).pass, false);
});

test("runawayGate (G4): ingen projiceret løn over loft", () => {
  const rows = [{ current_production_value: 100_000 }, { current_production_value: 900_000 }];
  // rate 0,3 → løn 30k og 270k, maks 270k.
  assert.equal(runawayGate(rows, 0.3, 240_000).pass, false); // maks 270k > 240k → fejl
  assert.equal(runawayGate(rows, 0.3, 300_000).pass, true);  // maks 270k ≤ 300k → pass
});
