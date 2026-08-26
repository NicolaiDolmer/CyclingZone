import test from "node:test";
import assert from "node:assert/strict";
import { grandTourRestDayCount, grandTourRestDayPositions, GT_REST_DAY_PATTERN } from "./grandTourRestDays.js";

// ── grandTourRestDayCount ────────────────────────────────────────────────────
// Ejer-beslutning 25/8 (#4236): antallet er en SPILREGEL paa 2, ikke en egenskab udledt
// af det virkelige loebs datoer. De tidligere fire tests her maalte den gamle udledning
// (clamp(spanDays - stages, 0, 3)) og er erstattet - reglen de beskrev findes ikke mere.
// Detaljerne for den nye regel ligger i grandTourRestDaysFixedTwo.test.js.
test("grandTourRestDayCount: alle GT'er faar 2, uanset date_text", () => {
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: 21 }), 2);
  assert.equal(grandTourRestDayCount({ dateText: "1/7 - 23/7", stages: 21 }), 2);
  assert.equal(grandTourRestDayCount({ dateText: "22/8 - 13/9", stages: 21 }), 2);
});

test("grandTourRestDayCount: under GRAND_TOUR_MIN_STAGES (15) → 0 uanset spænd", () => {
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: 14 }), 0);
  assert.equal(grandTourRestDayCount({ stages: 8 }), 0);
});

test("grandTourRestDayCount: manglende/uparselig date_text aendrer intet laengere", () => {
  // Foer gav det 0 og dermed en hviledags-fri GT. Nu er antallet uafhaengigt af feltet.
  assert.equal(grandTourRestDayCount({ stages: 21 }), 2);
  assert.equal(grandTourRestDayCount({ dateText: null, stages: 21 }), 2);
  assert.equal(grandTourRestDayCount({ dateText: "vroevl", stages: 21 }), 2);
});

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
