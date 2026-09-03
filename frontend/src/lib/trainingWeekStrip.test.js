import test from "node:test";
import assert from "node:assert/strict";
import { WEEK_STRIP_DAYS, weekStripWeekdays, riderWeekStrip } from "./trainingWeekStrip.js";

// #4613 — uge-strippen på trænings-overblikket (retning B).

test("weekStripWeekdays starter på I DAG og ruller 7 dage frem", () => {
  // 2026-06-16 er en tirsdag.
  const days = weekStripWeekdays(new Date(2026, 5, 16));
  assert.equal(days.length, WEEK_STRIP_DAYS);
  assert.deepEqual(
    days.map((d) => d.weekday),
    ["tue", "wed", "thu", "fri", "sat", "sun", "mon"],
  );
  assert.equal(days[0].isToday, true);
  assert.equal(days.filter((d) => d.isToday).length, 1);
});

test("weekStripWeekdays wrapper korrekt fra en søndag", () => {
  // 2026-06-21 er en søndag.
  assert.deepEqual(
    weekStripWeekdays(new Date(2026, 5, 21)).map((d) => d.weekday),
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  );
});

test("riderWeekStrip bruger holdets ugerytme for en rytter uden egen plan", () => {
  const teamWeekDays = {
    mon: { intensity: "hard" }, tue: { intensity: "normal" }, wed: { intensity: "hard" },
    thu: { intensity: "easy" }, fri: { intensity: "hard" }, sat: { intensity: "hard" },
    sun: { intensity: "rest" },
  };
  const strip = riderWeekStrip({ fromDate: new Date(2026, 5, 16), teamWeekDays });
  assert.deepEqual(
    strip.map((d) => d.intensity),
    ["normal", "hard", "easy", "hard", "hard", "rest", "hard"],
  );
});

test("riderWeekStrip lader rytterens EGEN ugeplan vinde over holdrytmen", () => {
  const teamWeekDays = {
    mon: { intensity: "hard" }, tue: { intensity: "hard" }, wed: { intensity: "hard" },
    thu: { intensity: "hard" }, fri: { intensity: "hard" }, sat: { intensity: "hard" },
    sun: { intensity: "hard" },
  };
  const riderOverrideDays = { ...teamWeekDays, tue: { intensity: "rest" } };
  const strip = riderWeekStrip({ fromDate: new Date(2026, 5, 16), teamWeekDays, riderOverrideDays });
  assert.equal(strip[0].intensity, "rest");
});

test("riderWeekStrip markerer KUN i dag som løbsdag (ingen opdigtet kalender fremad)", () => {
  const strip = riderWeekStrip({ fromDate: new Date(2026, 5, 16), racingToday: true });
  assert.equal(strip[0].isRace, true);
  assert.equal(strip.filter((d) => d.isRace).length, 1);
});

test("riderWeekStrip uden nogen plan falder tilbage på normal, aldrig undefined", () => {
  const strip = riderWeekStrip({ fromDate: new Date(2026, 5, 16) });
  assert.equal(strip.length, WEEK_STRIP_DAYS);
  for (const day of strip) assert.equal(day.intensity, "normal");
});
