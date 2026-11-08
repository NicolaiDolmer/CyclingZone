// #7801 (review 7/11, P1): assistentens udtagelse regner trætheden ved etapens planlagte start,
// ikke ved det rigtige ur. Fast ur (AGENTS 16): planen ligger på en dato langt fra væguret, og
// et injiceret `today` må ikke flytte, hvilken dato ledgeren læses for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fillMissingTeamEntries } from "./raceRunner.js";
import { assignTeamAcrossRaces } from "./raceEntryGenerator.js";
import { fatigueByRiderForRaces, openingFatigueMap, riderFatigueNow } from "./riderFatigueNow.js";
import { runScenarios } from "./__fixtures__/fatigueNow7801AutofillOffScenarios.js";

const BASE = JSON.parse(readFileSync(new URL("./__fixtures__/fatigueNow7801AutofillOffBase.json", import.meta.url), "utf8"));

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

// ── De tre ruter i api.js (Race Hubs auto-udfyld, forhåndsvisning, "udtag nu") ──────────────
// Fast ur (AGENTS 16): løbene ligger på to datoer langt fra væguret; opslaget tager intet ur.

const conditions = [{ rider_id: "a", fatigue: 55 }, { rider_id: "b", fatigue: 30 }, { rider_id: "c", fatigue: null }];
const abilityByRider = new Map([["a", { recovery: 60 }], ["b", { recovery: 40 }], ["c", { recovery: 50 }]]);
const load = (rider_id, tick_date, game_day, l) => ({ rider_id, tick_date, game_day, load: l, consumed_at: null, duplicate_of_race_id: null });

function routeState(flag) {
  const state = baseState(flag);
  state.race_stage_schedule = [
    { race_id: "R1", stage_number: 1, game_day: 12, scheduled_at: "2026-03-02T14:00:00Z" },
    { race_id: "R2", stage_number: 1, game_day: 19, scheduled_at: "2026-03-09T14:00:00Z" },
    { race_id: "R3", stage_number: 1, game_day: 12, scheduled_at: "2026-03-02T16:00:00Z" },
    { race_id: "R4", stage_number: 2, game_day: 30, scheduled_at: "2026-03-20T14:00:00Z" },
  ];
  state.training_race_loads = [
    load("a", "2026-03-02", 10, 30), load("a", "2026-03-02", 13, 22), load("a", "2026-03-09", 18, 25),
    load("b", "2026-03-02", 11, 18), load("a", "2026-03-20", 29, 40),
  ];
  return state;
}
const stagesOf = (n) => [{ stage_number: n }, { stage_number: n + 1 }];
const RACES = [{ id: "R1", stages: stagesOf(1) }, { id: "R2", stages: stagesOf(1) }, { id: "R3", stages: stagesOf(1) }, { id: "R4", stages: stagesOf(2) }, { id: "R5", stages: stagesOf(1) }];

test("slukket: de tre ruter er bit-identiske med merge-basen (frossen digest), og kun kontakten læses", async () => {
  // Scenarierne leverer abilities som `abById`; ruterne sender samme map videre som abilityByRider.
  const now = await runScenarios({
    resolve: ({ supabase, conditions: conds, abById, teamId, races }) => fatigueByRiderForRaces({ supabase, conditions: conds, abilityByRider: abById, teamId, races }),
  });
  assert.equal(now.scenarioCount, BASE.scenarioCount);
  assert.equal(now.picksTotal, BASE.picksTotal);
  assert.deepEqual(now.tablesRead, BASE.tablesRead, "slukket læser intet ud over kontakten");
  assert.equal(now.readCount, BASE.readCount, "samme antal kontakt-læsninger som merge-basen");
  assert.equal(now.picks, BASE.picks, "assistentens udtagelse ændret med kontakten slukket");
});

test("scenarierne rammer trætheden: en anden træthed pr. løb giver en anden udtagelse", async () => {
  const shifted = await runScenarios({
    resolve: async ({ conditions: conds, races }) => {
      const fatById = openingFatigueMap(conds);
      const byRace = new Map(races.map((r, i) => [r.id, new Map([...fatById].map(([id, f]) => [id, f == null ? f : Math.min(100, f + 35 * (i + 1))]))]));
      return { fatById, byRace };
    },
  });
  assert.notEqual(shifted.picks, BASE.picks);
});

