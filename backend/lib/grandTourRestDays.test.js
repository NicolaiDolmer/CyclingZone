import test from "node:test";
import assert from "node:assert/strict";
import { grandTourRestDayCount, grandTourRestDayPositions, GT_REST_DAY_PATTERN } from "./grandTourRestDays.js";

// ── grandTourRestDayCount ────────────────────────────────────────────────────
test("grandTourRestDayCount: Giro-fixture (8/5 - 31/5, 21 etaper) → 3 hviledage", () => {
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: 21 }), 3);
});

test("grandTourRestDayCount: Tour-fixture (spænd 23 dage, 21 etaper) → 2 hviledage", () => {
  // 23 dages spænd: 1/7 - 23/7 (doy 182..204, spanDays = 204-182+1 = 23).
  assert.equal(grandTourRestDayCount({ dateText: "1/7 - 23/7", stages: 21 }), 2);
});

test("grandTourRestDayCount: Vuelta-fixture (22/8 - 13/9, 21 etaper) → 2 hviledage", () => {
  assert.equal(grandTourRestDayCount({ dateText: "22/8 - 13/9", stages: 21 }), 2);
});

test("grandTourRestDayCount: under GRAND_TOUR_MIN_STAGES (15) → 0 uanset spænd", () => {
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: 14 }), 0);
  assert.equal(grandTourRestDayCount({ dateText: "1/1 - 31/12", stages: 8 }), 0);
});

test("grandTourRestDayCount: manglende/uparselig date_text → 0 (fallback-kontrakt, jf. #3469)", () => {
  assert.equal(grandTourRestDayCount({ dateText: null, stages: 21 }), 0);
  assert.equal(grandTourRestDayCount({ dateText: undefined, stages: 21 }), 0);
  assert.equal(grandTourRestDayCount({ dateText: "ikke en dato", stages: 21 }), 0);
});

test("grandTourRestDayCount: clamp — spænd = etaper (0 hviledage) og meget langt spænd (loft 3)", () => {
  assert.equal(grandTourRestDayCount({ dateText: "1/6 - 21/6", stages: 21 }), 0); // 21 dage = 21 etaper
  assert.equal(grandTourRestDayCount({ dateText: "1/1 - 30/6", stages: 15 }), 3); // kæmpe spænd → loft 3
});

test("grandTourRestDayCount: negativt spænd (date_text kortere end etapeantal) clampes til 0, ikke negativt", () => {
  assert.equal(grandTourRestDayCount({ dateText: "1/6 - 5/6", stages: 21 }), 0);
});

// ── grandTourRestDayPositions ────────────────────────────────────────────────
test("grandTourRestDayPositions: 21 etaper — 2 hviledage efter etape 9/15, 3 efter 6/12/18", () => {
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: 2 }), [9, 15]);
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: 3 }), [6, 12, 18]);
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: 0 }), []);
});

test("grandTourRestDayPositions: ukendt restDays-nøgle → tom liste (defensivt)", () => {
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: 4 }), []);
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: undefined }), []);
});

test("grandTourRestDayPositions: positioner ud over etape-antallet frafiltreres (kortere GT)", () => {
  // 15-etapers GT med 3-mønstret (6/12/18) — 18 er uden for [1,15) → kun 6/12 tilbage.
  assert.deepEqual(grandTourRestDayPositions({ stages: 15, restDays: 3 }), [6, 12]);
});

test("GT_REST_DAY_PATTERN: alle positioner er strengt stigende og > 0", () => {
  for (const positions of Object.values(GT_REST_DAY_PATTERN)) {
    for (let i = 0; i < positions.length; i++) {
      assert.ok(positions[i] > 0, `position ${positions[i]} skal være > 0`);
      if (i > 0) assert.ok(positions[i] > positions[i - 1], "positioner skal være strengt stigende");
    }
  }
});
