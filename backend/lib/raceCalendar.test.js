// Unit-tests for raceCalendar.js — ren read-model uden I/O.
// Kører med: node --test backend/lib/raceCalendar.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalendarModel,
  buildGameDayDateMap,
  toCopenhagenISODate,
  splitISODate,
  calendarTerrainBucket,
  dominantCalendarBucket,
  tierToDivision,
  buildDivisionTree,
} from "./raceCalendar.js";

// ── toCopenhagenISODate / game_day → dato ────────────────────────────────────

test("toCopenhagenISODate projicerer UTC til Europe/Copenhagen-kalenderdag (sommertid)", () => {
  // 2026-06-28T06:00:00Z = CEST (UTC+2) → samme dato.
  assert.equal(toCopenhagenISODate(Date.parse("2026-06-28T06:00:00Z")), "2026-06-28");
  // 2026-06-27T23:30:00Z = 2026-06-28 01:30 CEST → ruller til NÆSTE dag i CET.
  assert.equal(toCopenhagenISODate(Date.parse("2026-06-27T23:30:00Z")), "2026-06-28");
});

test("buildGameDayDateMap mapper game_day til tidligste CET-dato", () => {
  const rows = [
    { race_id: "a", stage_number: 1, scheduled_at: "2026-06-28T08:00:00Z", game_day: 0 },
    { race_id: "a", stage_number: 2, scheduled_at: "2026-06-28T06:00:00Z", game_day: 0 },
    { race_id: "b", stage_number: 1, scheduled_at: "2026-06-29T06:00:00Z", game_day: 1 },
  ];
  const map = buildGameDayDateMap(rows);
  assert.equal(map.get(0), "2026-06-28");
  assert.equal(map.get(1), "2026-06-29");
});

test("buildGameDayDateMap ignorerer rækker uden game_day eller ugyldig timestamp", () => {
  const rows = [
    { race_id: "a", scheduled_at: "2026-06-28T06:00:00Z", game_day: null },
    { race_id: "b", scheduled_at: "not-a-date", game_day: 5 },
    { race_id: "c", scheduled_at: "2026-06-30T06:00:00Z", game_day: 2 },
  ];
  const map = buildGameDayDateMap(rows);
  assert.equal(map.size, 1);
  assert.equal(map.get(2), "2026-06-30");
});

test("splitISODate parser uden TZ-skred", () => {
  assert.deepEqual(splitISODate("2026-07-12"), { year: 2026, month: 7, day: 12 });
  assert.equal(splitISODate("garbage"), null);
  assert.equal(splitISODate(null), null);
});

// ── terræn-buckets ───────────────────────────────────────────────────────────

test("calendarTerrainBucket folder 9 profile_types til 6 viste buckets", () => {
  assert.equal(calendarTerrainBucket("flat"), "sprint");
  assert.equal(calendarTerrainBucket("rolling"), "sprint");
  // Brosten har egen bucket/glyf (#2605 — var tidligere umulig at skelne fra sprint).
  assert.equal(calendarTerrainBucket("cobbles"), "cobbles");
  assert.equal(calendarTerrainBucket("hilly"), "hilly");
  assert.equal(calendarTerrainBucket("classic"), "hilly");
  assert.equal(calendarTerrainBucket("mountain"), "mountain");
  assert.equal(calendarTerrainBucket("high_mountain"), "mountain");
  assert.equal(calendarTerrainBucket("itt"), "itt");
  // ttt = holdstart har egen bucket/glyf (skelnes fra enkeltstart, #1953).
  assert.equal(calendarTerrainBucket("ttt"), "ttt");
  assert.equal(calendarTerrainBucket("unknown"), "sprint"); // fallback
});

