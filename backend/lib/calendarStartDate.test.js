import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import {
  resolveCalendarFrom, nextMonday, resolveSeasonWindow, seasonFinishWeekday, seasonEndCandidates,
  sundayEndCandidates, SATURDAY_FINISH_FROM_SEASON, SEASON_RACE_DAYS_DEFAULT,
} from "./calendarStartDate.js";

const SAT_27 = new Date("2026-06-27T13:00:00Z"); // lør 27/6 (dansk tid)

function day0CopenhagenDate(from) {
  const placements = [{ id: "X", stagesPlaced: [{ stage_number: 1, real_day: 0, game_day: 0 }] }];
  const { stageRows } = buildScheduleRows({ placements, from });
  return copenhagenDateString(new Date(stageRows[0].scheduled_at));
}

test("nextMonday: en lørdag → den følgende mandag", () => {
  assert.equal(nextMonday(SAT_27), "2026-06-29");
});

test("nextMonday: en mandag → samme mandag", () => {
  assert.equal(nextMonday(new Date("2026-06-29T13:00:00Z")), "2026-06-29");
});

test("resolveCalendarFrom: dag-0 lander på den valgte første løbsdag", () => {
  const from = resolveCalendarFrom({ firstRaceDate: "2026-06-29", now: SAT_27 });
  assert.equal(day0CopenhagenDate(from), "2026-06-29");
});

test("resolveCalendarFrom: default = næste mandag (anti-blitz: aldrig sæson-start i fortiden)", () => {
  const from = resolveCalendarFrom({ now: SAT_27 });
  assert.equal(day0CopenhagenDate(from), "2026-06-29");
});

test("resolveCalendarFrom: default på en MANDAG kaster ikke — rykker til næste uges mandag", () => {
  // nextMonday(mandag) = i dag → default-stien ville ellers throw'e (CodeRabbit-finding #1).
  const MON = new Date("2026-06-29T13:00:00Z"); // mandag 29/6
  const from = resolveCalendarFrom({ now: MON });
  assert.equal(day0CopenhagenDate(from), "2026-07-06"); // næste mandag, ikke i dag
});

test("resolveCalendarFrom: afviser en første løbsdag i fortiden (rod-årsag for 27/6-blitzen)", () => {
  assert.throws(
    () => resolveCalendarFrom({ firstRaceDate: "2026-06-22", now: SAT_27 }),
    /fortid|past/i,
  );
});

test("resolveCalendarFrom: afviser også i-dag (dag-0 må være en fremtidig dag)", () => {
  assert.throws(
    () => resolveCalendarFrom({ firstRaceDate: "2026-06-27", now: SAT_27 }),
    /fortid|past/i,
  );
});

// ── #5833: lørdag som sidste løbsdag fra S5 (ejer 14/10, forum-afstemning) ─────────────
// CALENDAR_RULES §2: S1-S4 slutter søndag (#4131, uændret: S4 slutter søndag 25/10). Fra S5
// slutter sæsonen LØRDAG. Beslutning i dette spor: fra S5 er KUN lørdag lovlig; en S5 med
// søndags-slut afvises, så den gamle regel ikke kan snige sig ind ved et uheld.

test("#5833 seasonFinishWeekday: søndag til og med S4, lørdag fra S5", () => {
  assert.equal(SATURDAY_FINISH_FROM_SEASON, 5);
  for (const n of [1, 2, 3, 4]) assert.equal(seasonFinishWeekday(n), 0, `S${n}`);
  for (const n of [5, 6, 7, 12]) assert.equal(seasonFinishWeekday(n), 6, `S${n}`);
  assert.equal(seasonFinishWeekday("5"), 6, "et CLI-argument som streng tolkes som tal");
  assert.equal(seasonFinishWeekday(), 0, "uden sæson: reglen fra før #5833 (søndag)");
  assert.equal(seasonFinishWeekday(null), 0);
});

test("#5833 seasonFinishWeekday: et ugyldigt sæsonnummer kaster i stedet for at falde tilbage til søndag", () => {
  for (const bad of [Number.NaN, 0, -1, 4.5, "", "abc"]) {
    assert.throws(() => seasonFinishWeekday(bad), /invalid season number/, String(bad));
  }
});

test("#5833 S5: onsdag 28/10 → lørdag 28/11 accepteres (32 løbsdatoer)", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-10-28", lastRaceDay: "2026-11-28", seasonNumber: 5 });
  assert.equal(w.lastRaceDay, "2026-11-28");
  assert.equal(w.raceDays, 32);
  assert.equal(w.finishWeekday, 6);
  assert.equal(w.finishWeekdayName, "Saturday");
  assert.equal(w.derived, false);
  // Samme vindue givet som længde.
  assert.equal(resolveSeasonWindow({ firstRaceDay: "2026-10-28", raceDays: 32, seasonNumber: 5 }).lastRaceDay, "2026-11-28");
});

test("#5833 S5: det udledte forslag fra onsdag 28/10 er netop lørdag 28/11", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-10-28", seasonNumber: 5 });
  assert.equal(w.derived, true);
  assert.equal(w.lastRaceDay, "2026-11-28", "|32-31| = 1 er tættest på S3's 31");
  assert.deepEqual(w.candidates.map((c) => c.lastRaceDay), ["2026-11-21", "2026-11-28", "2026-12-05"]);
});

test("#5833 S5 med søndags-slut (29/11) afvises og peger på de lovlige lørdage", () => {
  assert.throws(
    () => resolveSeasonWindow({ firstRaceDay: "2026-10-28", lastRaceDay: "2026-11-29", seasonNumber: 5 }),
    (e) => /is not a Saturday/.test(e.message) && /season 5/.test(e.message) && /32 \(to 2026-11-28\)/.test(e.message),
  );
});

test("#5833 S4 er uændret: mandag 28/9 → søndag 25/10, og en lørdag afvises", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-09-28", raceDays: SEASON_RACE_DAYS_DEFAULT[4], seasonNumber: 4 });
  assert.equal(w.lastRaceDay, "2026-10-25");
  assert.equal(w.raceDays, 28);
  assert.equal(w.finishWeekday, 0);
  assert.throws(
    () => resolveSeasonWindow({ firstRaceDay: "2026-09-28", lastRaceDay: "2026-10-24", seasonNumber: 4 }),
    /is not a Sunday .*season 4/,
  );
  // Uden sæsonnummer: præcis som før #5833 (søndag), så S4-værktøjerne ikke flytter sig.
  assert.equal(resolveSeasonWindow({ firstRaceDay: "2026-09-28", raceDays: 28 }).lastRaceDay, "2026-10-25");
});

test("#5833 S6 (foreløbig plan): mandag 30/11 → lørdag 26/12 er et lovligt vindue", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-11-30", lastRaceDay: "2026-12-26", seasonNumber: 6 });
  assert.equal(w.raceDays, 27);
  assert.equal(w.finishWeekday, 6);
});

test("#5833 seasonEndCandidates: lørdags-udgaven, og søndags-indgangen er uændret", () => {
  assert.deepEqual(
    seasonEndCandidates("2026-10-28", { finishWeekday: 6 }).map((c) => c.raceDays), [25, 32, 39],
  );
  assert.deepEqual(sundayEndCandidates("2026-09-28").map((c) => c.raceDays), [21, 28, 35, 42]);
  assert.deepEqual(seasonEndCandidates("2026-09-28"), sundayEndCandidates("2026-09-28"), "default = søndag");
});
