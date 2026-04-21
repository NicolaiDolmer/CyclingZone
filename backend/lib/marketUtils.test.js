import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateMarketSalary,
  getIncomingSquadViolation,
  getOutgoingSquadViolation,
} from "./marketUtils.js";

test("calculateMarketSalary keeps the 10 percent rule with a minimum of 1", () => {
  assert.equal(calculateMarketSalary(1), 1);
  assert.equal(calculateMarketSalary(9), 1);
  assert.equal(calculateMarketSalary(10), 1);
  assert.equal(calculateMarketSalary(11), 2);
});

test("getIncomingSquadViolation includes pending riders in the max check", () => {
  const issue = getIncomingSquadViolation({
    division: 3,
    total_count: 10,
    squad_limits: { min: 8, max: 10 },
  });

  assert.equal(issue?.maxRiders, 10);
  assert.equal(issue?.totalAfter, 11);
});

test("getOutgoingSquadViolation blocks teams from dropping below the division minimum", () => {
  const issue = getOutgoingSquadViolation({
    division: 1,
    total_count: 20,
    squad_limits: { min: 20, max: 30 },
  });

  assert.equal(issue?.minRiders, 20);
  assert.equal(issue?.totalAfter, 19);
});
