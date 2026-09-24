import { test } from "node:test";
import assert from "node:assert/strict";
import { poolHasCalendar } from "./divisionCalendarGenerator.js";

// #2449: generateDivisionCalendars (den gamle udvælgelses-algoritme) er fjernet — tests
// for den blev droppet sammen med funktionen. Kun poolHasCalendar er tilbage her
// (tierCalendarMaterializer bruger den til pulje-liveness-gaten).
test("poolHasCalendar: tier 1/2 altid; tier 3 kun med >=1 ægte manager", () => {
  assert.equal(poolHasCalendar(1, 0), true);
  assert.equal(poolHasCalendar(2, 0), true);
  assert.equal(poolHasCalendar(3, 0), false);
  assert.equal(poolHasCalendar(3, 1), true);
});

// #5644 / #4592 A3 (ejer 24/9): D4 har løb fra dag ét, også uden ægte managers.
test("poolHasCalendar: aktiv tier-4-pulje har altid en kalender (#4592 A3)", () => {
  assert.equal(poolHasCalendar(4, 0), true);
  assert.equal(poolHasCalendar(4, 2), true);
  assert.equal(poolHasCalendar(4, 0, { retired: false }), true);
});

test("poolHasCalendar: pensioneret pulje (retired_at) får ALDRIG en kalender, uanset tier og managers", () => {
  for (const tier of [1, 2, 3, 4]) {
    assert.equal(poolHasCalendar(tier, 0, { retired: true }), false, `tier ${tier} uden managers`);
    assert.equal(poolHasCalendar(tier, 5, { retired: true }), false, `tier ${tier} med managers`);
  }
  assert.equal(poolHasCalendar(1, 0, { retired: true, squad: "u23" }), false, "også en pensioneret ungdomsgruppe");
});

test("poolHasCalendar: ungdomsgrupper (u23/junior) har altid en kalender; senior/null følger tier-reglen", () => {
  assert.equal(poolHasCalendar(1, 0, { squad: "u23" }), true);
  assert.equal(poolHasCalendar(3, 0, { squad: "junior" }), true);
  assert.equal(poolHasCalendar(3, 0, { squad: "senior" }), false);
  assert.equal(poolHasCalendar(3, 0, { squad: null }), false);
});
