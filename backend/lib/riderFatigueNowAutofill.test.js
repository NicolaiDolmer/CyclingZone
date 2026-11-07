// #7801 (review 7/11, P1): assistentens udtagelse regner trætheden ved etapens planlagte start,
// ikke ved det rigtige ur. Fast ur (AGENTS 16): planen ligger på en dato langt fra væguret, og
// et injiceret `today` må ikke flytte, hvilken dato ledgeren læses for.
import test from "node:test";
import assert from "node:assert/strict";

import { fillMissingTeamEntries } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

const STAGE_AT = "2026-03-02T14:00:00Z"; // dansk dato 2026-03-02, langt fra væguret
const STAGE_GAME_DAY = 12;

function makeSupabase(state, log) {
  const apply = (rows, filters) => filters.reduce((acc, [op, col, val]) => acc.filter((r) => {
    if (op === "eq") return r[col] === val;
    if (op === "neq") return r[col] !== val;
    if (op === "in") return val.includes(r[col]);
    if (op === "gte") return r[col] != null && r[col] >= val;
    if (op === "lt") return r[col] != null && r[col] < val;
    if (op === "is") return (r[col] ?? null) === val;
    return true;
  }), rows);
  const rowsFor = (table) => (state[table] ?? []).map((r) => (table === "riders" && r.squad === undefined ? { ...r, squad: "senior" } : r));
  function builder(table) {
    const filters = [];
    const done = () => {
      log.push({ table, filters: filters.map((f) => [...f]) });
      return apply(rowsFor(table), filters);
    };
    const api = {
      select() { return api; },
      eq(col, val) { filters.push(["eq", col, val]); return api; },
      neq(col, val) { filters.push(["neq", col, val]); return api; },
      in(col, vals) { filters.push(["in", col, vals]); return api; },
      gte(col, val) { filters.push(["gte", col, val]); return api; },
      lt(col, val) { filters.push(["lt", col, val]); return api; },
      is(col, val) { filters.push(["is", col, val]); return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: done()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: done()[0] ?? null, error: null }); },
      range(from, to) { return Promise.resolve({ data: done().slice(from, to + 1), error: null }); },
      insert() { return Promise.resolve({ error: null }); },
      then(resolve) { resolve({ data: done(), error: null }); },
    };
    return api;
  }
  return { from: (t) => builder(t), rpc: async () => ({ data: [], error: null }) };
}

function baseState(flag) {
  const state = {
    app_config: [
      { key: "fatigue_now_7801", value: flag },
      { key: "condition_model_v2", value: "on" },
      { key: "training_condition_per_date", value: "on" },
      { key: "training_tick_per_race_day", value: "on" },
    ],
    teams: [{ id: "t1", is_test_account: false, is_frozen: false }],
    riders: [],
    race_entries: [],
    rider_condition: [],
    rider_derived_abilities: [],
    race_stage_schedule: [{ race_id: "race1", stage_number: 1, game_day: STAGE_GAME_DAY, scheduled_at: STAGE_AT }],
    training_race_loads: [],
  };
  for (let i = 0; i < 10; i++) {
    const id = `t1-r${i}`;
    state.riders.push({ id, team_id: "t1", firstname: "A", lastname: id, is_u25: false, is_retired: false, is_academy: false });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    state.rider_condition.push({ rider_id: id, fatigue: 20, injured_until: null });
  }
  return state;
}

const stages = [{ stage_number: 2, profile_type: "flat" }, { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];
const race = { id: "race1", race_type: "stage_race", season_id: "s1" };
const ledgerReads = (log) => log.filter((q) => q.table === "training_race_loads");

test("tændt: ledgeren læses for etapens planlagte dato og kun løbsdagene før etapen", async () => {
  const log = [];
  const supabase = makeSupabase(baseState("on"), log);
  await fillMissingTeamEntries({ supabase, race, stages, existingEntries: [], persist: false, notify: async () => {}, today: "2026-11-07" });
  const reads = ledgerReads(log);
  assert.ok(reads.length > 0, "ledgeren læses med kontakten tændt");
  for (const { filters } of reads) {
    assert.deepEqual(filters.find(([op, col]) => op === "eq" && col === "tick_date"), ["eq", "tick_date", "2026-03-02"], "etapens dato, ikke væguret eller today");
    assert.deepEqual(filters.find(([op, col]) => op === "lt" && col === "game_day"), ["lt", "game_day", STAGE_GAME_DAY]);
  }
  const schedReads = log.filter((q) => q.table === "race_stage_schedule" && q.filters.some(([op, col]) => op === "eq" && col === "stage_number"));
  assert.deepEqual(schedReads.map((q) => q.filters.find(([, col]) => col === "stage_number")[2]), [1], "første etape i listen");
});

test("tændt men etapen er ikke planlagt: åbningen, og ledgeren læses ikke", async () => {
  const log = [];
  const state = baseState("on");
  state.race_stage_schedule = [];
  await fillMissingTeamEntries({ supabase: makeSupabase(state, log), race, stages, existingEntries: [], persist: false, notify: async () => {}, today: "2026-11-07" });
  assert.equal(ledgerReads(log).length, 0);
});

test("slukket: hverken plan-opslag til trætheden eller ledger", async () => {
  const log = [];
  await fillMissingTeamEntries({ supabase: makeSupabase(baseState("off"), log), race, stages, existingEntries: [], persist: false, notify: async () => {}, today: "2026-11-07" });
  assert.equal(ledgerReads(log).length, 0);
  assert.equal(log.filter((q) => q.table === "race_stage_schedule" && q.filters.some(([, col]) => col === "stage_number")).length, 0);
});
