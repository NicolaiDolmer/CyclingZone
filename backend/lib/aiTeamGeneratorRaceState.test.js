import test from "node:test";
import assert from "node:assert/strict";

import { teamInflightRaceIds, getStalledInflightRaceIds } from "./aiTeamGenerator.js";

// Minimal chainable mock: hver .from(table) giver forud-konfigurerede rækker for den
// tabel. Filter-metoderne er no-ops (funktionernes ikke-trivielle logik ligger i JS
// EFTER query'en), men kæden skal kunne await'es direkte OG via fetchAllRows' .range().
function raceStateMock(data) {
  function from(table) {
    const result = { data: data[table] || [], error: null };
    const b = {
      select() { return b; },
      eq() { return b; },
      in() { return b; },
      neq() { return b; },
      gt() { return b; },
      lte() { return b; },
      order() { return b; },
      // fetchAllRows: kun første side (from===0) har data, resten tom → loop stopper.
      range(fromIdx) { return Promise.resolve(fromIdx === 0 ? result : { data: [], error: null }); },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return b;
  }
  return { from };
}

test("#2434 teamInflightRaceIds: returnerer DISTINKTE blokerende race_ids", async () => {
  const sb = raceStateMock({
    riders: [{ id: "r1" }, { id: "r2" }],
    race_entries: [{ race_id: "x" }, { race_id: "x" }, { race_id: "y" }],
  });
  const ids = await teamInflightRaceIds(sb, "team-1", ["x", "y", "z"]);
  assert.deepEqual([...ids].sort(), ["x", "y"], "dubletter foldes, kun blokerende løb");
});

test("#2434 teamInflightRaceIds: tom inflight-liste → [] uden query", async () => {
  const sb = raceStateMock({ riders: [{ id: "r1" }] });
  assert.deepEqual(await teamInflightRaceIds(sb, "team-1", []), []);
});

test("#2434 teamInflightRaceIds: hold uden ryttere → []", async () => {
  const sb = raceStateMock({ riders: [], race_entries: [{ race_id: "x" }] });
  assert.deepEqual(await teamInflightRaceIds(sb, "team-1", ["x"]), []);
});

test("#2434 getStalledInflightRaceIds: næste etape forfalden → løbet er stallet", async () => {
  const sb = raceStateMock({
    races: [{ id: "r-stalled", stages_completed: 1 }],
    // stage 2 = næste uafviklede etape (stages_completed+1) og forfalden (i query-cutoff)
    race_stage_schedule: [{ race_id: "r-stalled", stage_number: 2, scheduled_at: "2026-07-10T00:00:00Z" }],
  });
  const ids = await getStalledInflightRaceIds(sb, new Date("2026-07-14T12:00:00Z"));
  assert.deepEqual(ids, ["r-stalled"]);
});

test("#2434 getStalledInflightRaceIds: forfalden række der IKKE er næste etape → ikke stallet", async () => {
  const sb = raceStateMock({
    races: [{ id: "r-ok", stages_completed: 2 }],
    // stage 2 er allerede kørt (næste = 3); en forfalden stage-2-række betyder ikke stall
    race_stage_schedule: [{ race_id: "r-ok", stage_number: 2, scheduled_at: "2026-07-10T00:00:00Z" }],
  });
  const ids = await getStalledInflightRaceIds(sb, new Date("2026-07-14T12:00:00Z"));
  assert.deepEqual(ids, [], "kun DEN forfaldne næste-etape tæller som stall");
});

test("#2434 getStalledInflightRaceIds: ingen inflight-løb → []", async () => {
  const sb = raceStateMock({ races: [] });
  assert.deepEqual(await getStalledInflightRaceIds(sb, new Date("2026-07-14T12:00:00Z")), []);
});

test("#2434 getStalledInflightRaceIds: inflight-løb uden forfaldne rækker → []", async () => {
  const sb = raceStateMock({
    races: [{ id: "r-running", stages_completed: 1 }],
    race_stage_schedule: [], // næste etape er fremtidig → query returnerer 0 forfaldne
  });
  assert.deepEqual(await getStalledInflightRaceIds(sb, new Date("2026-07-14T12:00:00Z")), []);
});
