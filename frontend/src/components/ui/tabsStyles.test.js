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

// #5485: `fit` er opt-in. Standarden er uaendret (px-4 + gap-1), og `fit`
// flytter kun luften under sm, saa fire faner staar helt paa 360-390 px.
test("fit er opt-in: standarden er uaendret, fit strammer kun luften paa telefonen", () => {
  assert.ok(tabClass().includes("px-4"));
  assert.ok(!tabClass().includes("px-2"));
  assert.ok(tabListClass().includes("gap-1"));
  const fitTab = tabClass({ fit: true });
  assert.ok(fitTab.includes("px-2") && fitTab.includes("sm:px-4"));
  assert.ok(fitTab.includes("border-b-2") && fitTab.includes("text-sm"), "samme underline og typografi");
  const fitList = tabListClass({ fit: true });
  assert.ok(fitList.includes("justify-between") && fitList.includes("sm:justify-start"));
});

test("tablist er hairline-baseline", () => {
  const c = tabListClass();
  assert.ok(c.includes("border-b"));
  assert.ok(c.includes("border-cz-border"));
});
