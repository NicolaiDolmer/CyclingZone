import test from "node:test";
import assert from "node:assert/strict";
import { planningDidNotStart, teamExistedAtRaceStart } from "./planningDidNotStart.ts";

const RACE_START = Date.parse("2026-11-01T10:00:00Z");
const BEFORE = "2026-10-20T08:00:00Z";
const AFTER = "2026-11-02T13:33:00Z";
const base = { started: true, voluntaryWithdrawn: false, explicitDidNotStart: false, inField: false, raceStart: RACE_START };

test("new team created after the race started is not did_not_start (#7518)", () => {
  assert.equal(planningDidNotStart({ ...base, teamCreatedAt: AFTER }), false);
});

test("existing team that was not in the started field is still did_not_start", () => {
  assert.equal(planningDidNotStart({ ...base, teamCreatedAt: BEFORE }), true);
});

test("explicit DNS registration stays did_not_start, also for a team created after start", () => {
  assert.equal(planningDidNotStart({ ...base, explicitDidNotStart: true, inField: null, teamCreatedAt: BEFORE }), true);
  assert.equal(planningDidNotStart({ ...base, explicitDidNotStart: true, inField: null, teamCreatedAt: AFTER }), true);
});

test("team in the field, unknown field, unstarted race and voluntary withdrawal never show did_not_start", () => {
  assert.equal(planningDidNotStart({ ...base, inField: true, teamCreatedAt: BEFORE }), false);
  assert.equal(planningDidNotStart({ ...base, inField: null, teamCreatedAt: BEFORE }), false);
  assert.equal(planningDidNotStart({ ...base, inField: undefined, teamCreatedAt: BEFORE }), false);
  assert.equal(planningDidNotStart({ ...base, started: false, teamCreatedAt: BEFORE }), false);
  assert.equal(planningDidNotStart({ ...base, voluntaryWithdrawn: true, explicitDidNotStart: true, teamCreatedAt: BEFORE }), false);
});

test("unknown timestamps keep the previous behaviour", () => {
  assert.equal(planningDidNotStart({ ...base, teamCreatedAt: null }), true);
  assert.equal(planningDidNotStart({ ...base, teamCreatedAt: BEFORE, raceStart: null }), true);
  assert.equal(planningDidNotStart({ ...base, teamCreatedAt: "not a date" }), true);
});

test("teamExistedAtRaceStart compares strictly before the first stage and accepts Date and ms", () => {
  assert.equal(teamExistedAtRaceStart({ teamCreatedAt: new Date(RACE_START - 1), raceStart: RACE_START }), true);
  assert.equal(teamExistedAtRaceStart({ teamCreatedAt: new Date(RACE_START), raceStart: RACE_START }), false);
  assert.equal(teamExistedAtRaceStart({ teamCreatedAt: RACE_START + 1, raceStart: new Date(RACE_START) }), false);
});
