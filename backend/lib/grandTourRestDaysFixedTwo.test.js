// Ejer-beslutning 25/8: en Grand Tour har PRAECIS 2 hviledage.
//
// Foer: `restDays = clamp(spanDays - stages, 0, 3)`, udledt af `date_text`. Det gav 0-3
// hviledage afhaengigt af hvad kataloget tilfaeldigvis sagde om det virkelige loebs datoer,
// og 0 hvis date_text manglede eller ikke kunne parses. Resultatet var uensartet: to GT'er
// i samme saeson kunne have forskelligt antal hviledage uden at nogen havde besluttet det.
//
// Samme beslutning fastslog at en hviledag ER en loebsdag som GT'en OPTAGER uden at koere
// paa - saa spaendet er etaper + 2, sammenhaengende. Rytteren er bundet henover, praecis
// som i virkeligheden hvor man ikke forlader Giroen paa hviledagen for at koere et andet
// loeb. Det er ogsaa hvad spaend-bindingen (#4217) allerede goer, saa intet aendrer sig
// for spilleren.

import test from "node:test";
import assert from "node:assert/strict";

import {
  grandTourRestDayCount,
  grandTourRestDayPositions,
  GRAND_TOUR_MIN_STAGES,
  GRAND_TOUR_REST_DAYS,
} from "./grandTourRestDays.js";

test("en Grand Tour har praecis 2 hviledage, uanset date_text", () => {
  assert.equal(GRAND_TOUR_REST_DAYS, 2);
  // Samme svar uanset hvad kataloget siger om de virkelige datoer.
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: 21 }), 2);
  assert.equal(grandTourRestDayCount({ dateText: "1/7 - 21/7", stages: 18 }), 2);
  assert.equal(grandTourRestDayCount({ stages: 17 }), 2, "manglende date_text maa ikke give 0");
  assert.equal(grandTourRestDayCount({ dateText: "vroevl", stages: 17 }), 2);
});

test("kun Grand Tours faar hviledage", () => {
  assert.equal(grandTourRestDayCount({ dateText: "8/5 - 31/5", stages: GRAND_TOUR_MIN_STAGES - 1 }), 0);
  assert.equal(grandTourRestDayCount({ stages: 8 }), 0);
  assert.equal(grandTourRestDayCount({ stages: 1 }), 0);
});

test("de to hviledage ligger efter etape 9 og 15", () => {
  assert.deepEqual(grandTourRestDayPositions({ stages: 21, restDays: 2 }), [9, 15]);
  assert.deepEqual(grandTourRestDayPositions({ stages: 18, restDays: 2 }), [9, 15]);
  // En GT kortere end 16 etaper kan ikke baere en hviledag efter etape 15.
  assert.deepEqual(grandTourRestDayPositions({ stages: 15, restDays: 2 }), [9]);
});