test("slukket: åbningen og intet pr. løb; kun kontakten læses, også med mange løb", async () => {
  for (const flag of [undefined, "off", "beta"]) {
    const log = [];
    const state = routeState(flag);
    const out = await fatigueByRiderForRaces({ supabase: makeSupabase(state, log), conditions, abilityByRider, teamId: "t1", races: RACES });
    assert.equal(out.byRace, null, `flag=${flag}`);
    assert.deepEqual([...out.fatById], [...openingFatigueMap(conditions)]);
    assert.deepEqual([...new Set(log.map((q) => q.table))], ["app_config"], `flag=${flag}`);
    assert.equal(log.length, 1, "én læsning af kontakten, ikke én pr. løb");
  }
});

test("tændt: hvert løb får trætheden ved SIN første etapes start; løb på samme dato og løbsdag deler udregning", async () => {
  const log = [];
  const out = await fatigueByRiderForRaces({ supabase: makeSupabase(routeState("on"), log), conditions, abilityByRider, teamId: "t1", races: RACES });
  const at = (race, id) => out.byRace.get(race).get(id);
  assert.equal(at("R1", "a"), riderFatigueNow({ openingFatigue: 55, dateLoads: [30], recoveryAbility: 60 }), "kun løbsdage før etapen på etapens dato");
  assert.equal(at("R1", "b"), riderFatigueNow({ openingFatigue: 30, dateLoads: [18], recoveryAbility: 40 }));
  assert.equal(at("R2", "a"), riderFatigueNow({ openingFatigue: 55, dateLoads: [25], recoveryAbility: 60 }), "en senere dato har sine egne etaper");
  assert.equal(at("R2", "b"), 30);
  assert.equal(out.byRace.get("R3"), out.byRace.get("R1"), "samme dato og løbsdag = samme udregning");
  assert.equal(at("R4", "a"), riderFatigueNow({ openingFatigue: 55, dateLoads: [40], recoveryAbility: 60 }), "løbets første etape er den laveste i listen");
  assert.equal(at("R5", "a"), 55, "uplanlagt løb = åbningen, som i motoren");
  assert.equal(at("R1", "c"), null, "rytter uden træthed røres ikke");
  const ledgerDates = log.filter((q) => q.table === "training_race_loads").map((q) => q.filters.find(([, col]) => col === "tick_date")[2]);
  assert.deepEqual([...new Set(ledgerDates)].sort(), ["2026-03-02", "2026-03-09", "2026-03-20"]);
  assert.equal(ledgerDates.filter((d) => d === "2026-03-02").length, 1, "datoen læses én gang for R1 og R3");
});

test("tændt: en læsefejl giver åbningen for løbet frem for en væltet udtagelse", async () => {
  const supabase = makeSupabase(routeState("on"), []);
  const real = supabase.from;
  supabase.from = (table) => { if (table === "training_race_loads") throw new Error("db nede"); return real(table); };
  const out = await fatigueByRiderForRaces({ supabase, conditions, abilityByRider, teamId: "t1", races: RACES.slice(0, 2) });
  assert.deepEqual([...out.byRace.get("R1")], [...openingFatigueMap(conditions)]);
  assert.deepEqual([...out.byRace.get("R2")], [...openingFatigueMap(conditions)]);
});

test("assignTeamAcrossRaces: løbets egen træthed afgør udtagelsen; uden den er rytterne uændrede", () => {
  const stage = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
  const riders = Array.from({ length: 12 }, (_, i) => ({ rider_id: `x${i}`, abilities: ab(80 - i), fatigue: 0 }));
  const race = (extra = {}) => ({ race_id: "A", window: { start: 1, end: 2 }, stages: [stage], sizeRule: { min: 6, max: 6 }, ...extra });
  const plain = assignTeamAcrossRaces({ riders, races: [race()] });
  assert.deepEqual(assignTeamAcrossRaces({ riders, races: [race({ fatigueByRider: undefined })] }), plain);
  const tired = new Map(riders.slice(0, 6).map((r) => [r.rider_id, 100]));
  const withTired = assignTeamAcrossRaces({ riders, races: [race({ fatigueByRider: tired })] });
  assert.notDeepEqual(withTired, plain, "de seks stærkeste er trætte ved start og tabes mod friske");
  assert.equal(riders[0].fatigue, 0, "kalderens ryttere ændres ikke");
});

// Vagt: alle kaldesteder i api.js bruger samme funktion. Tre auto-udtagelsesruter regner pr. løb
// ved etapestart; kun træningssiden (visning "lige nu") bruger fatigueByRiderNow med uret.
test("api.js: de tre auto-udtagelsesruter bruger fatigueByRiderForRaces, ikke uret", () => {
  const src = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  assert.equal(src.match(/fatigueByRiderForRaces\(/g)?.length, 3);
  assert.equal(src.match(/await fatigueByRiderNow\(/g)?.length, 1, "kun træningssidens visning bruger uret");
});
