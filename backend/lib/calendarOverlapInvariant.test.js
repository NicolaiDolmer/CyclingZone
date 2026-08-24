import test from "node:test";
import assert from "node:assert/strict";
import { checkCalendarOverlapInvariants } from "./calendarOverlapInvariant.js";
import { TIER_OVERLAP_CAP, TIER_DENSITY, minGameDaysPerRealDay } from "./calendarTierCaps.js";
import { packLaneCalendar } from "./raceCalendarLanePacker.js";

// Rækker som de ligger i race_stage_schedule.
const row = (race_id, stage_number, game_day, scheduled_at = null) =>
  ({ race_id, stage_number, game_day, scheduled_at });

test("caps: de ejer-låste værdier er uændrede (2026-06-28)", () => {
  assert.deepEqual({ ...TIER_OVERLAP_CAP }, { 1: 3, 2: 3, 3: 2, 4: 2 });
  assert.deepEqual({ ...TIER_DENSITY }, { 1: 5, 2: 4, 3: 3, 4: 2 });
  assert.deepEqual([1, 2, 3, 4].map(minGameDaysPerRealDay), [2, 2, 2, 1]);
});

test("ren kalender inden for cap giver ingen brud", () => {
  const rows = [
    row("a", 1, 0), row("b", 1, 0), row("c", 1, 0),   // 3 løb på game_day 0 = præcis cap for tier 1
    row("a", 2, 1), row("b", 2, 1),
  ];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.overlapViolationCount, 0);
  assert.equal(r.stageRepeatViolationCount, 0);
  assert.equal(r.maxOverlap, 3);
  assert.equal(r.overlapCap, 3);
});

test("fjerde samtidige løb på én game_day bryder tier 1-cap'en", () => {
  const rows = [row("a", 1, 0), row("b", 1, 0), row("c", 1, 0), row("d", 1, 0)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.overlapViolationCount, 1);
  assert.equal(r.overlapViolations[0].game_day, 0);
  assert.equal(r.overlapViolations[0].races, 4);
  assert.equal(r.overlapViolations[0].cap, 3);
});

test("tier 3 har cap 2 — tre samtidige løb er et brud dér", () => {
  const rows = [row("a", 1, 4), row("b", 1, 4), row("c", 1, 4)];
  assert.equal(checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 3 }).overlapViolationCount, 1);
  assert.equal(checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 }).overlapViolationCount, 0);
});

test("to etaper af SAMME løb på samme game_day er et brud (pakker-kontrakt: 1 etape = 1 game-dag)", () => {
  const rows = [row("gt", 1, 5), row("gt", 2, 5), row("gt", 3, 5), row("gt", 4, 6)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.stageRepeatViolationCount, 1);
  assert.deepEqual(r.stageRepeatViolations[0], {
    race_id: "gt", game_day: 5, stages: 3, stage_numbers: [1, 2, 3],
  });
});

test("fladet akse opdages: én game_day pr. kalenderdag i en division hvor K = 2", () => {
  const rows = [
    row("a", 1, 0, "2026-08-25T09:00:00Z"), row("b", 1, 0, "2026-08-25T11:00:00Z"),
    row("a", 2, 1, "2026-08-26T09:00:00Z"), row("b", 2, 1, "2026-08-26T11:00:00Z"),
  ];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.gameDayCount, 2);
  assert.equal(r.realDayCount, 2);
  assert.equal(r.minGameDaysPerCalendarDay, 2);
  assert.equal(r.axisLooksCollapsed, true, "2 game_days på 2 kalenderdage i tier 1 er en fladet akse");
});

test("Div 4 har K = 1 — dér ER én game_day pr. kalenderdag korrekt", () => {
  const rows = [
    row("a", 1, 0, "2026-08-25T10:00:00Z"), row("b", 1, 0, "2026-08-25T16:00:00Z"),
    row("a", 2, 1, "2026-08-26T10:00:00Z"),
  ];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 4 });
  assert.equal(r.minGameDaysPerCalendarDay, 1);
  assert.equal(r.axisLooksCollapsed, false);
  assert.equal(r.overlapViolationCount, 0);
});

test("rækker uden game_day ignoreres (gammelt CET-ordinal-nøglerum, raceBinding.js)", () => {
  const rows = [row("a", 1, null), row("b", 1, undefined), row("c", 1, 0)];
  const r = checkCalendarOverlapInvariants({ scheduleRows: rows, tier: 1 });
  assert.equal(r.maxOverlap, 1);
  assert.equal(r.overlapViolationCount, 0);
});

