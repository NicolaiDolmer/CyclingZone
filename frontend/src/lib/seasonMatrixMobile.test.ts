import test from "node:test";
import assert from "node:assert/strict";
import { mobileRaceWindow, shiftMobileRaceWindow } from "./seasonMatrixMobile.ts";

const columns = [
  { key: "a:10", raceId: "a", gameDay: 10, stageIndex: 1 },
  { key: "b:10", raceId: "b", gameDay: 10, stageIndex: 1 },
  { key: "a:11", raceId: "a", gameDay: 11, stageIndex: 2 },
  { key: "a:12", raceId: "a", gameDay: 12, stageIndex: 3 },
  { key: "a:13", raceId: "a", gameDay: 13, stageIndex: 4 },
];

test("#5124 mobile window keeps one race and three ordered race days", () => {
  const first = mobileRaceWindow(columns, "a", 0);
  assert.deepEqual(first.days.map((day) => day.gameDay), [10, 11, 12]);
  assert.equal(first.total, 4);
  assert.equal(first.canEarlier, false);
  assert.equal(first.canLater, true);
  assert.deepEqual(mobileRaceWindow(columns, "a", 3).days.map((day) => day.gameDay), [11, 12, 13]);
  assert.deepEqual(mobileRaceWindow(columns, "b", 0).days.map((day) => day.gameDay), [10]);
});

test("#5124 navigation clamps at both ends and resets cleanly on race switch", () => {
  assert.equal(shiftMobileRaceWindow(0, -1, 4), 0);
  assert.equal(shiftMobileRaceWindow(0, 1, 4), 1);
  assert.equal(shiftMobileRaceWindow(1, 1, 4), 1);
  assert.equal(mobileRaceWindow(columns, "b", 1).start, 0);
});
