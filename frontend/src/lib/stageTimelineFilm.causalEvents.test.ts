import test from "node:test";
import assert from "node:assert/strict";
import { describeEvent, buildFilmTimeline } from "./stageTimelineFilm.js";
import { selectStoryEvents } from "./stageTimelineStory.js";
const names = new Map([["a", "Rider A"], ["b", "Rider B"]]);

test("#5954 real group merges are described instead of disappearing from the film", () => {
  const event = { km: 80, type: "group_merged", params: { group_id: "escape", into_group_id: "peloton-0", rider_ids: ["a", "b"] } };
  assert.deepEqual(describeEvent(event, { riderNameById: names }), { key: "group_merged", params: { riders: "Rider A, Rider B", count: 2 } });
  assert.ok(selectStoryEvents([event]).includes(event));
});

test("#5954 the recorded group descent attack names its actual riders", () => {
  const event = { km: 75.9, type: "finale_attack", params: { direction: "descent", rider_ids: ["a", "b"] } };
  assert.deepEqual(describeEvent(event, { riderNameById: names }), { key: "descent_attack", params: { riders: "Rider A, Rider B", count: 2 } });
});

test("#5954 a stage decision cannot invent an offensive attack or occupy a story slot", () => {
  const event = { km: 100, type: "finale_attack", params: { kind: "stage_decided", rider_id: "a", win_type: "close_win" } };
  assert.equal(describeEvent(event, { riderNameById: names }), null);
  assert.deepEqual(selectStoryEvents([event]), []);
  assert.deepEqual(buildFilmTimeline({ events: [event] }).feedEvents, []);
});

test("#5954 sparse absolute gaps do not invent a pursuit curve", () => {
  const events = [
    { km: 0, type: "stage_start", params: { field_count: 3 } },
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 20, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 120 } },
    { km: 20, type: "gap_update", params: { group_id: "tail", gap_seconds: 900 } },
    { km: 50, type: "breakaway_caught", params: { group_id: "late", rider_ids: ["b"] } },
    { km: 60, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 60 } },
    { km: 90, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["a"] } },
  ];
  const film = buildFilmTimeline({ events });
  assert.equal(film.catchKm, 90);
  assert.deepEqual(film.gapCurve, []);
});

test("#5954 a later-attack-only timeline cannot invent a morning-break gap curve", () => {
  const film = buildFilmTimeline({ events: [{ km: 0, type: "stage_start", params: {} }, { km: 75, type: "gap_update", params: { group_id: "late", gap_seconds: 200 } }] });
  assert.deepEqual(film.gapCurve, []);
});

test("a distant tail cannot be plotted as the actual pursuer", () => {
  const events = [
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 30, type: "gap_update", params: { group_id: "escape", gap_seconds: 0 } },
    { km: 30, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 900 } },
    { km: 30, type: "gap_update", params: { group_id: "split", gap_seconds: 60 } },
    { km: 40, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["a"] } },
  ];
  assert.deepEqual(buildFilmTimeline({ events }).gapCurve, []);
});

test("sparse native gap updates cannot carry a stale lead through a changed front or merge", () => {
  const formed = { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } };
  const ahead = { km: 20, type: "gap_update", params: { group_id: "field", gap_seconds: 60 } };
  const lostLead = { km: 30, type: "gap_update", params: { group_id: "escape", gap_seconds: 20 } };
  const merge = { km: 30, type: "group_merged", params: { group_id: "field", into_group_id: "escape", rider_ids: ["b"] } };
  assert.deepEqual(buildFilmTimeline({ events: [formed, ahead, lostLead] }).gapCurve, []);
  assert.deepEqual(buildFilmTimeline({ events: [formed, ahead, merge] }).gapCurve, []);
});


test("native curve requires explicit distance to its actual pursuer", () => {
  const events = [
    { km: 12, type: "breakaway_formed", params: { group_id: "escape", rider_ids: ["a"] } },
    { km: 30, type: "gap_update", params: { group_id: "escape", gap_seconds: 0, chase_group_id: "near", separation_seconds: 60 } },
    { km: 30, type: "gap_update", params: { group_id: "tail", gap_seconds: 900 } },
    { km: 40, type: "breakaway_caught", params: { group_id: "escape", rider_ids: ["a"] } },
  ];
  assert.deepEqual(buildFilmTimeline({ events }).gapCurve, [{ km: 30, gapSeconds: 60 }, { km: 40, gapSeconds: 0 }]);
});