// Den vigtige: pakkerens EGET output skal bestå invarianten. Hvis pakkeren og vagten
// nogensinde driver fra hinanden, fejler denne test — ikke prod.
test("pakkerens eget Div 1-output består invarianten (cap 3, 1 etape pr. løb pr. game-dag)", () => {
  const stageRaces = [
    { id: "gt-1", stages: 21, race_class: "TourFrance" },
    { id: "gt-2", stages: 21, race_class: "GiroVuelta" },
    { id: "gt-3", stages: 21, race_class: "GiroVuelta" },
    { id: "wt-1", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-2", stages: 8, race_class: "OtherWorldTourA" },
    { id: "wt-3", stages: 7, race_class: "OtherWorldTourA" },
    { id: "wt-4", stages: 6, race_class: "OtherWorldTourA" },
  ];
  const oneDayRaces = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mon-${i}`, race_class: "Monuments" })),
    ...Array.from({ length: 43 }, (_, i) => ({ id: `od-${i}`, race_class: "OtherWorldTourA" })),
  ];
  const packed = packLaneCalendar({
    stageRaces, oneDayRaces,
    density: TIER_DENSITY[1], days: 28, overlapCap: TIER_OVERLAP_CAP[1],
  });
  const scheduleRows = packed.placements.flatMap((p) =>
    p.stagesPlaced.map((st) => ({ race_id: p.id, stage_number: st.stage_number, game_day: st.game_day })));

  const r = checkCalendarOverlapInvariants({ scheduleRows, tier: 1 });
  assert.equal(r.overlapViolationCount, 0, `pakkeren brød cap'en: ${JSON.stringify(r.overlapViolations.slice(0, 3))}`);
  assert.equal(r.stageRepeatViolationCount, 0, `pakkeren lagde 2 etaper af samme løb på én game-dag: ${JSON.stringify(r.stageRepeatViolations.slice(0, 3))}`);
  assert.ok(r.gameDayCount > 28, `pakkeren skal bruge FLERE game_days (${r.gameDayCount}) end kalenderdage (28) — ellers er aksen fladet`);
});

// ── #4075: monumentet skal have sin in-game-dag for sig selv ──────────────────────

test("monument der deler in-game-dag med et andet loeb er et brud (#4075)", () => {
  const rows = [
    row("mon", 1, 5), row("gt", 12, 5),   // monument + GT-etape paa samme loebsdag
    row("gt", 13, 6),
  ];
  const r = checkCalendarOverlapInvariants({
    scheduleRows: rows, tier: 1, monumentRaceIds: new Set(["mon"]),
  });
  assert.equal(r.monumentSharedDayViolationCount, 1);
  assert.equal(r.monumentSharedDayViolations[0].game_day, 5);
  assert.deepEqual(r.monumentSharedDayViolations[0].other_race_ids, ["gt"]);
  // Cap'en er IKKE brudt — 2 loeb < cap 3. Det er praecis derfor reglen kraever sin egen taelling.
  assert.equal(r.overlapViolationCount, 0);
});

test("monument alene paa sin loebsdag er intet brud, og to monumenter samme dag ER (#4075)", () => {
  const rent = checkCalendarOverlapInvariants({
    scheduleRows: [row("mon", 1, 5), row("gt", 12, 4), row("gt", 13, 6)],
    tier: 1, monumentRaceIds: new Set(["mon"]),
  });
  assert.equal(rent.monumentSharedDayViolationCount, 0);

  const to = checkCalendarOverlapInvariants({
    scheduleRows: [row("mon-a", 1, 5), row("mon-b", 1, 5)],
    tier: 1, monumentRaceIds: new Set(["mon-a", "mon-b"]),
  });
  assert.equal(to.monumentSharedDayViolationCount, 1, "to monumenter paa samme loebsdag er ogsaa et brud");
});

test("uden monumentRaceIds taelles nul brud (bagudkompatibelt)", () => {
  const r = checkCalendarOverlapInvariants({
    scheduleRows: [row("mon", 1, 5), row("gt", 12, 5)], tier: 1,
  });
  assert.equal(r.monumentSharedDayViolationCount, 0);
});
