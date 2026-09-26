// #4629 — traeningsprogrammer pr. loebsdag: rene funktioner.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_PROGRAMS, TRAINING_PROGRAM_KEYS, PROGRAM_SLOTS, PROGRAM_SESSIONS,
  programWeekDaysFor, isValidProgramWeekDays, setProgramCell, sessionForDayEntry,
  programSlotForGameDay, resolveDayProgram, stripProgramFromWeekDays, weekDaysHaveSessions,
  intensityForSession, trainingProgramCatalog,
} from "./trainingPrograms.js";
import { WEEKDAY_KEYS, resolveDayIntensity, isValidWeekPlanDays } from "./training.js";
import { ALL_SESSIONS } from "./trainingDayTypes.js";

test("kataloget: 22 ejer-godkendte programmer, unikke noegler, kun eksisterende sessioner", () => {
  assert.equal(TRAINING_PROGRAMS.length, 22);
  assert.equal(new Set(TRAINING_PROGRAM_KEYS).size, 22);
  for (const program of TRAINING_PROGRAMS) {
    assert.deepEqual(Object.keys(program.days), [...WEEKDAY_KEYS], `${program.key}: alle 7 ugedage`);
    for (const session of Object.values(program.days)) {
      assert.ok(PROGRAM_SESSIONS.includes(session), `${program.key}: ${session} findes`);
    }
    assert.ok(program.nameEn && program.nameDa && program.taglineEn && program.taglineDa, `${program.key}: EN+DA`);
    assert.ok(!/[—–]/.test(program.taglineEn + program.taglineDa), `${program.key}: ingen tankestreg (TONE_OF_VOICE)`);
  }
  // Ingen ny session opfundet: kataloget er en delmaengde af de eksisterende.
  assert.deepEqual(PROGRAM_SESSIONS.filter((s) => !["rest", "recovery"].includes(s)), [...ALL_SESSIONS]);
});

test("tildeling er KOPI: hver kopi er et nyt objekt, og en rettelse af kopien roerer hverken kataloget eller andre kopier", () => {
  const a = programWeekDaysFor("sprinter");
  const b = programWeekDaysFor("sprinter");
  assert.notEqual(a, b);
  assert.notEqual(a.mon, b.mon);
  a.mon.session = "rest";
  assert.equal(b.mon.session, "sprint");
  assert.equal(TRAINING_PROGRAMS.find((p) => p.key === "sprinter").days.mon, "sprint");
  assert.ok(Object.isFrozen(TRAINING_PROGRAMS[0].days), "kataloget kan ikke muteres");
  assert.equal(programWeekDaysFor("does_not_exist"), null);
});

test("en programraekke er OGSAA en gyldig gammel ugerytme (intensitet afledt af sessionen)", () => {
  for (const key of TRAINING_PROGRAM_KEYS) {
    const days = programWeekDaysFor(key);
    assert.ok(isValidProgramWeekDays(days), key);
    assert.ok(isValidWeekPlanDays(days), `${key}: den gamle validator accepterer den`);
    for (const weekday of WEEKDAY_KEYS) {
      assert.equal(days[weekday].intensity, intensityForSession(days[weekday].session));
    }
  }
});

test("isValidProgramWeekDays afviser modsigende intensitet, ukendt session og for mange slots", () => {
  const days = programWeekDaysFor("sprinter");
  assert.equal(isValidProgramWeekDays({ ...days, mon: { session: "sprint", intensity: "easy" } }), false);
  assert.equal(isValidProgramWeekDays({ ...days, mon: { session: "moonwalk", intensity: "hard" } }), false);
  assert.equal(isValidProgramWeekDays({ ...days, mon: { ...days.mon, slots: [null, null, null, null, null, null] } }), false);
  const { sun: _drop, ...six } = days;
  assert.equal(isValidProgramWeekDays(six), false);
});

test("setProgramCell: hele ugedagen skifter session + intensitet; et slot overstyres enkeltvis", () => {
  const days = programWeekDaysFor("sprinter");
  const whole = setProgramCell(days, { weekday: "mon", session: "recovery" });
  assert.deepEqual(whole.mon, { session: "recovery", intensity: "recovery" });
  assert.equal(days.mon.session, "sprint", "input muteres ikke");

  const slot = setProgramCell(days, { weekday: "mon", slotIndex: 3, session: "technique" });
  assert.deepEqual(slot.mon.slots, [null, null, null, "technique", null]);
  assert.equal(slot.mon.session, "sprint", "ugedagen er uaendret");
  assert.equal(sessionForDayEntry(slot.mon, 3), "technique");
  assert.equal(sessionForDayEntry(slot.mon, 0), "sprint", "andre slots foelger ugedagen");

  const back = setProgramCell(slot, { weekday: "mon", slotIndex: 3, session: "sprint" });
  assert.equal(back.mon.slots, undefined, "et slot lig ugedagen er 'foelger ugedagen'");
  assert.equal(setProgramCell(days, { weekday: "mon", slotIndex: PROGRAM_SLOTS, session: "sprint" }), null);
  assert.equal(setProgramCell(days, { weekday: "xyz", session: "sprint" }), null);
});

