// #8548: e2e-testen for Program R5 bruger en fast kopi af motorens rotationsprognose,
// fordi e2e bygges uden serverpakker. Denne test holder kopien lig motoren.
import assert from "node:assert/strict";
import test from "node:test";

import { forecastRotationFields } from "./trainingWeekForecast.js";
import { ROTATION_DAYS } from "../../frontend/tests/e2e/fixtures/8548-rotation-days.ts";

test("e2e-fixturen for rotationsugen er lig motorens forecastRotationFields", () => {
  const passes = ["sprint", "threshold", "endurance", "tempo", "sprint", "threshold", "endurance", "tempo", "sprint", "threshold"]
    .map((session) => ({ session }));
  const rotation = { v: 1, rev: 7, passes };
  const raceSlotsByDay = [[1, 4], [], [2], [], [0, 3], [], [4], []];
  let nextRotationIndex = 6;
  const days = raceSlotsByDay.map((raceSlots, i) => {
    const gameDays = Array.from({ length: 5 }, (_, slot) => i * 5 + slot);
    const fields = { raceSlots, restSlots: i === 1 ? [0, 1, 2, 3, 4] : [] };
    const day = forecastRotationFields({ rotation, startIndex: nextRotationIndex, gameDays, fields, rule: null, rodeStagePreviousDate: false });
    nextRotationIndex = day.nextRotationIndex;
    return day;
  });
  assert.deepEqual(ROTATION_DAYS, days);
});