// #6803: S5's nye udbrud efter en tidlig indhentning (#6369) har eget gruppe-id.
type Ev = { km: number; type: string; params?: Record<string, unknown> };
const twoBreaks = (extra: Ev[] = [], { caughtSecond = true } = {}): Ev[] => [
  { km: 0, type: "stage_start", params: { distance_km: 180 } },
  { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a", "b"] } },
  { km: 14, type: "gap_update", params: { group_id: "breakaway-0", gap_seconds: 0, chase_group_id: "peloton-0", separation_seconds: 50 } },
  { km: 18, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a", "b"], chase_group_id: "peloton-0" } },
  { km: 23, type: "breakaway_formed", params: { group_id: "breakaway-1500", rider_ids: ["c", "d"], reformation: true } },
  { km: 30, type: "gap_update", params: { group_id: "breakaway-1500", gap_seconds: 0, chase_group_id: "peloton-0", separation_seconds: 80 } },
  { km: 50, type: "gap_update", params: { group_id: "breakaway-1500", gap_seconds: 0, chase_group_id: "peloton-0", separation_seconds: 35 } },
  ...(caughtSecond ? [{ km: 74, type: "breakaway_caught", params: { group_id: "breakaway-1500", rider_ids: ["c", "d"], chase_group_id: "peloton-0" } }] : []),
  ...extra,
  { km: 180, type: "finish", params: {} },
];

test("#6803 the gap curve follows the new break after an early catch, with zero in between", () => {
  const film = buildFilmTimeline({ events: twoBreaks() });
  assert.equal(film.catchKm, 18);
  assert.deepEqual(film.gapCurve, [
    { km: 14, gapSeconds: 50 }, { km: 18, gapSeconds: 0 },
    { km: 23, gapSeconds: 0 }, { km: 30, gapSeconds: 80 }, { km: 50, gapSeconds: 35 }, { km: 74, gapSeconds: 0 },
  ]);
});

test("#6803 a new break that holds on ends its curve without an invented catch", () => {
  const film = buildFilmTimeline({ events: twoBreaks([], { caughtSecond: false }) });
  assert.deepEqual(film.gapCurve.at(-1), { km: 50, gapSeconds: 35 });
});

test("#6803 the first break's group id reused by the field after the catch does not leak into the curve", () => {
  const reused = { km: 40, type: "gap_update", params: { group_id: "breakaway-0", gap_seconds: 25, chase_group_id: "x", separation_seconds: 25 } };
  assert.equal(buildFilmTimeline({ events: twoBreaks([reused]) }).gapCurve.some((p) => p.km === 40), false);
});

test("#6803 a new break without explicit pursuit data invents no curve", () => {
  const events = twoBreaks().filter((e) => !(e.type === "gap_update" && e.params?.group_id === "breakaway-1500"));
  assert.deepEqual(buildFilmTimeline({ events }).gapCurve, [{ km: 14, gapSeconds: 50 }, { km: 18, gapSeconds: 0 }]);
});

test("#6803 a stage with one break is unchanged by the reformation lookup", () => {
  const events = twoBreaks().filter((e) => !(e.km >= 23 && e.km <= 74));
  assert.deepEqual(buildFilmTimeline({ events }).gapCurve, [{ km: 14, gapSeconds: 50 }, { km: 18, gapSeconds: 0 }]);
});

test("#6803 a later-only curve starts at zero where the new break forms", () => {
  const events = twoBreaks().filter((e) => !(e.type === "gap_update" && e.params?.group_id === "breakaway-0"));
  assert.deepEqual(buildFilmTimeline({ events }).gapCurve, [
    { km: 23, gapSeconds: 0 }, { km: 30, gapSeconds: 80 }, { km: 50, gapSeconds: 35 }, { km: 74, gapSeconds: 0 },
  ]);
});
