import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlanInterval } from "./subscriptionPlanInterval.js";

test("normalizePlanInterval: Aluntas ægte tal-form (målt 2/9) -> ord", () => {
  assert.equal(normalizePlanInterval(1), "monthly");
  assert.equal(normalizePlanInterval("1"), "monthly");
  assert.equal(normalizePlanInterval(6), "semiannual");
  assert.equal(normalizePlanInterval("6"), "semiannual");
});

test("normalizePlanInterval: allerede normaliserede + kendte alias-ord passerer", () => {
  assert.equal(normalizePlanInterval("monthly"), "monthly");
  assert.equal(normalizePlanInterval("semiannual"), "semiannual");
  assert.equal(normalizePlanInterval("Half-Yearly"), "semiannual");
  assert.equal(normalizePlanInterval(" month "), "monthly");
});

test("normalizePlanInterval: tom/null -> null, ukendt -> bevares som streng (aldrig tabt)", () => {
  assert.equal(normalizePlanInterval(null), null);
  assert.equal(normalizePlanInterval(undefined), null);
  assert.equal(normalizePlanInterval(""), null);
  assert.equal(normalizePlanInterval(12), "12");
  assert.equal(normalizePlanInterval("yearly"), "yearly");
});
