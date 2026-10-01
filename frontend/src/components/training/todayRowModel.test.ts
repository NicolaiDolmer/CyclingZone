// #5685/#5630 · telefonens Today-raekke (retning A): ren logik.
import assert from "node:assert/strict";
import test from "node:test";
import { pressedChoice, pressedChoiceFromSession, rowForecast, rowLocked } from "./todayRowModel.ts";

test("prognosen: afrundet tal + serverens baand; ukendt baand er aldrig 'frisk'", () => {
  assert.deepEqual(rowForecast({ fatigue: 57.6, band: "ok" }), { value: 58, tone: "ok" });
  assert.deepEqual(rowForecast({ fatigue: 74, band: "risk" }), { value: 74, tone: "risk" });
  assert.deepEqual(rowForecast({ fatigue: 40, band: null }), { value: 40, tone: "warn" });
});

test("prognosen: intet tal => ingen visning", () => {
  assert.equal(rowForecast(null), null);
  assert.equal(rowForecast(undefined), null);
  assert.equal(rowForecast({ fatigue: Number.NaN, band: "ok" }), null);
});

test("trykket segment foelger desktoppens regel", () => {
  assert.equal(pressedChoice("rest", "training", true), "rest");
  assert.equal(pressedChoice("recovery", "training", true), "recovery");
  assert.equal(pressedChoice("training", "training", true), "session");
  assert.equal(pressedChoice("skill", "training", true), null);
  assert.equal(pressedChoice("rest", null, false), null);
});

test("laast efter Train now (beslutning 2)", () => {
  assert.equal(rowLocked({ trainedToday: true }), true);
  assert.equal(rowLocked({ trainedToday: false }), false);
});

test("effektivt felt: programcellen vinder over planen", () => {
  assert.equal(pressedChoiceFromSession("rest"), "rest");
  assert.equal(pressedChoiceFromSession("recovery"), "recovery");
  assert.equal(pressedChoiceFromSession("restitution"), "recovery");
  assert.equal(pressedChoiceFromSession("threshold"), "session");
  assert.equal(pressedChoiceFromSession(null), null);
});
