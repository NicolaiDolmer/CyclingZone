// backend/lib/youthSelectionRescue.6124.test.js
// #6124 (+ #5843): overskriver assistenten en selvvalgt U23-/junior-udtagelse?
// Svar pinnet som matrix, for BEGGE ungdomstrupper:
//   - >= MIN_RACE_ENTRIES (6) manuelle picks roeres aldrig (ingen auto-raekker, rollerne staar).
//   - 1-5 picks: sen redning (#4295, ejer 27/8, bevidst) fylder op til 6 som helper,
//     aendrer aldrig managerens kaptajn og tilfoejer kun fra holdets EGEN trup.
//   - ryddet trup (race_entry_clears) fyldes ikke igen.
//   - afmeldt hold (race_withdrawals) fyldes ikke.
//   - "Train only" (#5944) fyldes ikke.
//   - en rytter fra en anden trup (fx U23-rytter i juniorfelt) kommer aldrig ind.
// Mock-builderen foelger raceRunnerYouthSquad.test.js / raceRunnerAutofill.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

function makeSupabase(state) {
  const calls = [];
  function applyFilters(rows, filters) {
    let result = rows;
    for (const [op, col, val] of filters) {
      if (op === "eq") result = result.filter((r) => r[col] === val);
      if (op === "neq") result = result.filter((r) => r[col] !== val);
      if (op === "in") result = result.filter((r) => val.includes(r[col]));
      if (op === "gte") result = result.filter((r) => r[col] != null && r[col] >= val);
      if (op === "is") result = result.filter((r) => (r[col] ?? null) === val);
    }
    return result;
  }
  function rowsFor(table) {
    const rows = [...(state[table] || [])];
    if (table !== "riders") return rows;
    return rows.map((r) => (r.squad === undefined ? { ...r, squad: "senior" } : r));
  }
  function builder(table) {
    const q = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      neq(col, val) { q.filters.push(["neq", col, val]); return api; },
      maybeSingle() {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      single() {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      is(col, val) { q.filters.push(["is", col, val]); return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      limit() { return api; },
      range(from, to) {
        const rows = applyFilters(rowsFor(table), q.filters);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      insert(rowsArg) {
        const rows = Array.isArray(rowsArg) ? rowsArg : [rowsArg];
        calls.push({ table, insert: rows });
        state[table] = [...(state[table] || []), ...rows];
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        const rows = applyFilters(rowsFor(table), q.filters);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), rpc: async () => ({ data: state.spent_days ?? [], error: null }), __calls: calls };
}

const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];

function addRiders(state, teamId, squad, count, { prefix = squad, birthdate = null, strength = 80 } = {}) {
  for (let i = 0; i < count; i++) {
    const id = `${teamId}-${prefix}${i}`;
    state.riders.push({
      id, team_id: teamId, firstname: "A", lastname: id, is_u25: false, is_retired: false,
      is_academy: squad !== "senior", squad, birthdate,
    });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(strength - i) });
  }
}

const SQUADS = [
  { squad: "u23", other: "junior", poolId: 10, otherPool: 20 },
  { squad: "junior", other: "u23", poolId: 20, otherPool: 10 },
];

// t1 er managerens hold (i begge puljer). Seniorer er staerkest: en trup-blind redning ville vaelge dem.
function makeState({ squad, other }) {
  const state = {
    seasons: [{ id: "s1", number: 4 }],
    teams: [
      { id: "t1", is_test_account: false, is_frozen: false, league_division_id: 1, u23_league_division_id: 10, junior_league_division_id: 20 },
    ],
    riders: [], race_entries: [], rider_condition: [], rider_derived_abilities: [],
  };
  addRiders(state, "t1", "senior", 10, { strength: 99 });
  addRiders(state, "t1", squad, 10, { prefix: "own-", birthdate: "2012-03-01", strength: 70 });
  addRiders(state, "t1", other, 10, { prefix: "oth-", birthdate: "2012-03-01", strength: 95 });
  return state;
}

const raceFor = (cfg) => ({ id: "raceY", race_type: "single", season_id: "s1", league_division_id: cfg.poolId, squad: cfg.squad });
const entry = (id, role = "helper") => ({ race_id: "raceY", team_id: "t1", rider_id: id, race_role: role, is_auto_filled: false });
const autoRows = (supabase) => supabase.__calls.filter((c) => c.table === "race_entries").flatMap((c) => c.insert);

for (const cfg of SQUADS) {
  const label = cfg.squad.toUpperCase();

  test(`#6124 ${label}: >= ${MIN_RACE_ENTRIES} manuelle picks roeres aldrig (ingen auto-raekker, roller bevaret)`, async () => {
    const state = makeState(cfg);
    state.race_entries = [entry("t1-own-3", "captain"), ...[0, 1, 2, 4, 5].map((i) => entry(`t1-own-${i}`))];
    const supabase = makeSupabase(state);
    const entrants = await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    assert.equal(autoRows(supabase).length, 0, "assistenten maa ikke skrive noget naar holdet har 6");
    assert.deepEqual(entrants.map((e) => e.rider_id).sort(), ["t1-own-0", "t1-own-1", "t1-own-2", "t1-own-3", "t1-own-4", "t1-own-5"]);
    assert.equal(entrants.find((e) => e.rider_id === "t1-own-3").race_role, "captain");
  });

  test(`#6124 ${label}: 3 picks fyldes til 6 som helper, kaptajn og egne picks uaendret (#4295 by design)`, async () => {
    const state = makeState(cfg);
    state.race_entries = [entry("t1-own-7", "captain"), entry("t1-own-8"), entry("t1-own-9")];
    const supabase = makeSupabase(state);
    const entrants = await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    const added = autoRows(supabase);
    assert.equal(added.length, MIN_RACE_ENTRIES - 3, "praecis op til gulvet, ikke op til fuldt felt");
    assert.ok(added.every((r) => r.race_role === "helper" && r.is_auto_filled === true), "tilfoejede er hjaelpere");
    assert.ok(added.every((r) => !["t1-own-7", "t1-own-8", "t1-own-9"].includes(r.rider_id)), "ingen dublet af managerens picks");
    const riderById = new Map(state.riders.map((r) => [r.id, r]));
    assert.ok(added.every((r) => riderById.get(r.rider_id).squad === cfg.squad), `kun ${cfg.squad}-ryttere tilfoejes`);
    const mine = entrants.filter((e) => e.team_id === "t1");
    assert.equal(mine.length, MIN_RACE_ENTRIES);
    assert.equal(mine.filter((e) => e.race_role === "captain").length, 1, "stadig kun én kaptajn");
    assert.equal(mine.find((e) => e.rider_id === "t1-own-7").race_role, "captain", "managerens kaptajn aendres aldrig");
    for (const id of ["t1-own-8", "t1-own-9"]) assert.ok(mine.some((e) => e.rider_id === id), `${id} bevaret`);
  });

  test(`#6124 ${label}: ryddet trup (race_entry_clears) fyldes ikke igen`, async () => {
    const state = makeState(cfg);
    state.race_entry_clears = [{ race_id: "raceY", team_id: "t1" }];
    const supabase = makeSupabase(state);
    const entrants = await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    assert.equal(entrants.filter((e) => e.team_id === "t1").length, 0);
    assert.equal(autoRows(supabase).length, 0);
  });

  test(`#6124 ${label}: afmeldt hold fyldes ikke`, async () => {
    const state = makeState(cfg);
    state.race_withdrawals = [{ race_id: "raceY", team_id: "t1" }];
    const supabase = makeSupabase(state);
    const entrants = await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    assert.equal(entrants.filter((e) => e.team_id === "t1").length, 0);
    assert.equal(autoRows(supabase).length, 0);
  });

  test(`#6124 ${label}: "Train only" (#5944) fyldes ikke, heller ikke med delvise picks`, async () => {
    const state = makeState(cfg);
    state.team_youth_race_opt_outs = [{ team_id: "t1", squad: cfg.squad }];
    state.race_entries = [entry("t1-own-0", "captain")];
    const supabase = makeSupabase(state);
    await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    assert.equal(autoRows(supabase).length, 0, "Train only = spillerens udtalte fravalg, ingen redning");
  });

  test(`#6124 ${label}: opt-out paa den ANDRE trup blokerer ikke redningen af denne`, async () => {
    const state = makeState(cfg);
    state.team_youth_race_opt_outs = [{ team_id: "t1", squad: cfg.other }];
    state.race_entries = [entry("t1-own-0", "captain")];
    const supabase = makeSupabase(state);
    await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: true });
    assert.equal(autoRows(supabase).length, MIN_RACE_ENTRIES - 1);
  });

  test(`#6124 ${label}: ingen rytter fra ${cfg.other}-truppen eller senior havner i feltet (heller ikke ved fuld autopick)`, async () => {
    const state = makeState(cfg);
    const supabase = makeSupabase(state);
    const entrants = await loadEntrantsForRace({ supabase, race: raceFor(cfg), stages, persist: false });
    assert.ok(entrants.length >= MIN_RACE_ENTRIES);
    const riderById = new Map(state.riders.map((r) => [r.id, r]));
    for (const e of entrants) assert.equal(riderById.get(e.rider_id).squad, cfg.squad, `${e.rider_id} er i forkert trup`);
  });
}