test("dominantCalendarBucket vælger hyppigste bucket med stabil tiebreak", () => {
  assert.equal(dominantCalendarBucket(["flat", "flat", "mountain"]), "sprint");
  assert.equal(dominantCalendarBucket(["mountain", "high_mountain", "flat"]), "mountain");
  // Tie sprint(1) vs mountain(1) → bucket-rækkefølge sprint vinder.
  assert.equal(dominantCalendarBucket(["flat", "mountain"]), "sprint");
  // Enkeltstart og holdstart er nu distinkte buckets (#1953).
  assert.equal(dominantCalendarBucket(["itt"]), "itt");
  assert.equal(dominantCalendarBucket(["ttt"]), "ttt");
  // Brosten er nu en distinkt bucket (#2605): flertal af brosten-etaper dominerer,
  // og tie cobbles(1) vs hilly(1) → bucket-rækkefølge cobbles vinder (før sprint/hilly).
  assert.equal(dominantCalendarBucket(["cobbles", "cobbles", "hilly"]), "cobbles");
  assert.equal(dominantCalendarBucket(["cobbles", "hilly"]), "cobbles");
  assert.equal(dominantCalendarBucket([]), null);
  assert.equal(dominantCalendarBucket(null), null);
});

// ── division-træ ─────────────────────────────────────────────────────────────

test("tierToDivision returnerer tier som divisionsnummer", () => {
  assert.equal(tierToDivision(1), 1);
  assert.equal(tierToDivision(4), 4);
  assert.equal(tierToDivision(null), null);
});

test("buildDivisionTree grupperer puljer pr. tier, sorteret", () => {
  const divisions = [
    { id: 3, tier: 2, pool_index: 1, label: "Division 2 — B" },
    { id: 1, tier: 1, pool_index: 0, label: "Division 1" },
    { id: 2, tier: 2, pool_index: 0, label: "Division 2 — A" },
  ];
  const tree = buildDivisionTree(divisions);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].division, 1);
  assert.equal(tree[1].division, 2);
  assert.deepEqual(tree[1].pools.map((p) => p.label), ["Division 2 — A", "Division 2 — B"]);
});

// ── buildCalendarModel (integration af de rene transforms) ───────────────────

const DIVISIONS = [
  { id: 1, tier: 1, pool_index: 0, label: "Division 1" },
  { id: 4, tier: 3, pool_index: 0, label: "Division 3 — A" },
  { id: 5, tier: 3, pool_index: 1, label: "Division 3 — B" },
];

function sampleInput(overrides = {}) {
  return {
    races: [
      { id: "r-single", name: "Grand Prix de Namur", race_type: "single", race_class: "ProSeries", stages: 1, status: "scheduled", league_division_id: 4, game_day_start: 0 },
      { id: "r-stage", name: "Tour des Hauts Plateaux", race_type: "stage_race", race_class: "WorldTour", stages: 8, status: "scheduled", league_division_id: 5, game_day_start: 2 },
    ],
    scheduleRows: [
      { race_id: "r-single", stage_number: 1, scheduled_at: "2026-06-28T06:00:00Z", game_day: 0 },
      { race_id: "r-stage", stage_number: 1, scheduled_at: "2026-06-30T06:00:00Z", game_day: 2 },
      { race_id: "r-stage", stage_number: 5, scheduled_at: "2026-07-01T06:00:00Z", game_day: 3 },
    ],
    profileRows: [
      { race_id: "r-single", stage_number: 1, profile_type: "flat" },
      { race_id: "r-stage", stage_number: 1, profile_type: "mountain" },
      { race_id: "r-stage", stage_number: 2, profile_type: "high_mountain" },
      { race_id: "r-stage", stage_number: 3, profile_type: "flat" },
    ],
    divisions: DIVISIONS,
    teamDivisionId: 4,
    teamEntryRaceIds: new Set(["r-single"]),
    teamLeaderRaceIds: new Set(["r-single"]),
    ...overrides,
  };
}

