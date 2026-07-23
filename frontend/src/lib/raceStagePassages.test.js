import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPassagesForStage, passageResultsForWaypoint } from "./raceStagePassages.js";

test("grupperer passage-rækker pr. waypoint i km-orden, finish sidst", () => {
  const rows = [
    { stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 85, rider_id: "a", rider_name: "A", passage_rank: 1, points: 20, bonus_seconds: 3 },
    { stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col A", waypoint_km: 60, climb_category: "2", rider_id: "b", rider_name: "B", passage_rank: 1, points: 5, bonus_seconds: 0 },
    { stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "X", waypoint_km: 50, rider_id: "c", rider_name: "C", passage_rank: 1, points: 2, bonus_seconds: 0 },
  ];
  const groups = groupPassagesForStage(rows, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].waypoint_name, "Col A"); // km 60 før km 85
  assert.equal(groups[0].results[0].rider_name, "B");
});

test("resultater inden for en gruppe sorteres på passage_rank", () => {
  const rows = [
    { stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col A", waypoint_km: 60, climb_category: "2", rider_id: "b", rider_name: "B", passage_rank: 2, points: 3, bonus_seconds: 0 },
    { stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col A", waypoint_km: 60, climb_category: "2", rider_id: "a", rider_name: "A", passage_rank: 1, points: 5, bonus_seconds: 0 },
  ];
  const groups = groupPassagesForStage(rows, 1);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].results.map((r) => r.rider_name), ["A", "B"]);
});

test("finish-waypoints springes over (etaperesultat-tabellen dækker allerede målet)", () => {
  const rows = [
    { stage_number: 1, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Intermediate Sprint", waypoint_km: 85, rider_id: "a", rider_name: "A", passage_rank: 1, points: 20, bonus_seconds: 3 },
    { stage_number: 1, waypoint_kind: "finish", waypoint_index: 0, waypoint_name: "Finish", waypoint_km: 170, rider_id: "a", rider_name: "A", passage_rank: 1, points: 20, bonus_seconds: 10 },
  ];
  const groups = groupPassagesForStage(rows, 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].waypoint_kind, "sprint");
});

test("anden etape end den valgte filtreres fra; tom liste → tom liste", () => {
  const rows = [
    { stage_number: 3, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "X", waypoint_km: 50, rider_id: "c", rider_name: "C", passage_rank: 1, points: 2, bonus_seconds: 0 },
  ];
  assert.deepEqual(groupPassagesForStage(rows, 1), []);
  assert.deepEqual(groupPassagesForStage([], 1), []);
  assert.deepEqual(groupPassagesForStage(undefined, 1), []);
});

// ── Sub-4 (#2448): passageResultsForWaypoint — waypoint-klik → passage-opslag ──
const WAYPOINT_ROWS = [
  { stage_number: 4, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 2, rider_id: "b", rider_name: "B", points: 15, bonus_seconds: 0 },
  { stage_number: 4, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 1, rider_id: "a", rider_name: "A", points: 20, bonus_seconds: 0 },
  { stage_number: 4, waypoint_kind: "sprint", waypoint_index: 0, passage_rank: 1, rider_id: "c", rider_name: "C", points: 20, bonus_seconds: 3 },
  { stage_number: 5, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 1, rider_id: "d", rider_name: "D", points: 20, bonus_seconds: 0 },
];

test("passageResultsForWaypoint: filtrerer paa etape+waypoint og sorterer paa passage_rank", () => {
  const r = passageResultsForWaypoint(WAYPOINT_ROWS, 4, "kom", 3);
  assert.deepEqual(r.map((x) => x.rider_name), ["A", "B"]);
});

test("passageResultsForWaypoint: forskellige waypoint_kind/waypoint_index blandes ikke", () => {
  const r = passageResultsForWaypoint(WAYPOINT_ROWS, 4, "sprint", 0);
  assert.deepEqual(r.map((x) => x.rider_name), ["C"]);
});

test("passageResultsForWaypoint: anden etape filtreres fra", () => {
  const r = passageResultsForWaypoint(WAYPOINT_ROWS, 5, "kom", 3);
  assert.deepEqual(r.map((x) => x.rider_name), ["D"]);
});

test("passageResultsForWaypoint: ukendt waypoint-index → tom liste, aldrig et kast", () => {
  assert.deepEqual(passageResultsForWaypoint(WAYPOINT_ROWS, 4, "kom", 9), []);
});

test("passageResultsForWaypoint: tom/manglende input → tom liste", () => {
  assert.deepEqual(passageResultsForWaypoint([], 4, "kom", 3), []);
  assert.deepEqual(passageResultsForWaypoint(null, 4, "kom", 3), []);
  assert.deepEqual(passageResultsForWaypoint(undefined, 4, "kom", 3), []);
});
