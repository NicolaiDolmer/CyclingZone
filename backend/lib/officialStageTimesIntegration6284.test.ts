import test from "node:test";
import assert from "node:assert/strict";
import { createRaceEngineV4Adapter } from "./raceEngineV4Bridge.js";
import { buildRaceResults, buildStageRowsAccumulated, bindRaceRulesRevision } from "./raceRunner.js";
import * as entrantsAdapter from "./engine/v4/adapters/entrantAdapter.ts";
import * as routeAdapter from "./engine/v4/adapters/routeAdapter.ts";
import * as ordersAdapter from "./engine/v4/orders/teamOrdersAdapter.ts";
import { simulateStageV4 } from "./engine/v4/index.ts";
import { RACE_V4_TUNING } from "./engine/v4/tuning.ts";
import { ABILITY_KEYS } from "./raceSimulator.js";

const revision = "official_times_v1";
const entrants = ["a", "b", "c", "out", "dnf"].map((rider_id) => ({
  rider_id, team_id: "A", race_role: "free_role", fatigue: 0,
  abilities: Object.fromEntries(ABILITY_KEYS.map((key) => [key, 50])),
}));
const stages = [1, 2].map((stage_number) => ({ stage_number, profile_type: "mountain", distance_km: 100, climbs: [], sprints: [] }));
const race = { id: "synthetic-official-time", race_type: "stage_race", race_class: "ProSeries", stages: 2 };
const output = {
  results: [
    { rider_id: "a", rank: 1, time_seconds: 12000, status: "finished" },
    { rider_id: "b", rank: 2, time_seconds: 14223.4, status: "finished" },
    { rider_id: "c", rank: 3, time_seconds: 14223.4, status: "finished" },
    { rider_id: "out", rank: 4, time_seconds: 16000, status: "otl" },
    { rider_id: "dnf", rank: 5, time_seconds: 0, status: "abandoned" },
  ],
  passages: [{ kind: "finish", index: 0, km: 100, results: [] }],
  passage_totals: [{ rider_id: "a", bonus_seconds: 7, sprint_points: 3, kom_points: 2 }],
};
const modules = { entrants: entrantsAdapter, route: routeAdapter, orders: ordersAdapter, tuning: { RACE_V4_TUNING } };
const adapter = createRaceEngineV4Adapter({ ...modules, core: { simulateStageV4: () => output } });
const args = { race, stages, entrants, pointsLookup: { stage__1: 9, stage__2: 4 }, v3: true, v4Engine: adapter };

test("official revision travels through the adapter, saved runner rows and resumed classifications", () => {
  const full = buildRaceResults({ ...args, rulesRevision: revision });
  const first = buildStageRowsAccumulated({ ...args, stagesSorted: stages, stageIndex: 0, rulesRevision: revision });
  const priorStageRows = JSON.parse(JSON.stringify(first.resultRows.filter((row) => row.result_type === "stage")));
  const resumed = buildStageRowsAccumulated({ ...args, stagesSorted: stages, stageIndex: 1, priorStageRows, rulesRevision: revision });
  const rowsOf = (rows, type, stage) => rows.filter((row) => row.result_type === type && row.stage_number === stage);
  assert.deepEqual(priorStageRows.map((row) => [row.rider_id, row.finish_time]), [["a", "+0:00"], ["b", "+37:03"], ["c", "+37:03"]]);
  assert.deepEqual(rowsOf(resumed.resultRows, "gc", 2), rowsOf(full.resultRows, "gc", 2));
  assert.deepEqual(rowsOf(resumed.resultRows, "gc", 2).map((row) => [row.rider_id, row.finish_time]), [["a", "+0:00"], ["b", "+74:20"], ["c", "+74:20"]]);
  assert.equal(priorStageRows[0].bonus_seconds, 7);
  assert.equal(priorStageRows[0].sprint_points, 3);
  assert.equal(priorStageRows[0].kom_points, 2);
  const legacy = buildRaceResults({ ...args, rulesRevision: "orders_gc_v2" });
  for (const row of full.resultRows.filter((row) => row.result_type === "stage")) {
    const old = legacy.resultRows.find((other) => other.result_type === "stage" && other.stage_number === row.stage_number && other.rider_id === row.rider_id);
    assert.deepEqual({ ...row, finish_time: old.finish_time }, old, "only the official time field changes");
  }
  assert.deepEqual(full.incidents, legacy.incidents);
});

test("real engine official revision has exactly v2 mechanics across route profiles", () => {
  for (const profile_type of ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "itt"]) {
    const stageProfile = { ...stages[0], profile_type };
    const actual = createRaceEngineV4Adapter({ ...modules, core: { simulateStageV4 } });
    const run = (rulesRevision) => actual.simulateStage({ entrants, stageProfile, seedString: `official-parity-${profile_type}`, stageNumber: 1, rulesRevision });
    const v2 = run("orders_gc_v2");
    const official = run(revision);
    assert.deepEqual(official.v4Output, v2.v4Output, profile_type);
    assert.deepEqual(official.incidents, v2.incidents, profile_type);
    assert.deepEqual(official.passages, v2.passages, profile_type);
  }
});

test("scheduled races pin at first start; ongoing, completed and retried races keep their pin", async () => {
  const dbFor = (row) => {
    const writes = [];
    const db = { writes, from() {
      let patch;
      const filters = [];
      const query = {
        select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        update(value) { patch = value; return query; },
        maybeSingle() { return Promise.resolve({ data: { ...row }, error: null }); },
        then(resolve) {
          if (patch && filters.every(([key, value]) => key === "id" || row[key] === value)) {
            Object.assign(row, patch); writes.push(patch);
          }
          resolve({ error: null });
        },
      };
      return query;
    } };
    return db;
  };
  const row = { engine_rules_revision: null, stages_completed: 0 };
  const db = dbFor(row);
  const bind = (supabase, firstStageClaim, currentRevision) => bindRaceRulesRevision({ supabase, race: { id: "synthetic" }, firstStageClaim, currentRevision });
  assert.equal(await bind(db, false, revision), "legacy");
  assert.equal(db.writes.length, 0);
  assert.equal(await bind(db, true, revision), revision);
  assert.equal(await bind(db, true, "orders_gc_v2"), revision);
  assert.equal(db.writes.length, 1);
  for (const stages_completed of [1, 2]) {
    for (const stored of [null, "legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3"]) {
      const running = dbFor({ engine_rules_revision: stored, stages_completed });
      assert.equal(await bind(running, true, revision), stored ?? "legacy");
      assert.equal(running.writes.length, 0);
    }
  }
});