test("buildCalendarModel placerer løb på game_day-startdato og beriger entry", () => {
  const { entries } = buildCalendarModel(sampleInput());
  assert.equal(entries.length, 2);

  const single = entries.find((e) => e.id === "r-single");
  assert.equal(single.date, "2026-06-28");
  assert.equal(single.gameDayStart, 0);
  assert.equal(single.gameDayEnd, 0);
  assert.equal(single.stages, 1);
  assert.equal(single.division, 3, "tier 3 → Division 3");
  assert.equal(single.poolLabel, "Division 3 — A");
  assert.equal(single.terrain, "sprint");
  assert.equal(single.isMine, true, "team pool 4 == race pool 4");
  assert.equal(single.leaderSet, true);
  assert.equal(single.entered, true);
});

test("buildCalendarModel udleder dominerende terræn + start/slut-dag for etapeløb", () => {
  const { entries } = buildCalendarModel(sampleInput());
  const stage = entries.find((e) => e.id === "r-stage");
  assert.equal(stage.gameDayStart, 2);
  assert.equal(stage.gameDayEnd, 3);
  assert.equal(stage.date, "2026-06-30");
  assert.equal(stage.stages, 8);
  // mountain(1) + high_mountain(1)=mountain(2) vs flat(1)=sprint → mountain dominerer.
  assert.equal(stage.terrain, "mountain");
  assert.equal(stage.isMine, false, "team pool 4 != race pool 5");
  assert.equal(stage.leaderSet, false);
});

test("buildCalendarModel: stageSchedule giver per-etape dato+tid+terræn fra scheduled_at", () => {
  const { entries } = buildCalendarModel(sampleInput());
  const stage = entries.find((e) => e.id === "r-stage");
  assert.equal(stage.stageSchedule.length, 2, "to scheduled etaper");
  assert.deepEqual(stage.stageSchedule[0], { stage: 1, date: "2026-06-30", time: "08:00", terrain: "mountain" });
  assert.deepEqual(stage.stageSchedule[1], { stage: 5, date: "2026-07-01", time: "08:00", terrain: null });
  const single = entries.find((e) => e.id === "r-single");
  assert.deepEqual(single.stageSchedule, [{ stage: 1, date: "2026-06-28", time: "08:00", terrain: "sprint" }]);
});

test("buildCalendarModel: isMine=false når holdet ingen pulje har", () => {
  const { entries } = buildCalendarModel(sampleInput({ teamDivisionId: null }));
  assert.ok(entries.every((e) => e.isMine === false));
});

test("buildCalendarModel springer løb uden schedule OG uden game_day_start over", () => {
  const input = sampleInput();
  input.races.push({ id: "r-ghost", name: "Phantom", race_type: "single", stages: 1, status: "scheduled", league_division_id: 4, game_day_start: null });
  const { entries } = buildCalendarModel(input);
  assert.ok(!entries.some((e) => e.id === "r-ghost"), "ghost-løb uden dag skal udelades");
});

test("buildCalendarModel falder tilbage til game_day_start når schedule mangler", () => {
  const input = sampleInput();
  input.races.push({ id: "r-noSched", name: "No Schedule Yet", race_type: "single", stages: 1, status: "scheduled", league_division_id: 4, game_day_start: 1 });
  const { entries } = buildCalendarModel(input);
  const e = entries.find((x) => x.id === "r-noSched");
  assert.ok(e, "skal medtages via game_day_start");
  assert.equal(e.gameDayStart, 1);
  assert.equal(e.date, null, "ingen schedule → ingen CET-dato (frontend håndterer)");
});

test("buildCalendarModel sorterer entries efter dag, division, pulje, navn", () => {
  const { entries } = buildCalendarModel(sampleInput());
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].gameDayStart <= entries[i].gameDayStart, "stigende game_day");
  }
});

test("buildCalendarModel returnerer division-træ + dag-liste", () => {
  const { divisions, days } = buildCalendarModel(sampleInput());
  assert.equal(divisions.length, 2, "tier 1 + tier 3");
  assert.deepEqual(days.map((d) => d.gameDay), [0, 2, 3]);
});
