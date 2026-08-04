import { test } from "node:test";
import assert from "node:assert/strict";
import { isFirstRaceMoment } from "./firstRaceMoment.js";

test("false uden race, uden data eller når resultatet er set", () => {
  assert.equal(isFirstRaceMoment(null), false);
  assert.equal(isFirstRaceMoment({ race: null }), false);
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: true }, history: [] }), false);
});

test("true for uset første resultat uden historik", () => {
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: false }, history: [], season_totals: { races: 1 } }), true);
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: false }, history: [], season_totals: null }), true);
});

test("false når der findes tidligere løb", () => {
  assert.equal(isFirstRaceMoment({ race: { id: 2, seen: false }, history: [{ race_id: 1 }], season_totals: { races: 2 } }), false);
  assert.equal(isFirstRaceMoment({ race: { id: 2, seen: false }, history: [], season_totals: { races: 3 } }), false);
});
