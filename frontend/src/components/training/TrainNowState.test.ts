import test from "node:test";
import assert from "node:assert/strict";
import {
  TRAIN_NOW_OFF, parseTrainNowStatus, trainNowNoteKeys, trainNowPressCounts, trainNowRunGate,
  trainNowRaceNames, trainNowSaveErrorKey, type TrainNowStatus,
} from "./TrainNowState.ts";
import { trainNowClock } from "./trainNowClock.ts";

const available: TrainNowStatus = {
  enabled: true, available: true, reason: null, tickDate: "2026-10-01", locked: false, lockedAt: null, settled: false,
  todayRaces: [],
};
const locked: TrainNowStatus = { ...available, available: false, reason: "locked", locked: true, lockedAt: "2026-10-01T06:00:00Z" };

test("an older backend or flag off gives the old page", () => {
  assert.deepEqual(parseTrainNowStatus(null), TRAIN_NOW_OFF);
  assert.deepEqual(parseTrainNowStatus({ enabled: false, available: true }), TRAIN_NOW_OFF);
  assert.deepEqual(parseTrainNowStatus({ enabled: "yes" }), TRAIN_NOW_OFF);
});

test("parse keeps only well-typed fields", () => {
  const parsed = parseTrainNowStatus({ enabled: true, available: true, reason: 3, locked: "x" });
  assert.equal(parsed.available, true);
  assert.equal(parsed.reason, null);
  assert.equal(parsed.locked, false);
});

test("run gate: flag off keeps the existing evening gate untouched", () => {
  const fallback = { trainedToday: false, dayClose: { open: false, opensAtHour: 20 } };
  assert.deepEqual(trainNowRunGate(TRAIN_NOW_OFF, fallback), fallback);
});

test("run gate: with the press, the gold button is open all date until the press", () => {
  const fallback = { trainedToday: false, dayClose: { open: false, opensAtHour: 20 } };
  assert.deepEqual(trainNowRunGate(available, fallback), { trainedToday: false, dayClose: { open: true, opensAtHour: 20 } });
  assert.equal(trainNowRunGate(locked, fallback).trainedToday, true);
  assert.equal(trainNowRunGate({ ...available, available: false, settled: true }, fallback).trainedToday, true);
});

test("note: helper before the press, locked after, settled in the evening", () => {
  assert.deepEqual(trainNowNoteKeys(available, null, null), ["trainNow.helper"]);
  assert.deepEqual(trainNowNoteKeys(locked, null, null), ["trainNow.locked"]);
  // #6006: the press says what it did right away: X trained now, Y waiting.
  assert.deepEqual(
    trainNowNoteKeys(locked, { settledRiderIds: ["a"], afterRaceRiderIds: ["b"], settledGameDays: [15] }, null),
    ["trainNow.pressResult", "trainNow.locked"],
  );
  assert.deepEqual(
    trainNowNoteKeys(locked, { settledRiderIds: ["a", "b"], afterRaceRiderIds: [], settledGameDays: [15] }, null),
    ["trainNow.pressResultAll", "trainNow.locked"],
  );
  // Nothing settled now (one race day kept for the evening, I4): no "trained now" claim.
  assert.deepEqual(
    trainNowNoteKeys(locked, { settledRiderIds: ["a"], afterRaceRiderIds: ["b"], settledGameDays: [] }, null),
    ["trainNow.locked", "trainNow.afterRace"],
  );
  assert.deepEqual(trainNowPressCounts({ settledRiderIds: ["a", "b"], afterRaceRiderIds: ["c"], settledGameDays: [1] }),
    { trained: 2, waiting: 1 });
  assert.deepEqual(trainNowNoteKeys({ ...locked, settled: true }, null, null), ["trainNow.settled"]);
  assert.deepEqual(trainNowNoteKeys(TRAIN_NOW_OFF, null, null), []);
});

test("note: server refusals map to short lines, unknown errors to a retry line", () => {
  assert.deepEqual(trainNowNoteKeys(available, null, "previous_date_open"), ["trainNow.previousOpen"]);
  assert.deepEqual(trainNowNoteKeys(available, null, "no_race_day_today"), ["trainNow.noRaceDay"]);
  assert.deepEqual(trainNowNoteKeys(available, null, "train_now_failed"), ["trainNow.error"]);
});

test("#6139: the helper names today's race when there is one", () => {
  const withRace = { ...available, todayRaces: [{ id: "r1", name: "Tour A" }, { id: "r2", name: null }] };
  assert.deepEqual(trainNowNoteKeys(withRace, null, null), ["trainNow.helperRace"]);
  assert.equal(trainNowRaceNames(withRace), "Tour A");
  assert.deepEqual(parseTrainNowStatus({ enabled: true, todayRaces: [{ id: "r1", name: "Tour A" }, { name: "no id" }, null] }).todayRaces,
    [{ id: "r1", name: "Tour A" }]);
  assert.deepEqual(parseTrainNowStatus({ enabled: true }).todayRaces, []);
});

test("#6139: lock time in game time and the plan-lock save message", () => {
  assert.equal(trainNowClock("2026-10-01T07:12:00.000Z"), "09:12");
  assert.equal(trainNowClock(null), null);
  assert.equal(trainNowClock("nope"), null);
  assert.equal(trainNowSaveErrorKey("train_now_locked", "weekRhythmSaveFailed"), "trainNow.planLocked");
  assert.equal(trainNowSaveErrorKey("failed", "weekRhythmSaveFailed"), "weekRhythmSaveFailed");
});
