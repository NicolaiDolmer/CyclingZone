import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

for (const officialRevision of ["official_times_v1", "official_times_v2"]) test(`${officialRevision}: official revision travels through the adapter, saved runner rows and resumed classifications`, () => {
  const revision = officialRevision;
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

test("old revisions retain frozen complete outputs across route profiles after the new model is added", () => {
  const baseline = JSON.parse(readFileSync(new URL("./engine/v4/test-data/groupClockLegacy6199.json", import.meta.url), "utf8"));
  const actual = createRaceEngineV4Adapter({ ...modules, core: { simulateStageV4 } });
  for (const [rulesRevision, profiles] of Object.entries(baseline.hashes)) {
    for (const [profile_type, expected] of Object.entries(profiles)) {
      const result = actual.simulateStage({ entrants, stageProfile: { ...stages[0], profile_type }, seedString: `official-parity-${profile_type}`, stageNumber: 1, rulesRevision });
      assert.equal(createHash("sha256").update(JSON.stringify(result.v4Output)).digest("hex"), expected, `${rulesRevision}/${profile_type}`);
    }
  }
});

for (const officialRevision of ["official_times_v1", "official_times_v2"]) test(`${officialRevision}: new time-model revision remains deterministic and stores its own raw physical arrival gaps`, () => {
  const revision = officialRevision;
  for (const profile_type of ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "itt"]) {
    const actual = createRaceEngineV4Adapter({ ...modules, core: { simulateStageV4 } });
    const run = () => actual.simulateStage({ entrants, stageProfile: { ...stages[0], profile_type }, seedString: `official-parity-${profile_type}`, stageNumber: 1, rulesRevision: revision });
    const official = run();
    assert.deepEqual(official.v4Output, run().v4Output, profile_type);
    assert.equal(new Set(official.v4Output.results.map(row => row.rider_id)).size, entrants.length);
    const finishers = official.v4Output.results.filter(row => row.status !== "abandoned" && row.status !== "otl");
    assert.equal(official.ranked.length, finishers.length);
    const winner = finishers[0]?.time_seconds;
    official.ranked.forEach((row, index) => {
      assert.equal(row.rider_id, finishers[index].rider_id);
      assert.equal(row.stageGap, Math.max(0, Math.round(finishers[index].time_seconds - winner)));
    });
    for (const snapshot of official.v4Output.groupSnapshots) {
      assert.ok(snapshot.groups.every(group => Number.isFinite(group.gap_seconds) && group.gap_seconds >= 0));
    }
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
