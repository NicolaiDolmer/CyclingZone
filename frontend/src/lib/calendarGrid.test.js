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
  expandStageEvents,
  filterStageEvents,
  mergePoolTwins,
  expectedPoolId,
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

// #2756 — pulje/gruppe-vælgeren ("Division 2 A") kræver at filterStageEvents kan
// snævre en tier ind til én konkret pulje, oven på det eksisterende division-filter.
test("expandStageEvents bærer poolId videre fra entryen", () => {
  const entries = [
    { id: "r1", name: "Race A", raceType: "single", division: 2, poolId: 3, poolLabel: "Division 2 — B", date: "2026-07-05", terrain: "sprint" },
  ];
  const [ev] = expandStageEvents(entries);
  assert.equal(ev.poolId, 3);
});

test("#6683 expandStageEvents bærer etapens egen profileType videre (null for ældre svar)", () => {
  const entries = [
    { id: "r1", name: "Race A", raceType: "stage_race", division: 2, date: "2026-07-05", terrain: "mountain",
      stageSchedule: [{ stage: 1, date: "2026-07-05", time: "14:00", terrain: "mountain", profileType: "high_mountain" }, { stage: 2, date: "2026-07-06", time: "14:00", terrain: "sprint" }] },
    { id: "r2", name: "Race B", raceType: "single", division: 2, date: "2026-07-07", terrain: "hilly" },
  ];
  const evs = expandStageEvents(entries);
  assert.equal(evs[0].profileType, "high_mountain");
  assert.equal(evs[1].profileType, null);
  assert.equal(evs[2].profileType, null);
});

test("expandStageEvents falder tilbage til poolId=null når entryen ikke har en pulje", () => {
  const entries = [{ id: "r1", name: "Race A", raceType: "single", division: 2, date: "2026-07-05", terrain: "sprint" }];
  const [ev] = expandStageEvents(entries);
  assert.equal(ev.poolId, null);
});

test("filterStageEvents: poolId snævrer en tier ind til én konkret gruppe", () => {
  const events = [
    { raceId: "a", name: "A", stage: 1, date: "2026-07-05", division: 2, poolId: 2 },
    { raceId: "b", name: "B", stage: 1, date: "2026-07-06", division: 2, poolId: 3 },
    { raceId: "c", name: "C", stage: 1, date: "2026-07-07", division: 1, poolId: 1 },
  ];
  // division 2, ingen pulje-filter → begge Division 2-puljer.
  assert.deepEqual(
    filterStageEvents(events, { year: 2026, month: 7, division: 2 }).map((e) => e.raceId),
    ["a", "b"],
  );
  // division 2 + pulje 3 → kun gruppe B.
  assert.deepEqual(
    filterStageEvents(events, { year: 2026, month: 7, division: 2, poolId: 3 }).map((e) => e.raceId),
    ["b"],
  );
});

// ── #5841: puljernes ens løb står én gang pr. division ─────────────────────────

const POOL_TREE = [
  { division: 1, pools: [{ id: 1, label: "D1", poolIndex: 0 }] },
  { division: 3, pools: [{ id: 30, label: "D3 A", poolIndex: 0 }, { id: 31, label: "D3 B", poolIndex: 1 }, { id: 32, label: "D3 C", poolIndex: 2 }] },
];
const twin = (id, poolId, poolLabel, extra = {}) => ({
  id, name: "Ronde X", raceType: "stage_race", stages: 2, division: 3, poolId, poolLabel, isMine: false,
  stageSchedule: [
    { stage: 1, date: "2026-12-01", time: "12:00", profileType: "flat" },
    { stage: 2, date: "2026-12-02", time: "12:00", profileType: "hilly" },
  ],
  ...extra,
});

test("mergePoolTwins: samme løb i tre puljer bliver ét, puljen med lavest nummer vinder", () => {
  const out = mergePoolTwins([twin("c", 32, "D3 C"), twin("a", 30, "D3 A"), twin("b", 31, "D3 B")], { divisions: POOL_TREE });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a");
  assert.equal(out[0].poolLabel, null, "én puljes navn ville paastaa at loebet kun koeres der");
});

test("mergePoolTwins: holdets egen pulje vinder og beholder sit navn og sin markering", () => {
  const out = mergePoolTwins(
    [twin("a", 30, "D3 A"), twin("b", 31, "D3 B", { isMine: true, entered: true })],
    { divisions: POOL_TREE, preferPoolId: 31 },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "b");
  assert.equal(out[0].isMine, true);
  assert.equal(out[0].entered, true);
  assert.equal(out[0].poolLabel, "D3 B");
});

test("mergePoolTwins: en afvigende rute, dato eller division holder løbene adskilt", () => {
  const otherRoute = twin("b", 31, "D3 B", {
    stageSchedule: [
      { stage: 1, date: "2026-12-01", profileType: "flat" },
      { stage: 2, date: "2026-12-02", profileType: "mountain" },
    ],
  });
  const otherDate = twin("c", 32, "D3 C", {
    stageSchedule: [
      { stage: 1, date: "2026-12-03", profileType: "flat" },
      { stage: 2, date: "2026-12-04", profileType: "hilly" },
    ],
  });
  const otherDivision = twin("d", 1, "D1", { division: 1 });
  const out = mergePoolTwins([twin("a", 30, "D3 A"), otherRoute, otherDate, otherDivision], { divisions: POOL_TREE });
  assert.deepEqual(out.map((e) => e.id), ["a", "b", "c", "d"]);
  assert.equal(out[0].poolLabel, "D3 A", "et loeb uden tvilling er uaendret");
});

test("mergePoolTwins: klokkeslæt alene adskiller ikke løb, og etapeløbet fylder én chip pr. dag", () => {
  const later = twin("b", 31, "D3 B", {
    stageSchedule: [
      { stage: 1, date: "2026-12-01", time: "15:00", profileType: "flat" },
      { stage: 2, date: "2026-12-02", time: "15:00", profileType: "hilly" },
    ],
  });
  const out = mergePoolTwins([twin("a", 30, "D3 A"), later], { divisions: POOL_TREE });
  assert.equal(out.length, 1);
  const evs = expandStageEvents(out);
  assert.deepEqual(evs.map((e) => `${e.raceId}:${e.stage}`), ["a:1", "a:2"]);
});

test("mergePoolTwins: endagsløb uden etapeplan slås sammen på dato og terræn", () => {
  const one = (id, poolId) => ({ id, name: "GP Y", raceType: "single", stages: 1, division: 3, poolId, date: "2026-12-05", terrain: "sprint" });
  assert.deepEqual(mergePoolTwins([one("b", 31), one("a", 30)], { divisions: POOL_TREE }).map((e) => e.id), ["a"]);
  assert.deepEqual(mergePoolTwins([], {}), []);
  assert.deepEqual(mergePoolTwins(null), []);
});

test("expectedPoolId: første pulje med løb i den forventede division", () => {
  const entries = [{ id: "x", poolId: 31 }, { id: "y", poolId: 32 }];
  assert.equal(expectedPoolId({ divisions: POOL_TREE, entries, expectedDivision: 3 }), 31);
  assert.equal(expectedPoolId({ divisions: POOL_TREE, entries, expectedDivision: 1 }), null, "ingen loeb i D1");
  assert.equal(expectedPoolId({ divisions: POOL_TREE, entries, expectedDivision: null }), null);
  assert.equal(expectedPoolId({ divisions: POOL_TREE, entries, expectedDivision: 4 }), null);
});
