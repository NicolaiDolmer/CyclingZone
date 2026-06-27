import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { resolveCalendarFrom, nextMonday } from "./calendarStartDate.js";

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
