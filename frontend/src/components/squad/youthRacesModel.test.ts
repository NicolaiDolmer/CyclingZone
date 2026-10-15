import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_RACE_ENTRIES } from "../../lib/raceSelectionLogic.js";
import type { YouthRaceItem } from "../../lib/youthRaceCalendar.ts";
import { youthBelowFloor, youthIsTraining } from "./youthRacesModel.ts";

function item(over: Partial<YouthRaceItem>): YouthRaceItem {
  return {
    id: "r1", name: "Race", stages: 1, stagesCompleted: 0, status: "scheduled",
    startsAt: null, endsAt: null, riders: 0, selection: "none", ...over,
  };
}

test("#5920: åbent løb uden udtagne ryttere advarer", () => {
  assert.equal(youthBelowFloor(item({ riders: 0, selection: "none" }), false), true);
});

test("#5920: åbent løb under gulvet med udtagelse advarer, på/over gulvet gør ikke", () => {
  assert.equal(youthBelowFloor(item({ riders: MIN_RACE_ENTRIES - 1, selection: "manual" }), false), true);
  assert.equal(youthBelowFloor(item({ riders: MIN_RACE_ENTRIES, selection: "manual" }), false), false);
});

test("#5920: train-only undtager ikke-udtagne løb", () => {
  const r = item({ riders: 0, selection: "none" });
  assert.equal(youthIsTraining(r, true), true);
  assert.equal(youthBelowFloor(r, true), false);
});

test("#5920: låste og afsluttede løb advarer aldrig", () => {
  assert.equal(youthBelowFloor(item({ status: "active", stagesCompleted: 1 }), false), false);
  assert.equal(youthBelowFloor(item({ status: "completed", stagesCompleted: 1 }), false), false);
});
