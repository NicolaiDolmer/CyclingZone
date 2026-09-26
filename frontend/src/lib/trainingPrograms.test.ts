// #4629 — Program-fanens rene model.
import test from "node:test";
import assert from "node:assert/strict";

import {
  isProgramPlan, cellSession, isCellOverridden, slotForColumnIndex, changedCellCount,
  catalogForRiderType, programName, programTagline, programSessionToday, isWholeDaySession,
  type CatalogProgram, type ProgramWeekDays,
} from "./trainingPrograms.ts";

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SPRINT_WEEK = ["sprint", "endurance", "echelon_drills", "recovery", "sprint", "endurance", "rest"];

const sprinter: CatalogProgram = {
  key: "sprinter",
  name: { en: "Sprinter", da: "Sprinter" },
  tagline: { en: "Sprint twice a week.", da: "Sprint to gange om ugen." },
  targetTypes: ["sprinter"],
  audience: null,
  days: Object.fromEntries(WEEK.map((w, i) => [w, SPRINT_WEEK[i]])),
};
const base: CatalogProgram = {
  ...sprinter, key: "build_base", name: { en: "Build base", da: "Byg base" }, targetTypes: [], audience: "all",
};

function planFrom(program: CatalogProgram): ProgramWeekDays {
  return Object.fromEntries(WEEK.map((w) => [w, { session: program.days[w], intensity: "x" }]));
}

test("isProgramPlan: en programplan har en session paa alle 7 dage; en gammel rytme har ikke", () => {
  assert.equal(isProgramPlan(planFrom(sprinter), WEEK), true);
  assert.equal(isProgramPlan(Object.fromEntries(WEEK.map((w) => [w, { intensity: "hard" }])), WEEK), false);
  assert.equal(isProgramPlan(null, WEEK), false);
});

test("cellSession: slottets override vinder, ellers ugedagens session", () => {
  const days = planFrom(sprinter);
  days.fri = { ...days.fri, slots: [null, null, "technique", null, null] };
  assert.equal(cellSession(days, "fri", 2), "technique");
  assert.equal(cellSession(days, "fri", 0), "sprint");
  assert.equal(cellSession(days, "fri"), "sprint");
  assert.equal(isCellOverridden(days, "fri", 2), true);
  assert.equal(isCellOverridden(days, "fri", 1), false);
});

test("slotForColumnIndex: kolonne 1-5 → slot 0-4; ingen kolonne → slot 0", () => {
  assert.equal(slotForColumnIndex(1), 0);
  assert.equal(slotForColumnIndex(5), 4);
  assert.equal(slotForColumnIndex(9), 4);
  assert.equal(slotForColumnIndex(null), 0);
});

test("changedCellCount: en kopi uden rettelser = 0; en ugedag + et slot = 2", () => {
  const days = planFrom(sprinter);
  assert.equal(changedCellCount(days, sprinter, WEEK), 0);
  days.mon = { session: "rest", intensity: "rest" };
  days.fri = { ...days.fri, slots: [null, "recovery", null, null, null] };
  assert.equal(changedCellCount(days, sprinter, WEEK), 2);
  assert.equal(changedCellCount(days, null, WEEK), 0);
});

test("catalogForRiderType: typens programmer foerst, ellers katalogets raekkefoelge", () => {
  assert.deepEqual(catalogForRiderType([base, sprinter], "sprinter").map((p) => p.key), ["sprinter", "build_base"]);
  assert.deepEqual(catalogForRiderType([base, sprinter], null).map((p) => p.key), ["build_base", "sprinter"]);
});

test("navn og tagline foelger sproget (EN er default)", () => {
  assert.equal(programName(base, "da"), "Byg base");
  assert.equal(programName(base, "en-GB"), "Build base");
  assert.equal(programTagline(sprinter, undefined), "Sprint twice a week.");
});

test("programSessionToday: kun for en programplan; kolonnen vaelger slot", () => {
  const days = planFrom(sprinter);
  days.fri = { ...days.fri, slots: [null, null, "technique", null, null] };
  assert.equal(programSessionToday(days, WEEK, "fri", 3), "technique");
  assert.equal(programSessionToday(days, WEEK, "fri", 1), "sprint");
  assert.equal(programSessionToday({ fri: { intensity: "hard" } }, WEEK, "fri", 1), null);
  assert.equal(isWholeDaySession("rest"), true);
  assert.equal(isWholeDaySession("sprint"), false);
});
