import { test } from "node:test";
import assert from "node:assert/strict";
import { isSquadDrafted, DRAFTED_SQUAD_THRESHOLD } from "./teamDrafted.js";

test("tærsklen er 8 (starter-squad / MIN_RIDERS_FOR_RACE)", () => {
  assert.equal(DRAFTED_SQUAD_THRESHOLD, 8);
});

test("under tærsklen → ikke draftet", () => {
  assert.equal(isSquadDrafted(0), false);
  assert.equal(isSquadDrafted(7), false);
});

test("på/over tærsklen → draftet", () => {
  assert.equal(isSquadDrafted(8), true);
  assert.equal(isSquadDrafted(12), true);
  assert.equal(isSquadDrafted(30), true);
});

test("ugyldige værdier → ikke draftet", () => {
  assert.equal(isSquadDrafted(NaN), false);
  assert.equal(isSquadDrafted(undefined), false);
  assert.equal(isSquadDrafted(null), false);
  assert.equal(isSquadDrafted("8"), false);
});
