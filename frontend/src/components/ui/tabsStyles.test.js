import { test } from "node:test";
import assert from "node:assert/strict";
import { tabClass, tabListClass } from "./tabsStyles.js";

test("aktiv tab faar guld-underline + primaer tekst", () => {
  const active = tabClass({ active: true });
  assert.ok(active.includes("border-cz-accent"));
  assert.ok(active.includes("text-cz-1"));
});

test("inaktiv tab er neutral med transparent underline", () => {
  const idle = tabClass();
  assert.ok(idle.includes("border-transparent"));
  assert.ok(idle.includes("text-cz-3"));
  assert.ok(!idle.includes("border-cz-accent"));
});

test("tablist er hairline-baseline", () => {
  const c = tabListClass();
  assert.ok(c.includes("border-b"));
  assert.ok(c.includes("border-cz-border"));
});
