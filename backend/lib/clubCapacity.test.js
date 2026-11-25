import assert from "node:assert/strict";
import test from "node:test";
import { getIncomingSquadViolation } from "./marketUtils.js";
import { CLUB_RIDER_CAP, SQUAD_CAPS } from "./squads.js";

test("every squad can hold 30 riders and the club can hold 60", () => {
  assert.deepEqual(SQUAD_CAPS, { senior: 30, u23: 30, junior: 30 });
  assert.equal(CLUB_RIDER_CAP, 60);
});

test("purchases can use the last place and stop at either limit", () => {
  const state = { squad_limits: { max: 30 }, rider_count: 29, future_count: 29, club_count: 59 };
  assert.equal(getIncomingSquadViolation(state), null);
  assert.equal(getIncomingSquadViolation({ ...state, club_count: 60 }).maxRiders, 60);
  assert.equal(getIncomingSquadViolation({ ...state, club_count: 61 }).maxRiders, 60);
  assert.equal(getIncomingSquadViolation({ ...state, rider_count: 30 }).maxRiders, 30);
  assert.equal(getIncomingSquadViolation({ ...state, rider_count: 31 }).maxRiders, 30);
});
