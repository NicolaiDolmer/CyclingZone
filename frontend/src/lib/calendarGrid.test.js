// Unit-tests for calendarGrid.js — ren måneds-grid-logik.
// Kører med: node --test (i frontend/)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  daysInMonth,
  mondayFirstWeekday,
  buildMonthGrid,
  isoOf,
  groupEntriesByDate,
  monthsWithRaces,
  stepMonth,
  filterEntries,
} from "./calendarGrid.js";

test("daysInMonth håndterer skudår + måneds-længder", () => {
  assert.equal(daysInMonth(2026, 6), 30);
  assert.equal(daysInMonth(2026, 7), 31);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29); // skudår
});

test("mondayFirstWeekday: mandag=0 … søndag=6", () => {
  // 2026-06-01 er en mandag.
  assert.equal(mondayFirstWeekday(2026, 6, 1), 0);
  // 2026-06-07 er en søndag.
  assert.equal(mondayFirstWeekday(2026, 6, 7), 6);
  // 2026-07-12 er en søndag.
  assert.equal(mondayFirstWeekday(2026, 7, 12), 6);
});

test("buildMonthGrid: 7 kolonner pr. uge, måneds-dage på rette pladser", () => {
  const weeks = buildMonthGrid(2026, 6); // juni 2026, starter mandag
  assert.ok(weeks.every((w) => w.length === 7), "hver uge har 7 slots");
  // Juni starter på en mandag → første celle = dag 1, ingen leading-null.
  assert.equal(weeks[0][0].day, 1);
  assert.equal(weeks[0][0].iso, "2026-06-01");
  // Sidste reelle dag = 30.
  const flat = weeks.flat().filter(Boolean);
  assert.equal(flat.length, 30);
  assert.equal(flat[flat.length - 1].day, 30);
});

test("buildMonthGrid: leading-null når måneden ikke starter mandag", () => {
  // Juli 2026 starter onsdag → 2 leading-null (man, tir).
  const weeks = buildMonthGrid(2026, 7);
  assert.equal(weeks[0][0], null);
  assert.equal(weeks[0][1], null);
  assert.equal(weeks[0][2].day, 1);
});

test("isoOf padder korrekt", () => {
  assert.equal(isoOf(2026, 7, 5), "2026-07-05");
  assert.equal(isoOf(2026, 11, 12), "2026-11-12");
});

test("groupEntriesByDate samler entries pr. dato og dropper datoløse", () => {
  const entries = [
    { id: "a", date: "2026-07-12" },
    { id: "b", date: "2026-07-12" },
    { id: "c", date: "2026-07-13" },
    { id: "d", date: null },
  ];
  const map = groupEntriesByDate(entries);
  assert.equal(map.get("2026-07-12").length, 2);
  assert.equal(map.get("2026-07-13").length, 1);
  assert.equal(map.has("2026-07-12") && map.size, 2);
});

test("monthsWithRaces returnerer distinkte måneder sorteret", () => {
  const entries = [
    { date: "2026-07-12" },
    { date: "2026-06-28" },
    { date: "2026-07-30" },
    { date: null },
  ];
  const months = monthsWithRaces(entries);
  assert.deepEqual(months, [
    { year: 2026, month: 6 },
    { year: 2026, month: 7 },
  ]);
});

test("stepMonth ruller år ved grænser", () => {
  assert.deepEqual(stepMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(stepMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(stepMonth({ year: 2026, month: 6 }, 1), { year: 2026, month: 7 });
});

test("filterEntries: måned + division + mineOnly", () => {
  const entries = [
    { id: "a", date: "2026-07-12", division: 3, isMine: true },
    { id: "b", date: "2026-07-13", division: 1, isMine: false },
    { id: "c", date: "2026-06-28", division: 3, isMine: true },
  ];
  // Kun juli.
  assert.deepEqual(filterEntries(entries, { year: 2026, month: 7 }).map((e) => e.id), ["a", "b"]);
  // Juli + division 3.
  assert.deepEqual(filterEntries(entries, { year: 2026, month: 7, division: 3 }).map((e) => e.id), ["a"]);
  // Juli + mineOnly.
  assert.deepEqual(filterEntries(entries, { year: 2026, month: 7, mineOnly: true }).map((e) => e.id), ["a"]);
});
