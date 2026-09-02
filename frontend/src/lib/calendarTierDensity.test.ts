// Unit-tests for calendarTierDensity.ts (#4386). Kører med: node --test (i frontend/)
import { test } from "node:test";
import assert from "node:assert/strict";

import { TIER_DENSITY, MAX_TIER_DENSITY, densityForDivision } from "./calendarTierDensity.ts";

test("TIER_DENSITY er den låste 5/4/3/2 (docs/CALENDAR_RULES.md §1) — mirror af backend/lib/calendarTierCaps.js", () => {
  assert.deepEqual({ ...TIER_DENSITY }, { 1: 5, 2: 4, 3: 3, 4: 2 });
});

test("MAX_TIER_DENSITY er D1's 5", () => {
  assert.equal(MAX_TIER_DENSITY, 5);
});

test("densityForDivision: kendt division -> dens egen density", () => {
  assert.equal(densityForDivision(1), 5);
  assert.equal(densityForDivision(2), 4);
  assert.equal(densityForDivision(3), 3);
  assert.equal(densityForDivision(4), 2);
});

test("densityForDivision: null/undefined ('alle divisioner') -> bredeste (D1)", () => {
  assert.equal(densityForDivision(null), 5);
  assert.equal(densityForDivision(undefined), 5);
});

test("densityForDivision: ukendt tier -> bredeste, aldrig undefined (celle må aldrig skjule uden loft)", () => {
  assert.equal(densityForDivision(99), 5);
});