test("programSlotForGameDay: 5 loebsdage pr. dato; uden loebsdag = slot 0", () => {
  assert.equal(programSlotForGameDay(0), 0);
  assert.equal(programSlotForGameDay(12), 2);
  assert.equal(programSlotForGameDay(139), 4);
  assert.equal(programSlotForGameDay(null), 0);
  assert.equal(programSlotForGameDay(undefined), 0);
});

const PROGRAM = { focus: "vo2max", intensity: "hard" };

test("resolveDayProgram med programsOn=false er PRAECIS den gamle resolveDayIntensity (alle lag-kombinationer)", () => {
  const programDays = programWeekDaysFor("sprinter");
  const legacyDays = stripProgramFromWeekDays(programDays);
  const cases = [];
  for (const rider of [null, programDays, legacyDays]) {
    for (const team of [null, programDays, legacyDays]) {
      for (const hasExplicitPlan of [true, false]) {
        for (const weekday of WEEKDAY_KEYS) cases.push({ rider, team, hasExplicitPlan, weekday });
      }
    }
  }
  for (const c of cases) {
    const out = resolveDayProgram({
      weekday: c.weekday, riderOverrideDays: c.rider, teamWeekDays: c.team, program: PROGRAM,
      hasExplicitPlan: c.hasExplicitPlan, programsOn: false,
    });
    const expected = resolveDayIntensity({
      weekday: c.weekday, riderOverrideDays: c.rider, teamWeekDays: c.team,
      planIntensity: PROGRAM.intensity, hasExplicitPlan: c.hasExplicitPlan,
    });
    assert.equal(out.intensity, expected);
    assert.equal(out.focus, PROGRAM.focus, "fokus roeres aldrig med flaget off");
    assert.equal(out.source, "legacy");
  }
});

test("resolveDayProgram med programsOn: stigen er uaendret — lag 1 > egen plan > lag 3", () => {
  const riderDays = programWeekDaysFor("sprinter"); // fre = sprint
  const teamDays = programWeekDaysFor("time_trial"); // fre = endurance
  const base = { weekday: "fri", program: PROGRAM, programsOn: true };

  assert.equal(resolveDayProgram({ ...base, riderOverrideDays: riderDays, teamWeekDays: teamDays, hasExplicitPlan: true }).focus, "sprint");
  // Egen eksplicit plan slaar holdets programraekke (#2438).
  const own = resolveDayProgram({ ...base, riderOverrideDays: null, teamWeekDays: teamDays, hasExplicitPlan: true });
  assert.deepEqual([own.focus, own.intensity, own.source], ["vo2max", "hard", "legacy"]);
  // Uden egen plan gaelder holdets programraekke.
  assert.equal(resolveDayProgram({ ...base, riderOverrideDays: null, teamWeekDays: teamDays, hasExplicitPlan: false }).focus, "endurance");
  // En gammel intensitets-override (lag 1) vinder stadig over holdets programraekke.
  const legacyRider = stripProgramFromWeekDays(programWeekDaysFor("recovery_week"));
  const old = resolveDayProgram({ ...base, riderOverrideDays: legacyRider, teamWeekDays: teamDays, hasExplicitPlan: false });
  assert.equal(old.source, "legacy");
  assert.equal(old.intensity, legacyRider.fri.intensity);
});

test("stripProgramFromWeekDays: uden programdata returneres SAMME objekt (gammel skrivesti uaendret)", () => {
  const legacy = { mon: { intensity: "hard" }, tue: { intensity: "rest" } };
  assert.equal(stripProgramFromWeekDays(legacy), legacy);
  const stripped = stripProgramFromWeekDays(programWeekDaysFor("sprinter"));
  assert.equal(weekDaysHaveSessions(stripped), false);
  assert.deepEqual(stripped.mon, { intensity: "hard" });
});

test("katalog-API'et leverer begge sprog og kopier (ikke referencer til det frosne katalog)", () => {
  const catalog = trainingProgramCatalog();
  assert.equal(catalog.length, 22);
  assert.equal(catalog[0].name.en, "Sprinter");
  catalog[0].days.mon = "rest";
  assert.equal(TRAINING_PROGRAMS[0].days.mon, "sprint");
});
