import test from "node:test";
import assert from "node:assert/strict";

import { computeLoanRiskSummary, LOAN_CONFIRM_DEBT_RATIO } from "./loanRisk.js";

test("LOAN_CONFIRM_DEBT_RATIO is 50%", () => {
  assert.equal(LOAN_CONFIRM_DEBT_RATIO, 0.5);
});

test("computeLoanRiskSummary: small loan against a fresh division ceiling is not high-debt", () => {
  // Division 4 short loan: 100,000 principal, 3% fee, 8% interest, 400,000 ceiling.
  const result = computeLoanRiskSummary({
    principal: 100000,
    fee: 3000,
    interestRatePct: 0.08,
    currentDebt: 0,
    debtCeiling: 400000,
  });
  assert.equal(result.totalOwed, 103000);
  assert.equal(result.newTotalDebt, 103000);
  assert.equal(result.ceilingPct, 103000 / 400000);
  assert.equal(result.isHighDebt, false);
  assert.equal(result.exceedsCeilingNextSeason, false);
});

test("computeLoanRiskSummary: maxing the Division 4 ceiling on day one — reproduces #2815 prod evidence", () => {
  // Borregaard Racing / Metro-L3 / Liverpool Racing pattern: 388,349 principal
  // + 11,650 fee = 399,999, against a 400,000 ceiling — the largest short
  // loan computeMaxLoanPrincipal will allow.
  const result = computeLoanRiskSummary({
    principal: 388349,
    fee: 11650,
    interestRatePct: 0.08,
    currentDebt: 0,
    debtCeiling: 400000,
  });
  assert.equal(result.totalOwed, 399999);
  assert.equal(result.newTotalDebt, 399999);
  assert.ok(result.isHighDebt, "maxed loan must trigger the high-debt confirmation");
  assert.equal(result.ceilingPct > 0.99, true);
  // 399999 * 0.08 = 31999.92 → rounds to 32000; 399999 + 32000 = 431999 > 400000.
  assert.equal(result.nextSeasonInterest, 32000);
  assert.equal(result.projectedDebtAfterInterest, 431999);
  assert.equal(result.exceedsCeilingNextSeason, true, "unpaid interest alone breaches the ceiling next season");
});

test("computeLoanRiskSummary: A-PEX VELO's ~22% first loan is NOT high-debt (the one case that turned out fine)", () => {
  const result = computeLoanRiskSummary({
    principal: 200000,
    fee: 6000,
    interestRatePct: 0.08,
    currentDebt: 0,
    debtCeiling: 900000,
  });
  assert.equal(result.isHighDebt, false);
  assert.equal(result.exceedsCeilingNextSeason, false);
});

test("computeLoanRiskSummary: existing debt pushes a small additional loan into high-debt territory", () => {
  const result = computeLoanRiskSummary({
    principal: 20000,
    fee: 600,
    interestRatePct: 0.08,
    currentDebt: 420000,
    debtCeiling: 900000,
  });
  // (420000 + 20600) / 900000 = 0.4896 -> just under 50%
  assert.equal(result.isHighDebt, false);
  const result2 = computeLoanRiskSummary({
    principal: 30000,
    fee: 900,
    interestRatePct: 0.08,
    currentDebt: 420000,
    debtCeiling: 900000,
  });
  // (420000 + 30900) / 900000 = 0.501 -> at/over 50%
  assert.equal(result2.isHighDebt, true);
});

test("computeLoanRiskSummary: no configured ceiling never triggers high-debt or ceiling-breach flags", () => {
  const result = computeLoanRiskSummary({
    principal: 1000000,
    fee: 30000,
    interestRatePct: 0.08,
    currentDebt: 0,
    debtCeiling: null,
  });
  assert.equal(result.isHighDebt, false);
  assert.equal(result.exceedsCeilingNextSeason, false);
  assert.equal(result.ceilingPct, 0);
});

test("computeLoanRiskSummary: handles missing/undefined numeric inputs defensively", () => {
  const result = computeLoanRiskSummary({ debtCeiling: 400000 });
  assert.equal(result.totalOwed, 0);
  assert.equal(result.newTotalDebt, 0);
  assert.equal(result.nextSeasonInterest, 0);
  assert.equal(result.isHighDebt, false);
});
