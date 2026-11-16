// #8153: en rytter, hvis frigivelse er bestilt midt i et etapeloeb, maa ikke auto-udtages
// til et senere loeb (Fable-dom 15/11, fund 2). Fast ur (AGENTS regel 16).
import test from "node:test";
import assert from "node:assert/strict";
import { loadLeavingRiderIds8153, withoutLeavingRiders8153 } from "./riderRelease8153.js";
import { runRaceEntryGenerator } from "./raceEntryGenerator.js";

const NOW = Date.parse("2026-11-15T10:00:00.000Z");

// Lille generisk tabel-klient: select/eq/neq/in/is/gt/gte/lte/order/range/limit + insert/upsert/delete.
function fakeSupabase(state, { failTable = null } = {}) {
  const calls = [];
  const match = (row, [op, col, val]) => {
    const v = row[col];
    switch (op) {
      case "eq": return v === val;
      case "neq": return v !== val;
      case "in": return val.includes(v);
      case "is": return val === null ? v == null : v === val;
      case "gt": return v > val;
      case "gte": return v >= val;
      case "lte": return v <= val;
      case "lt": return v < val;
      default: return true;
    }
  };
  return {
    calls,
    // Ingen RPC'er: generatoren falder tilbage til almindelige skrivninger (som i raceEntryGenerator.test.js).
    rpc: async (name) => ({ data: null, error: { message: `function ${name} does not exist` } }),
    from(table) {
      calls.push(table);
      const q = { filters: [], range: null, head: false };
      const rows = () => (state[table] || []).filter((r) => q.filters.every((f) => match(r, f)));
      const api = {
        select(_cols, opts) { if (opts?.head) q.head = true; return api; },
        eq(c, v) { q.filters.push(["eq", c, v]); return api; },
        neq(c, v) { q.filters.push(["neq", c, v]); return api; },
        in(c, v) { q.filters.push(["in", c, v]); return api; },
        is(c, v) { q.filters.push(["is", c, v]); return api; },
        gt(c, v) { q.filters.push(["gt", c, v]); return api; },
        gte(c, v) { q.filters.push(["gte", c, v]); return api; },
        lte(c, v) { q.filters.push(["lte", c, v]); return api; },
        lt(c, v) { q.filters.push(["lt", c, v]); return api; },
        not() { return api; },
        or() { return api; },
        order() { return api; },
        limit() { return api; },
        range(from, to) { q.range = [from, to]; return api; },
        maybeSingle() { return api.then((r) => ({ ...r, data: r.data?.[0] ?? null })); },
        single() { return api.then((r) => ({ ...r, data: r.data?.[0] ?? null })); },
        insert(newRows) { state[table] = [...(state[table] || []), ...[].concat(newRows)]; return Promise.resolve({ data: null, error: null }); },
        upsert(newRows) { return api.insert(newRows); },
        delete() { q.del = true; return api; },
        update() { return api; },
        then(resolve, reject) {
          if (failTable === table) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
          let out = rows();
          if (q.del) { state[table] = (state[table] || []).filter((r) => !out.includes(r)); out = []; }
          if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
          return Promise.resolve({ data: out, error: null, count: out.length }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

const flagOn = { key: "release_defer_8153", value: "on" };
const pending = (riderId, status = "pending") => ({ id: `pr-${riderId}`, rider_id: riderId, team_id: "t1", race_id: "S", status });

test("8153: slukket kontakt = tomt saet uden opslag i pending_rider_releases (uaendret mod main)", async () => {
  const state = { app_config: [{ key: "release_defer_8153", value: "off" }], pending_rider_releases: [pending("r1")] };
  const supabase = fakeSupabase(state);
  const ids = await loadLeavingRiderIds8153(supabase);
  assert.equal(ids.size, 0);
  assert.ok(!supabase.calls.includes("pending_rider_releases"), "tabellen laeses ikke, naar kontakten er slukket");
});

test("8153: taendt kontakt = kun aktive bestillinger (udfoerte taeller ikke)", async () => {
  const state = { app_config: [flagOn], pending_rider_releases: [pending("r1"), pending("r2", "executed")] };
  assert.deepEqual([...(await loadLeavingRiderIds8153(fakeSupabase(state)))], ["r1"]);
});

test("8153: en laesefejl giver tomt saet (fail-open, logget), aldrig en kastet fejl", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (msg) => errors.push(String(msg)));
  const state = { app_config: [flagOn], pending_rider_releases: [pending("r1")] };
  const ids = await loadLeavingRiderIds8153(fakeSupabase(state, { failTable: "pending_rider_releases" }));
  assert.equal(ids.size, 0);
  assert.ok(errors.some((m) => m.includes("[pendingRelease8153]")));
});

test("8153: withoutLeavingRiders8153 fjerner kun de afgaaende og taaler null", () => {
  assert.deepEqual(withoutLeavingRiders8153([{ id: "a" }, { id: "b" }], new Set(["b"])), [{ id: "a" }]);
  assert.deepEqual(withoutLeavingRiders8153(null, new Set(["b"])), []);
  const rows = [{ id: "a" }];
  assert.equal(withoutLeavingRiders8153(rows, new Set()), rows, "tomt saet = samme liste");
  assert.deepEqual(withoutLeavingRiders8153([{ rider_id: "x" }], new Set(["x"]), (r) => r.rider_id), []);
});

// ── Genskabelse af fejlen i auto-vejen (fund 2) ──────────────────────────────

const ab = (v) => ({
  flat: v, mountain: v, hill: v, time_trial: v, sprint: v, cobblestone: v,
  endurance: v, acceleration: v, descending: v, recovery: v, prologue: v,
  aggression: v, tactics: v, positioning: v, resistance: v,
});
const flatProfile = (n) => ({ stage_number: n, profile_type: "flat", finale_type: null, demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } });

function laterRaceState({ flag = "on" } = {}) {
  const state = {
    app_config: [{ key: "release_defer_8153", value: flag }],
    races: [{ id: "L", name: "Later Race", season_id: "s1", race_class: "Class2", league_division_id: 4, stages_completed: 0 }],
    race_stage_schedule: [{ race_id: "L", stage_number: 1, scheduled_at: "2026-11-20T12:00:00Z", game_day: 40 }],
    race_stage_profiles: [{ race_id: "L", ...flatProfile(1) }],
    teams: [{ id: "t1", is_test_account: false, is_frozen: false, league_division_id: 4 }],
    riders: [], rider_derived_abilities: [], rider_condition: [],
    race_entries: [], race_withdrawals: [], race_entry_clears: [],
    team_race_strategy: [], team_rider_role_rules: [], race_day_participation: [],
    // Den bedste rytter (t1-r0) har en bestilt frigivelse i et igangvaerende etapeloeb.
    pending_rider_releases: [pending("t1-r0")],
  };
  for (let i = 0; i < 9; i++) {
    const id = `t1-r${i}`;
    state.riders.push({ id, team_id: "t1", is_retired: false, is_academy: false, squad: "senior", pending_team_id: null });
    state.rider_derived_abilities.push({ rider_id: id, ...ab(90 - i * 3) });
    state.rider_condition.push({ rider_id: id, fatigue: 0, injured_until: null });
  }
  return state;
}

test("8153: generatoren auto-udtager ALDRIG en rytter med bestilt frigivelse til et senere loeb", async () => {
  const state = laterRaceState({ flag: "on" });
  await runRaceEntryGenerator({ supabase: fakeSupabase(state), seasonId: "s1", dryRun: false, now: NOW, notify: async () => ({ delivered: true }) });
  const picked = state.race_entries.filter((e) => e.race_id === "L").map((e) => e.rider_id);
  assert.ok(picked.length > 0, "de oevrige ryttere udtages stadig");
  assert.ok(!picked.includes("t1-r0"), "den afgaaende rytter er ikke kandidat");
});

test("8153: slukket kontakt = generatoren som i dag (den staerkeste rytter udtages)", async () => {
  const state = laterRaceState({ flag: "off" });
  await runRaceEntryGenerator({ supabase: fakeSupabase(state), seasonId: "s1", dryRun: false, now: NOW, notify: async () => ({ delivered: true }) });
  const picked = state.race_entries.filter((e) => e.race_id === "L").map((e) => e.rider_id);
  assert.ok(picked.includes("t1-r0"), "uden kontakten er der ingen bestillinger at tage hensyn til");
});
