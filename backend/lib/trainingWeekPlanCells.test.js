// #5932 · saaning af de 35 felter for en rytter uden felter.
import assert from "node:assert/strict";
import test from "node:test";

import { seedProgramWeekDays, sessionForLegacyDay } from "./trainingWeekPlanCells.js";
import {
  isValidProgramWeekDays, programWeekDaysFor, setProgramCell, stripProgramFromWeekDays, weekDaysHaveSessions,
} from "./trainingPrograms.js";
import { isValidWeekPlanDays } from "./training.js";

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

// ── #8549 PR 1: laesesiden for lockSlot (ingen skriver endnu) ─────────────────
const lockedDays = (lockSlot, weekday = "tue") => {
  const days = programWeekDaysFor("sprinter");
  return { ...days, [weekday]: { ...days[weekday], lockSlot } };
};

test("#8549 isValidProgramWeekDays godtager lockSlot 0..4 og afviser 5, -1, streng og kommatal", () => {
  for (const slot of [0, 1, 2, 3, 4]) assert.equal(isValidProgramWeekDays(lockedDays(slot)), true, `lockSlot ${slot}`);
  for (const bad of [5, -1, "2", "0", 1.5, Number.NaN, true, [2], { slot: 2 }]) {
    assert.equal(isValidProgramWeekDays(lockedDays(bad)), false, `lockSlot ${JSON.stringify(bad)}`);
  }
  // Manglende noegle eller null = ingen laas (samme form som effort, #7947).
  assert.equal(isValidProgramWeekDays(lockedDays(null)), true);
  assert.equal(isValidProgramWeekDays(programWeekDaysFor("sprinter")), true, "gammel raekke uden noeglen er uaendret gyldig");
  // Andre ukendte noegler afvises stadig.
  const days = programWeekDaysFor("sprinter");
  assert.equal(isValidProgramWeekDays({ ...days, tue: { ...days.tue, lock: 2 } }), false);
  // Den gamle intensitets-validator laeser stadig raekken.
  assert.equal(isValidWeekPlanDays(lockedDays(4)), true);
});

test("#8549 en laast raekke saaes ikke forfra: seedProgramWeekDays (copyDays) bevarer laasen", () => {
  const days = lockedDays(4);
  const seeded = seedProgramWeekDays({ riderDays: days });
  assert.deepEqual(seeded, days);
  assert.equal(seeded.tue.lockSlot, 4);
  assert.equal(seeded.mon.lockSlot, undefined, "dage uden laas faar ingen noegle");
  // Holdets laaste felter kopieres ogsaa med til en rytter uden egen plan.
  assert.equal(seedProgramWeekDays({ teamDays: lockedDays(0, "sat") }).sat.lockSlot, 0);
  // lockSlot null kopieres ikke (ingen laas).
  assert.equal("lockSlot" in seedProgramWeekDays({ riderDays: lockedDays(null) }).tue, false);
});

test("#8549 setProgramCell bevarer laasen, baade paa den rettede og de andre dage", () => {
  const days = { ...lockedDays(2), fri: { ...programWeekDaysFor("sprinter").fri, lockSlot: 0 } };
  const slot = setProgramCell(days, { weekday: "tue", slotIndex: 2, session: "recovery" });
  assert.equal(slot.tue.lockSlot, 2);
  assert.equal(slot.fri.lockSlot, 0);
  const whole = setProgramCell(days, { weekday: "tue", session: "endurance" });
  assert.equal(whole.tue.lockSlot, 2);
  assert.ok(isValidProgramWeekDays(whole));
  assert.equal(days.tue.slots, undefined, "input muteres ikke");
});

test("#8549 stripProgramFromWeekDays fjerner laasen med programcellen", () => {
  const stripped = stripProgramFromWeekDays(lockedDays(3));
  assert.equal(weekDaysHaveSessions(stripped), false);
  assert.deepEqual(stripped.tue, { intensity: programWeekDaysFor("sprinter").tue.intensity });
  // En raekke med KUN en laas-noegle (ingen session) regnes ogsaa som programdata.
  const onlyLock = { mon: { intensity: "hard", lockSlot: 1 } };
  assert.deepEqual(stripProgramFromWeekDays(onlyLock), { mon: { intensity: "hard" } });
});
