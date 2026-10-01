// #5932 · saaning af de 35 felter for en rytter uden felter.
import assert from "node:assert/strict";
import test from "node:test";

import { seedProgramWeekDays, sessionForLegacyDay } from "./trainingWeekPlanCells.js";
import { isValidProgramWeekDays, programWeekDaysFor, setProgramCell } from "./trainingPrograms.js";

const INTENSITY_ORDER_FOR_TEST = { rest: 0, recovery: 1, easy: 2, normal: 3, hard: 4 };

const WEEK = (intensity) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { intensity }]));

test("en rytter med felter beholder dem uroert (kopi, ikke samme objekt)", () => {
  const days = setProgramCell(programWeekDaysFor("sprinter"), { weekday: "mon", slotIndex: 2, session: "recovery" });
  const seeded = seedProgramWeekDays({ riderDays: days });
  assert.deepEqual(seeded, days);
  assert.notEqual(seeded, days);
  assert.notEqual(seeded.mon.slots, days.mon.slots);
});

test("holdets felter kopieres til en rytter uden egen plan", () => {
  const team = programWeekDaysFor("balanced_week");
  assert.deepEqual(seedProgramWeekDays({ teamDays: team }), team);
  // Med eksplicit plan vinder rytterens plan (#2438), ikke holdets felter.
  const own = seedProgramWeekDays({ teamDays: team, plan: { focus: "sprint", intensity: "hard" } });
  assert.equal(own.wed.session, "sprint");
});

test("gammel ugerytme: hvile og restitution bevares, fokus foelger med", () => {
  const riderDays = { ...WEEK("easy"), sun: { intensity: "rest" }, wed: { intensity: "recovery" } };
  const seeded = seedProgramWeekDays({ riderDays, plan: { focus: "endurance", intensity: "easy" } });
  assert.ok(isValidProgramWeekDays(seeded));
  assert.equal(seeded.sun.session, "rest");
  assert.equal(seeded.wed.session, "recovery");
  assert.equal(seeded.mon.session, "endurance");
});

test("ingen rytter faar en haardere dag end i dag: en dag der ville rykke op, starter som hvile", () => {
  // Fokus paa en haard session, men ugerytmen siger let: sessionen ville vaere
  // haard. Ejer-valget 14/8 (migrationTargetFor) starter dagen som hvile.
  const seeded = seedProgramWeekDays({ riderDays: WEEK("easy"), plan: { focus: "vo2max", intensity: "hard" } });
  for (const day of Object.values(seeded)) {
    assert.ok(INTENSITY_ORDER_FOR_TEST[day.intensity] <= INTENSITY_ORDER_FOR_TEST.easy, `${day.session}/${day.intensity}`);
  }
  assert.equal(sessionForLegacyDay({ focus: "vo2max", intensity: "hard" }), "vo2max");
});

test("ingen data: rytterens smarte standardfokus og standardintensitet", () => {
  const seeded = seedProgramWeekDays({ primaryType: "sprinter" });
  assert.ok(isValidProgramWeekDays(seeded));
});
