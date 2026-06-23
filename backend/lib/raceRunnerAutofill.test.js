// backend/lib/raceRunnerAutofill.test.js
// #1307: per-hold autopick. Mock-builder følger raceFatigue.test.js-mønstret.
import test from "node:test";
import assert from "node:assert/strict";
import { loadEntrantsForRace } from "./raceRunner.js";

const ab = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});

// Minimal thenable query-builder: state = { tabel → rækker }; understøtter de
// kald loadEntrantsForRace/fillMissingTeamEntries laver (select/eq/in/or/gte + insert).
function makeSupabase(state) {
  const calls = [];
  function builder(table) {
    const q = { table, filters: [] };
    const api = {
      select() { return api; },
      eq(col, val) { q.filters.push(["eq", col, val]); return api; },
      in(col, vals) { q.filters.push(["in", col, vals]); return api; },
      or() { return api; },
      gte(col, val) { q.filters.push(["gte", col, val]); return api; },
      order() { return api; },
      insert(rows) { calls.push({ table, insert: rows }); state[table] = [...(state[table] || []), ...rows]; return Promise.resolve({ error: null }); },
      then(resolve) {
        let rows = [...(state[table] || [])];
        for (const [op, col, val] of q.filters) {
          if (op === "eq") rows = rows.filter((r) => r[col] === val);
          if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
          if (op === "gte") rows = rows.filter((r) => r[col] != null && r[col] >= val);
        }
        resolve({ data: rows, error: null });
      },
    };
    return api;
  }
  return { from: (t) => builder(t), __calls: calls };
}

const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } }];
const race = { id: "race1", race_type: "single", season_id: "s1" };

function baseState() {
  const state = {
    teams: [
      { id: "t1", is_test_account: false, is_frozen: false },
      { id: "t2", is_test_account: false, is_frozen: false },
    ],
    riders: [],
    race_entries: [],
    rider_condition: [],
    rider_derived_abilities: [],
  };
  // 10 ryttere pr. hold med abilities.
  for (const t of ["t1", "t2"]) {
    for (let i = 0; i < 10; i++) {
      const id = `${t}-r${i}`;
      state.riders.push({ id, team_id: t, firstname: "A", lastname: id, is_u25: false, is_retired: false });
      state.rider_derived_abilities.push({ rider_id: id, ...ab(80 - i * 3) });
    }
  }
  return state;
}

test("hold uden entries autopickes (max 8, kaptajn sat, is_auto_filled=true)", async () => {
  const state = baseState();
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.length, 16, "2 hold × 8 autopicked");
  const inserted = supabase.__calls.filter((c) => c.table === "race_entries").flatMap((c) => c.insert);
  assert.ok(inserted.every((r) => r.is_auto_filled === true));
  for (const t of ["t1", "t2"]) {
    assert.equal(inserted.filter((r) => r.team_id === t && r.race_role === "captain").length, 1);
  }
});

test("hold MED manager-entries røres ikke; kun det manglende hold fyldes", async () => {
  const state = baseState();
  state.race_entries = [
    { race_id: "race1", rider_id: "t1-r9", team_id: "t1", race_role: "captain", is_auto_filled: false },
    ...[0, 1, 2, 3, 4].map((i) => ({ race_id: "race1", rider_id: `t1-r${i}`, team_id: "t1", race_role: "helper", is_auto_filled: false })),
  ];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  const t1 = entrants.filter((e) => e.team_id === "t1");
  assert.equal(t1.length, 6, "managerens 6 beholdes uændret");
  assert.equal(t1.find((e) => e.rider_id === "t1-r9").race_role, "captain", "race_role læses med ind i entrants");
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 8, "t2 autopickes");
});

test("skadede ryttere udelades af autopick; persist=false skriver intet", async () => {
  const state = baseState();
  state.rider_condition = [{ rider_id: "t1-r0", injured_until: "2099-01-01" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: false });
  assert.ok(!entrants.some((e) => e.rider_id === "t1-r0"), "skadet topscorer udeladt");
  assert.equal(supabase.__calls.filter((c) => c.table === "race_entries").length, 0, "dry-run: ingen insert");
});

test("afmeldt hold autofyldes IKKE", async () => {
  const state = baseState();
  state.race_withdrawals = [{ race_id: "race1", team_id: "t2" }];
  const supabase = makeSupabase(state);
  const entrants = await loadEntrantsForRace({ supabase, race, stages, persist: true });
  assert.equal(entrants.filter((e) => e.team_id === "t2").length, 0, "t2 er afmeldt → ingen entries");
  assert.ok(entrants.filter((e) => e.team_id === "t1").length > 0, "t1 fyldes stadig");
});
