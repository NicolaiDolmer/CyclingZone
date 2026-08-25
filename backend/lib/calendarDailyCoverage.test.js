import test from "node:test";
import assert from "node:assert/strict";

import {
  calendarDateRange,
  detectEmptyCalendarDays,
  minGameDaysForFullCoverage,
} from "./calendarDailyCoverage.js";

test("calendarDateRange: S3-vinduet er 31 kalenderdage (28/8-27/9)", () => {
  const range = calendarDateRange("2026-08-28", "2026-09-27");
  assert.equal(range.length, 31);
  assert.equal(range[0], "2026-08-28");
  assert.equal(range.at(-1), "2026-09-27");
});

test("calendarDateRange: krydser månedsskifte uden at tabe en dag", () => {
  const range = calendarDateRange("2026-08-30", "2026-09-02");
  assert.deepEqual(range, ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
});

// DST-skiftet i Danmark falder 25/10 2026. Regner vi i lokal tid, giver det døgn på
// 23 og 25 timer og dermed en tabt eller dubleret dato. Vi regner i UTC-midnat.
test("calendarDateRange: DST-skiftet må ikke tabe eller dublere en dato", () => {
  const range = calendarDateRange("2026-10-24", "2026-10-26");
  assert.deepEqual(range, ["2026-10-24", "2026-10-25", "2026-10-26"]);
});

test("calendarDateRange: omvendt interval → tom", () => {
  assert.deepEqual(calendarDateRange("2026-09-27", "2026-08-28"), []);
});

test("detectEmptyCalendarDays: fuld dækning i alle divisioner → ok", () => {
  const dates = calendarDateRange("2026-08-28", "2026-08-31");
  const stageDays = [1, 4].flatMap((division) => dates.map((date) => ({ division, date })));
  const res = detectEmptyCalendarDays({
    stageDays, from: "2026-08-28", to: "2026-08-31", divisions: [1, 4],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.violations, []);
});

// Kernefælden: spillet som helhed har løb hver dag, men D4 har huller. En global
// optælling ville sige ok — reglen gælder pr. division (ejer 25/8).
test("detectEmptyCalendarDays (#4215): D1 dækker alt, D4 har hul → ikke ok", () => {
  const dates = calendarDateRange("2026-08-28", "2026-08-31");
  const stageDays = [
    ...dates.map((date) => ({ division: 1, date })),
    ...dates.filter((d) => d !== "2026-08-30").map((date) => ({ division: 4, date })),
  ];
  const res = detectEmptyCalendarDays({
    stageDays, from: "2026-08-28", to: "2026-08-31", divisions: [1, 4],
  });
  assert.equal(res.ok, false);
  assert.equal(res.violations.length, 1);
  assert.match(res.violations[0], /division 4 har 1 kalenderdag\(e\) uden løb: 2026-08-30/);
  assert.deepEqual(res.emptyByDivision.get("4"), ["2026-08-30"]);
});

// En division der mangler HELT kan kun opdages hvis kalderen sender listen eksplicit.
test("detectEmptyCalendarDays: division uden en eneste etape fanges via divisions-listen", () => {
  const dates = calendarDateRange("2026-08-28", "2026-08-30");
  const stageDays = dates.map((date) => ({ division: 1, date }));
  const uden = detectEmptyCalendarDays({ stageDays, from: "2026-08-28", to: "2026-08-30" });
  assert.equal(uden.ok, true, "uden divisions-liste er D4 usynlig");
  const med = detectEmptyCalendarDays({
    stageDays, from: "2026-08-28", to: "2026-08-30", divisions: [1, 4],
  });
  assert.equal(med.ok, false);
  assert.deepEqual(med.emptyByDivision.get("4"), dates);
});

test("detectEmptyCalendarDays: beskeden trunkeres ved mere end 5 datoer", () => {
  const res = detectEmptyCalendarDays({
    stageDays: [], from: "2026-08-28", to: "2026-09-27", divisions: [4],
  });
  assert.equal(res.ok, false);
  assert.match(res.violations[0], /31 kalenderdag\(e\) uden løb/);
  assert.match(res.violations[0], /\(\+26 flere\)/);
});

test("detectEmptyCalendarDays: dubletter i stageDays ændrer ikke dommen", () => {
  const stageDays = [
    { division: 1, date: "2026-08-28" },
    { division: 1, date: "2026-08-28" },
    { division: 1, date: "2026-08-29" },
  ];
  const res = detectEmptyCalendarDays({
    stageDays, from: "2026-08-28", to: "2026-08-29", divisions: [1],
  });
  assert.equal(res.ok, true);
});

test("detectEmptyCalendarDays: ugyldigt interval → ikke ok", () => {
  const res = detectEmptyCalendarDays({ stageDays: [], from: "hejsa", to: "2026-09-27" });
  assert.equal(res.ok, false);
  assert.match(res.violations[0], /ugyldigt datointerval/);
});

test("minGameDaysForFullCoverage: 31 kalenderdage kræver mindst 31 løbsdage", () => {
  assert.equal(minGameDaysForFullCoverage(31), 31);
  assert.equal(minGameDaysForFullCoverage(0), 0);
  assert.equal(minGameDaysForFullCoverage(undefined), 0);
});
