// #6912 B: prognosen gennem den ÆGTE afviklingssti (raceRunner.simulateStageByIndex, dryRun)
// med den rigtige v4-motor og en falsk Supabase. Låser tre ting:
//  1. dryRun skriver intet (ingen insert/upsert/update/delete/rpc).
//  2. Motoren får aldrig løbets rigtige seed, kun prognosens egne.
//  3. Private taktik-ordrer (team_orders) indgår ikke i prognosen.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRaceEngineV4, simulateStageByIndex } from "./raceRunner.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { computeBreakawayOutlook } from "./breakawayOutlook.js";

function abil(seed) {
  const a = {};
  ABILITY_KEYS.forEach((k, i) => { a[k] = 35 + ((seed * 13 + i * 7) % 55); });
  return a;
}

const ENTRANTS = Array.from({ length: 24 }, (_, i) => ({
  rider_id: `r${String(i).padStart(2, "0")}`,
  team_id: ["A", "B", "C"][i % 3],
  abilities: abil(i),
}));

const RACE = { id: "race-outlook-dry", race_type: "single", race_class: "ProSeries", season_id: "s1", name: "Outlook GP", stages: 1, stages_completed: 0, status: "scheduled" };
const STAGE = {
  stage_number: 1, profile_type: "mountain", finale_type: "long_climb",
  demand_vector: DEMAND_VECTORS.mountain, distance_km: 165,
  climbs: [{ name: "Col", crest_km: 158, category: "1", summit_finish: true }],
  sprints: [{ name: "Sprint", km: 70, kind: "intermediate" }],
  race_id: RACE.id, id: "sp-1",
};

function makeSupabase(canned) {
  const writes = [];
  function from(table) {
    const b = {
      select() { return b; }, eq() { return b; }, in() { return b; }, or() { return b; }, is() { return b; }, not() { return b; },
      order() { return b; }, limit() { return b; }, range() { return b; }, gte() { return b; }, lte() { return b; }, lt() { return b; },
      maybeSingle() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: (canned[table] || [])[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ error: null }); },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ error: null }); },
      update(v) { writes.push({ table, op: "update", v }); const u = { eq() { return u; }, in() { return u; }, is() { return u; }, select() { return Promise.resolve({ data: [], error: null }); }, then(r) { return Promise.resolve({ error: null }).then(r); } }; return u; },
      delete() { writes.push({ table, op: "delete" }); const d = { eq() { return d; }, in() { return d; }, then(r) { return Promise.resolve({ error: null }).then(r); } }; return d; },
      then(resolve, reject) { return Promise.resolve({ data: canned[table] || [], error: null }).then(resolve, reject); },
    };
    return b;
  }
  // Laese-RPCer (find_/get_) er ikke skrivninger; alt andet taeller som en.
  return { from, rpc: async (name) => { if (!/^(find|get)_/.test(name)) writes.push({ op: "rpc", name }); return { data: null, error: null }; }, __writes: writes };
}

test("dryRun-prognosen: intet skrives, egne seeds, ingen private ordrer", async () => {
  const supabase = makeSupabase({
    race_stage_profiles: [STAGE],
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "" })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ ...RACE }],
    seasons: [{ id: "s1", number: 5, status: "active", race_days_completed: 3, race_days_total: 60 }],
  });
  const engine = await loadRaceEngineV4();
  const seeds = [];
  const orderRowsSeen = [];
  const spyEngine = {
    ...engine,
    simulateStage: (args) => { seeds.push(args.seedString); orderRowsSeen.push(args.teamOrderRows); return engine.simulateStage(args); },
  };
  const origError = console.error;
  const origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  let out;
  try {
    out = await computeBreakawayOutlook({
      race: { ...RACE },
      seeds: 3,
      resolveRaceEngineV4: (args) => resolveRaceEngineV4({
        ...args,
        checkV4Enabled: async () => true,
        loadEngine: async () => spyEngine,
        loadOrders: async () => [{ team_id: "A", stage_number: 1, orders: { breakaway_stance: "chase" } }],
        checkFormPeaksEnabled: async () => true,
      }),
      runDryStage: ({ stageIndex, resolveV4Engine }) => simulateStageByIndex({
        supabase, race: { ...RACE }, stageIndex, dryRun: true, resolveV4Engine,
        checkV3Enabled: async () => true,
        recomputeRaceDays: async () => 0,
        processBoardWeekend: async () => ({}),
        applyFatigue: async () => ({ updated: 0 }),
      }),
    });
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  assert.deepEqual(supabase.__writes, [], "dryRun må ikke skrive");
  assert.ok(seeds.length >= 3, "motoren kørte prognosens kørsler");
  assert.ok(seeds.every((s) => s.startsWith(`breakaway-outlook:${RACE.id}:1:`)), `kun prognose-seeds: ${seeds.join(",")}`);
  assert.ok(orderRowsSeen.every((rows) => !rows || rows.length === 0), "ingen private ordrer i prognosen");
  assert.equal(out.available, true, JSON.stringify(out));
  assert.equal(out.runs, 3);
});
