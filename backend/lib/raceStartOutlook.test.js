import test from "node:test";
import assert from "node:assert/strict";
import { teamWillStart } from "./raceStartOutlook.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

test("teamWillStart: tre udtagne og ingen frie ryttere stiller ikke op (#5945)", () => {
  assert.deepEqual(teamWillStart({ entryCount: 3, freeEligibleCount: 0, stagesCompleted: 0 }), { starts: false, min: MIN_RACE_ENTRIES });
});

test("teamWillStart: udtagne + frie ryttere der netop naar gulvet starter", () => {
  assert.equal(teamWillStart({ entryCount: 3, freeEligibleCount: MIN_RACE_ENTRIES - 3 }).starts, true);
  assert.equal(teamWillStart({ entryCount: 3, freeEligibleCount: MIN_RACE_ENTRIES - 4 }).starts, false);
});

test("teamWillStart: fuldt gulv starter uanset frie ryttere", () => {
  assert.equal(teamWillStart({ entryCount: MIN_RACE_ENTRIES, freeEligibleCount: 0 }).starts, true);
});

test("teamWillStart: nul udtagne afhaenger af at assistenten kan naa gulvet", () => {
  assert.equal(teamWillStart({ entryCount: 0, freeEligibleCount: MIN_RACE_ENTRIES }).starts, true);
  assert.equal(teamWillStart({ entryCount: 0, freeEligibleCount: MIN_RACE_ENTRIES - 1 }).starts, false);
});

test("teamWillStart: et loeb i gang roeres ikke (gulvet er afgjort ved start)", () => {
  assert.equal(teamWillStart({ entryCount: 2, freeEligibleCount: 0, stagesCompleted: 1 }).starts, true);
});

test("teamWillStart: manglende/ugyldige input kaster aldrig", () => {
  assert.deepEqual(teamWillStart(), { starts: false, min: MIN_RACE_ENTRIES });
  assert.equal(teamWillStart({ entryCount: "x", freeEligibleCount: null, stagesCompleted: undefined }).starts, false);
  assert.equal(teamWillStart({ entryCount: -4, freeEligibleCount: NaN }).starts, false);
});
