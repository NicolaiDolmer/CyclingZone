import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateS2RealizedSources,
  buildRiderSalaryRows,
  buildSettlementSteps,
  buildSeasonSwitchPreview,
  summarizeRiderSalaryRows,
} from "./seasonSwitchPreview.js";

const tx = (reason_code, amount) => ({ reason_code, amount });

test("aggregateS2RealizedSources — sponsor_season_start is ONE combined bucket (base+performance, single SEASON_START_SPONSOR tx)", () => {
  const result = aggregateS2RealizedSources([
    tx("season_start_sponsor", 250000),
    tx("midseason_sponsor_prorata", 10000),
  ]);
  assert.equal(result.sponsor_season_start, 260000);
});

test("aggregateS2RealizedSources — sponsor_in_season_bonus is a SEPARATE bucket from sponsor_season_start", () => {
  const result = aggregateS2RealizedSources([
    tx("season_start_sponsor", 250000),
    tx("sponsor_race_day", 5000),
    tx("sponsor_result_bonus", 2000),
    tx("sponsor_objective_bonus", 1000),
    tx("sponsor_signing_bonus", 3000),
  ]);
  assert.equal(result.sponsor_season_start, 250000);
  assert.equal(result.sponsor_in_season_bonus, 11000);
});

test("aggregateS2RealizedSources — groups the remaining reason_codes into their own buckets", () => {
  const result = aggregateS2RealizedSources([
    tx("race_prize_payout", 30000),
    tx("season_end_division_bonus", 4000),
    tx("season_start_upkeep", -140000),
    tx("season_start_facility_upkeep", -12000),
    tx("season_start_staff_salary", -19500),
    tx("season_start_academy_drift", -35000),
    // unrelated codes must be ignored, not lumped into any bucket
    tx("transfer_purchase", -50000),
    tx(null, 100),
  ]);
  assert.equal(result.prize, 34000);
  assert.equal(result.upkeep, -140000);
  assert.equal(result.facility_upkeep, -12000);
  assert.equal(result.staff_salary, -19500);
  assert.equal(result.academy_drift, -35000);
  // facility_upkeep and staff_salary are no longer folded into a combined
  // field anywhere (#4011 revision 20/8, split everywhere).
  assert.equal(result.staff_facilities, undefined);
});

test("aggregateS2RealizedSources — empty/undefined input returns all-zero buckets", () => {
  const result = aggregateS2RealizedSources([]);
  assert.equal(result.sponsor_season_start, 0);
  assert.equal(result.sponsor_in_season_bonus, 0);
  assert.deepEqual(aggregateS2RealizedSources(undefined), result);
});

test("buildRiderSalaryRows — computeFrozenSalary drives s3_salary_projection, riders.salary drives contract_salary", () => {
  const rows = buildRiderSalaryRows([
    { id: "r1", firstname: "A", lastname: "One", salary: 10000, current_production_value: 40000 },
    { id: "r2", firstname: "B", lastname: "Two", salary: 5000, current_production_value: 0 },
    { id: null, salary: 999 }, // must be filtered out (no id)
  ]);
  assert.equal(rows.length, 2);
  // SALARY_RATE_PRODUCTION = 0.35 (economyConstants.js)
  assert.equal(rows[0].contract_salary, 10000);
  assert.equal(rows[0].s3_salary_projection, Math.max(1, Math.round(40000 * 0.35)));
  assert.equal(rows[0].delta, rows[0].s3_salary_projection - 10000);
  // current_production_value=0 → falls back to CONTRACT.BASE_VALUE_FALLBACK inside computeFrozenSalary
  assert.ok(rows[1].s3_salary_projection > 0);
});

test("summarizeRiderSalaryRows — sums contract vs projection totals", () => {
  const rows = buildRiderSalaryRows([
    { id: "r1", salary: 10000, current_production_value: 40000 },
    { id: "r2", salary: 20000, current_production_value: 80000 },
  ]);
  const summary = summarizeRiderSalaryRows(rows);
  assert.equal(summary.rider_count, 2);
  assert.equal(summary.total_contract_salary, 30000);
  assert.equal(summary.total_s3_salary_projection, rows[0].s3_salary_projection + rows[1].s3_salary_projection);
  assert.equal(summary.total_delta, summary.total_s3_salary_projection - 30000);
});

const S3_MAPPED_FIXTURE = Object.freeze({
  sponsor_base: 200000,
  sponsor_variable: 50000,
  loan_interest: -8000,
  salary: -179550,
  academy_drift: -5000,
  upkeep: -140000,
  facility_upkeep: -12000,
  staff_salary: -19500,
});

test("buildSettlementSteps — follows the REAL processTeamSeasonPayroll cash order: sponsor -> loan interest -> salary -> academy -> upkeep -> facility -> staff", () => {
  const steps = buildSettlementSteps({ startingBalance: 100000, s3Mapped: S3_MAPPED_FIXTURE });
  assert.deepEqual(
    steps.map((s) => s.key),
    ["books_close", "sponsor", "loan_interest", "salary", "academy_drift", "upkeep", "facility_upkeep", "staff_salary", "start_s3"],
  );
});

