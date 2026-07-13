import { test } from "node:test";
import assert from "node:assert/strict";
import { plannerNavItem } from "./plannerNavVisibility.js";

const t = (k) => k;

test("plannerNavItem: OFF → tom liste (menupunkt udeladt)", () => {
  assert.deepEqual(plannerNavItem(false, t), []);
});

test("plannerNavItem: ON → ét /planner-menupunkt", () => {
  const items = plannerNavItem(true, t);
  assert.equal(items.length, 1);
  assert.equal(items[0].to, "/planner");
  assert.equal(items[0].label, "nav.item.planner");
});
