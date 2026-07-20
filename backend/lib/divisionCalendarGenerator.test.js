import { test } from "node:test";
import assert from "node:assert/strict";
import { poolHasCalendar } from "./divisionCalendarGenerator.js";

// #2449: generateDivisionCalendars (den gamle udvælgelses-algoritme) er fjernet — tests
// for den blev droppet sammen med funktionen. Kun poolHasCalendar er tilbage her
// (tierCalendarMaterializer bruger den til pulje-liveness-gaten).
test("poolHasCalendar: tier 1/2 altid; tier 3/4 kun med >=1 ægte manager", () => {
  assert.equal(poolHasCalendar(1, 0), true);
  assert.equal(poolHasCalendar(2, 0), true);
  assert.equal(poolHasCalendar(3, 0), false);
  assert.equal(poolHasCalendar(3, 1), true);
  assert.equal(poolHasCalendar(4, 0), false);
  assert.equal(poolHasCalendar(4, 2), true);
});