test("buildSettlementSteps — sponsor step credits base+variable COMBINED (one real transaction), carries both as extra fields", () => {
  const steps = buildSettlementSteps({ startingBalance: 0, s3Mapped: S3_MAPPED_FIXTURE });
  const sponsorStep = steps.find((s) => s.key === "sponsor");
  assert.equal(sponsorStep.amount, 250000); // 200000 + 50000, credited as one payment
  assert.equal(sponsorStep.base, 200000);
  assert.equal(sponsorStep.variable, 50000);
});

test("buildSettlementSteps — salary step is a REAL charge (never 0/'no charge'), using the S3-recomputed sum", () => {
  const steps = buildSettlementSteps({ startingBalance: 500000, s3Mapped: S3_MAPPED_FIXTURE });
  const salaryStep = steps.find((s) => s.key === "salary");
  assert.equal(salaryStep.amount, -179550);
  assert.notEqual(salaryStep.amount, 0);
});

test("buildSettlementSteps — running balance is correct through the full real order", () => {
  const steps = buildSettlementSteps({ startingBalance: 100000, s3Mapped: S3_MAPPED_FIXTURE });
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(byKey.books_close.balance_after, 100000);
  assert.equal(byKey.sponsor.balance_after, 100000 + 250000);
  assert.equal(byKey.loan_interest.balance_after, 350000 - 8000);
  assert.equal(byKey.salary.balance_after, 342000 - 179550);
  assert.equal(byKey.academy_drift.balance_after, 162450 - 5000);
  assert.equal(byKey.upkeep.balance_after, 157450 - 140000);
  assert.equal(byKey.facility_upkeep.balance_after, 17450 - 12000);
  assert.equal(byKey.staff_salary.balance_after, 5450 - 19500);
  const last = steps[steps.length - 1];
  assert.equal(last.key, "start_s3");
  assert.equal(last.balance_after, byKey.staff_salary.balance_after);
  assert.equal(last.balance_after, -14050);
});

test("buildSettlementSteps — zero-amount optional steps are OMITTED (loan interest, academy, upkeep, facility, staff), never a synthetic '0/no-charge' row", () => {
  const steps = buildSettlementSteps({
    startingBalance: 100000,
    s3Mapped: { sponsor_base: 200000, sponsor_variable: 0, loan_interest: 0, salary: -50000, academy_drift: 0, upkeep: 0, facility_upkeep: 0, staff_salary: 0 },
  });
  assert.deepEqual(steps.map((s) => s.key), ["books_close", "sponsor", "salary", "start_s3"]);
  // #4011 revision: no "salary_switch" step exists any more.
  assert.ok(!steps.some((s) => s.key === "salary_switch"));
});

test("buildSettlementSteps — missing s3Mapped fields default to 0 (never throws)", () => {
  const steps = buildSettlementSteps({ startingBalance: 500, s3Mapped: null });
  assert.equal(steps[steps.length - 1].balance_after, 500);
});

test("buildSeasonSwitchPreview — combines s2/s3/settlement/riders into one payload; settlement salary matches the rider table total (#4011 cross-check requirement)", () => {
  const result = buildSeasonSwitchPreview({
    transactions: [
      tx("season_start_sponsor", 250000),
      tx("sponsor_race_day", 4000),
      tx("season_start_upkeep", -140000),
    ],
    riders: [
      { id: "r1", firstname: "A", lastname: "One", salary: 10000, current_production_value: 264600 }, // s3 -> 92610
      { id: "r2", firstname: "B", lastname: "Two", salary: 8000, current_production_value: 239400 }, // s3 -> 83790
    ],
    startingBalance: 200000,
    s3: {
      projected_sponsor_base: 180000,
      projected_sponsor_variable: 0,
      prize_low: 1000,
      prize_high: 5000,
      // Must match the rider table total exactly — same formula call.
      projected_salary: -(92610 + 83790),
      projected_loan_interest: -1000,
      projected_upkeep: -140000,
      projected_facility_upkeep: -12000,
      projected_staff_salary: -19500,
      projected_academy_drift: 0,
      projected_net: 12345,
    },
  });

  // S2 salary is the CONTRACT sum, not a finance_transactions aggregate.
  assert.equal(result.s2.salary, -18000);
  assert.equal(result.s2.salary_is_contract, true);
  // S2 sponsor: base and in-season-bonus are SEPARATE, honest buckets.
  assert.equal(result.s2.sponsor_season_start, 250000);
  assert.equal(result.s2.sponsor_in_season_bonus, 4000);
  assert.equal(result.s2.upkeep, -140000);

  assert.equal(result.s3.sponsor_base, 180000);
  assert.equal(result.s3.loan_interest, -1000);
  assert.equal(result.s3.net, 12345);

  // Settlement's salary step (the real cutover charge) must equal s3.salary,
  // which must equal the rider table's total_s3_salary_projection negated —
  // one number, three places, zero drift.
  const salaryStep = result.settlement.steps.find((s) => s.key === "salary");
  assert.equal(salaryStep.amount, result.s3.salary);
  assert.equal(-salaryStep.amount, result.riders.summary.total_s3_salary_projection);

  // Settlement math: sum of all step deltas == ending_balance - starting_balance.
  const sumOfDeltas = result.settlement.steps.reduce((sum, s) => sum + (s.amount || 0), 0);
  assert.equal(sumOfDeltas, result.settlement.ending_balance - result.settlement.starting_balance);

  assert.equal(result.riders.rows.length, 2);
  assert.equal(result.riders.summary.total_contract_salary, 18000);
  assert.equal(result.riders.summary.total_s3_salary_projection, 92610 + 83790);
});
