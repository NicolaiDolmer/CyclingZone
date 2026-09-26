// #4629 — traeningsprogrammer pr. loebsdag: rene funktioner.
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAINING_PROGRAMS, TRAINING_PROGRAM_KEYS, PROGRAM_SLOTS, PROGRAM_SESSIONS,
  programWeekDaysFor, isValidProgramWeekDays, setProgramCell, sessionForDayEntry,
  programSlotForRaceDay, resolveDayProgram, stripProgramFromWeekDays, weekDaysHaveSessions,
  intensityForSession, trainingProgramCatalog,
} from "./trainingPrograms.js";
import { WEEKDAY_KEYS, resolveDayIntensity, isValidWeekPlanDays } from "./training.js";
import { ALL_SESSIONS } from "./trainingDayTypes.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { isTrainingProgramsEnabledForTeam } from "./trainingProgramsFlag.js";

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
  for (const program of TRAINING_PROGRAMS) {
    for (const type of program.targetTypes) {
      assert.ok(RIDER_TYPE_KEYS.includes(type), `${program.key}: ${type} er en rigtig rytter-type`);
    }
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

test("programSlotForRaceDay: pladsen blandt datoens loebsdage, ikke modulo 5", () => {
  // Prod-aksen ligger ikke paa modulo-5-graenser: datoen 8-12 giver slot 0-4.
  const date = [8, 9, 10, 11, 12];
  assert.deepEqual(date.map((gd) => programSlotForRaceDay(gd, date)), [0, 1, 2, 3, 4]);
  // Og 1-5 giver ogsaa 0-4 (modulo 5 ville give 1,2,3,4,0).
  const first = [1, 2, 3, 4, 5];
  assert.deepEqual(first.map((gd) => programSlotForRaceDay(gd, first)), [0, 1, 2, 3, 4]);
  // Listen sorteres og dedupliceres; raekkefoelgen fra kalderen er ligegyldig.
  assert.equal(programSlotForRaceDay(10, [12, 10, 11, 10]), 0);
  assert.equal(programSlotForRaceDay(12, [12, 10, 11]), 2);
});

test("programSlotForRaceDay: kobling til gitteret - kolonne k (1-baseret) er slot k-1", () => {
  // Gitteret (frontend slotForColumnIndex) laegger kolonne k paa slot k-1 og
  // kolonne k = den k'te loebsdag paa dayClose.gameDays. Motoren skal ramme SAMME
  // slot for den loebsdag, ellers rammer en rettet celle en anden loebsdag.
  const slotForColumnIndex = (k) => Math.min(PROGRAM_SLOTS - 1, k - 1);
  for (const dayCloseGameDays of [[8, 9, 10, 11, 12], [1, 2, 3, 4, 5], [23, 24, 25], [140]]) {
    dayCloseGameDays.forEach((gd, i) => {
      assert.equal(programSlotForRaceDay(gd, dayCloseGameDays), slotForColumnIndex(i + 1), `loebsdag ${gd} i ${dayCloseGameDays}`);
    });
  }
});

test("programSlotForRaceDay: flere loebsdage end slots lofter ved sidste slot", () => {
  const span = [5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(span.map((gd) => programSlotForRaceDay(gd, span)), [0, 1, 2, 3, 4, 4, 4, 4]);
});

test("programSlotForRaceDay: uden loebsdag, uden liste eller ukendt loebsdag = slot 0", () => {
  assert.equal(programSlotForRaceDay(null, [1, 2, 3]), 0);
  assert.equal(programSlotForRaceDay(undefined, [1, 2, 3]), 0);
  assert.equal(programSlotForRaceDay(12, null), 0);
  assert.equal(programSlotForRaceDay(12, undefined), 0);
  assert.equal(programSlotForRaceDay(12, [1, 2, 3]), 0);
  assert.equal(programSlotForRaceDay(2, [null, 1, 2]), 1, "null-poster (division-loest hold) ignoreres");
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

// Motor-stien: et FEJLET opslag kaster (motoren retry'er), et manglende svar er off.
function fakeDb(tables, failTable = null) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(c, v) { filters.push([c, v]); return q; },
        async maybeSingle() {
          if (table === failTable) return { data: null, error: { message: "boom" } };
          const row = (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: row ?? null, error: null };
        },
      };
      return q;
    },
  };
}

test("isTrainingProgramsEnabledForTeam: on/beta-ejer/ikke-beta/manglende flag, og KAST ved fejlet opslag", async () => {
  const base = { teams: [{ id: "t1", user_id: "u1" }], users: [{ id: "u1", role: "manager", is_beta_tester: true }] };
  assert.equal(await isTrainingProgramsEnabledForTeam(fakeDb({ ...base, app_config: [{ key: "training_programs", value: "on" }] }), "t1"), true);
  assert.equal(await isTrainingProgramsEnabledForTeam(fakeDb({ ...base, app_config: [{ key: "training_programs", value: "beta" }] }), "t1"), true);
  const notBeta = { ...base, users: [{ id: "u1", role: "manager", is_beta_tester: false }], app_config: [{ key: "training_programs", value: "beta" }] };
  assert.equal(await isTrainingProgramsEnabledForTeam(fakeDb(notBeta), "t1"), false);
  assert.equal(await isTrainingProgramsEnabledForTeam(fakeDb(base), "t1"), false, "ingen flag-raekke = off");
  await assert.rejects(isTrainingProgramsEnabledForTeam(fakeDb(base, "app_config"), "t1"), /flag load/);
  await assert.rejects(
    isTrainingProgramsEnabledForTeam(fakeDb({ ...base, app_config: [{ key: "training_programs", value: "beta" }] }, "users"), "t1"),
    /owner beta load/,
  );
});
