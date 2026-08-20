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

test("aggregateS2RealizedSources — groups by reason_code into the 7 source buckets", () => {
  const result = aggregateS2RealizedSources([
    tx("season_start_sponsor", 240000),
    tx("midseason_sponsor_prorata", 10000),
    tx("sponsor_race_day", 5000),
    tx("sponsor_result_bonus", 2000),
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
  assert.equal(result.sponsor_base, 250000);
  assert.equal(result.sponsor_variable, 7000);
  assert.equal(result.prize, 34000);
  assert.equal(result.upkeep, -140000);
  assert.equal(result.facility_upkeep, -12000);
  assert.equal(result.staff_salary, -19500);
  assert.equal(result.staff_facilities, -31500);
  assert.equal(result.academy_drift, -35000);
});

test("aggregateS2RealizedSources — empty/undefined input returns all-zero buckets", () => {
  const result = aggregateS2RealizedSources([]);
  assert.equal(result.sponsor_base, 0);
  assert.equal(result.staff_facilities, 0);
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

test("buildSettlementSteps — ordered receipt, running balance, salary_switch is always 0", () => {
  const steps = buildSettlementSteps({
    startingBalance: 100000,
    s3: {
      projected_sponsor_base: 250000,
      projected_upkeep: -140000,
      projected_staff_facilities: -31500,
      projected_academy_drift: -35000,
    },
  });
  assert.deepEqual(
    steps.map((s) => s.key),
    ["books_close", "sponsor_base", "upkeep", "staff_facilities", "academy_drift", "salary_switch", "start_s3"],
  );
  assert.equal(steps[0].balance_after, 100000);
  assert.equal(steps[1].amount, 250000);
  assert.equal(steps[1].balance_after, 350000);
  assert.equal(steps[4].balance_after, 350000 - 140000 - 31500 - 35000);
  assert.equal(steps[5].key, "salary_switch");
  assert.equal(steps[5].amount, 0);
  assert.equal(steps[5].balance_after, steps[4].balance_after);
  const last = steps[steps.length - 1];
  assert.equal(last.key, "start_s3");
  assert.equal(last.balance_after, steps[4].balance_after);
});

test("buildSettlementSteps — missing s3 fields default to 0 (never throws)", () => {
  const steps = buildSettlementSteps({ startingBalance: 500, s3: null });
  assert.equal(steps[steps.length - 1].balance_after, 500);
});

test("buildSeasonSwitchPreview — combines s2/s3/settlement/riders into one payload", () => {
  const result = buildSeasonSwitchPreview({
    transactions: [
      tx("season_start_sponsor", 250000),
      tx("season_start_upkeep", -140000),
    ],
    riders: [
      { id: "r1", firstname: "A", lastname: "One", salary: 10000, current_production_value: 40000 },
    ],
    startingBalance: 200000,
    s3: {
      projected_sponsor_base: 250000,
      projected_sponsor_variable: 8000,
      prize_low: 1000,
      prize_high: 5000,
      projected_salary: -14000,
      projected_upkeep: -140000,
      projected_facility_upkeep: -12000,
      projected_staff_salary: -19500,
      projected_staff_facilities: -31500,
      projected_academy_drift: -35000,
      projected_net: 37500,
    },
  });

  // S2 salary is the CONTRACT sum, not a finance_transactions aggregate.
  assert.equal(result.s2.salary, -10000);
  assert.equal(result.s2.salary_is_contract, true);
  assert.equal(result.s2.sponsor_base, 250000);
  assert.equal(result.s2.upkeep, -140000);

  assert.equal(result.s3.sponsor_base, 250000);
  assert.equal(result.s3.net, 37500);

  assert.equal(result.settlement.starting_balance, 200000);
  assert.equal(result.settlement.ending_balance, 200000 + 250000 - 140000 - 31500 - 35000);
  assert.equal(result.settlement.steps.length, 7);

  assert.equal(result.riders.rows.length, 1);
  assert.equal(result.riders.summary.total_contract_salary, 10000);
});
