import test from "node:test";
import assert from "node:assert/strict";
import { ridersWithStageInSpan, loadRidersAlreadyRacedInSpan } from "./raceDayRiddenGuard.js";

// #6009-scenariet: loeb A's sidste etape og loeb B's foerste etape ligger paa samme
// loebsdag (12). Loeb A er afsluttet (bindingen frigivet); rytteren har koert etape 5.
const SCHEDULE = [
  { race_id: "A", stage_number: 4, game_day: 9 },
  { race_id: "A", stage_number: 5, game_day: 12 },
];

test("#6009 ridersWithStageInSpan: a ridden stage on the first day of the span blocks", () => {
  const out = ridersWithStageInSpan({
    span: { start: 12, end: 22 },
    scheduleRows: SCHEDULE,
    resultRows: [
      { rider_id: "r1", race_id: "A", stage_number: 5, result_type: "stage" },
      { rider_id: "r2", race_id: "A", stage_number: 4, result_type: "stage" },
    ],
  });
  assert.deepEqual([...out], ["r1"]);
});

test("#6009 ridersWithStageInSpan: tour GC is never a race day, single-day GC is", () => {
  const span = { start: 12, end: 12 };
  const resultRows = [{ rider_id: "r1", race_id: "A", stage_number: 5, result_type: "gc" }];
  assert.equal(ridersWithStageInSpan({ span, scheduleRows: SCHEDULE, resultRows }).size, 0);
  assert.equal(ridersWithStageInSpan({ span, scheduleRows: SCHEDULE, resultRows, singleRaceIds: new Set(["A"]) }).size, 1);
});

test("#6009 ridersWithStageInSpan: no span or unscheduled stage blocks nothing", () => {
  const resultRows = [{ rider_id: "r1", race_id: "A", stage_number: 5, result_type: "stage" }];
  assert.equal(ridersWithStageInSpan({ span: null, scheduleRows: SCHEDULE, resultRows }).size, 0);
  assert.equal(ridersWithStageInSpan({ span: { start: 12, end: 22 }, scheduleRows: [{ race_id: "A", stage_number: 5, game_day: null }], resultRows }).size, 0);
});

// Minimal query-builder: optager filtre og anvender eq/in/neq/gte/lte paa tabellens raekker.
function mockSupabase(tables, { failTable = null } = {}) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select() { return q; },
        eq(col, v) { filters.push((r) => (col === "races.season_id" ? r.races?.season_id === v : r[col] === v)); return q; },
        in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
        neq(col, v) { filters.push((r) => r[col] !== v); return q; },
        gte(col, v) { filters.push((r) => r[col] >= v); return q; },
        lte(col, v) { filters.push((r) => r[col] <= v); return q; },
        then(resolve) {
          if (table === failTable) return resolve({ data: null, error: new Error("boom") });
          return resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return q;
    },
  };
}

const TABLES = {
  race_stage_schedule: [
    ...SCHEDULE,
    { race_id: "B", stage_number: 1, game_day: 12 },
    { race_id: "B", stage_number: 2, game_day: 14 },
  ],
  race_results: [
    { rider_id: "r1", race_id: "A", stage_number: 5, result_type: "stage", races: { season_id: "s4", race_type: "stage_race" } },
    { rider_id: "r2", race_id: "A", stage_number: 4, result_type: "stage", races: { season_id: "s4", race_type: "stage_race" } },
    { rider_id: "r3", race_id: "OLD", stage_number: 5, result_type: "stage", races: { season_id: "s3", race_type: "stage_race" } },
  ],
};

test("#6009 loadRidersAlreadyRacedInSpan: blocks the rider who already rode race day 12", async () => {
  const { data, error } = await loadRidersAlreadyRacedInSpan({
    supabase: mockSupabase(TABLES), race: { id: "B", season_id: "s4" }, riderIds: ["r1", "r2", "r3"],
  });
  assert.equal(error, null);
  assert.deepEqual([...data], ["r1"]);
});

test("#6009 loadRidersAlreadyRacedInSpan: a query error is returned, not swallowed", async () => {
  const { data, error } = await loadRidersAlreadyRacedInSpan({
    supabase: mockSupabase(TABLES, { failTable: "race_results" }), race: { id: "B", season_id: "s4" }, riderIds: ["r1"],
  });
  assert.equal(data, null);
  assert.ok(error);
});

test("#6009 loadRidersAlreadyRacedInSpan: empty selection does no lookup", async () => {
  const { data, error } = await loadRidersAlreadyRacedInSpan({ supabase: null, race: { id: "B", season_id: "s4" }, riderIds: [] });
  assert.equal(error, null);
  assert.equal(data.size, 0);
});
