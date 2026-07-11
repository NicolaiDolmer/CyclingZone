// backend/lib/raceEntriesLoader.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { loadEligibleEntries } from "./raceEntriesLoader.js";
import { clearFutureRaceEntries } from "./raceEntryCleanup.js";

// Minimal PostgREST-builder-mock: kæder eq/in/neq/select/delete/range og er thenable.
function mockSupabase({ riders = [], raceEntriesSelect = [], onDelete = null }) {
  return {
    from(table) {
      const state = { table, filters: [], op: "select" };
      const inVals = (col) => {
        const f = state.filters.find((x) => x[0] === "in" && x[1] === col);
        return f ? f[2] : null;
      };
      function resolve() {
        if (table === "riders") {
          const ids = inVals("id") || [];
          return { data: riders.filter((r) => ids.includes(r.id)), error: null };
        }
        if (table === "race_entries") {
          if (state.op === "delete") { if (onDelete) onDelete(state); return { error: null }; }
          return { data: raceEntriesSelect, error: null };
        }
        return { data: [], error: null };
      }
      const q = {
        select(c) { state.columns = c; return q; },
        delete() { state.op = "delete"; return q; },
        eq(col, val) { state.filters.push(["eq", col, val]); return q; },
        in(col, vals) { state.filters.push(["in", col, vals]); return q; },
        neq(col, val) { state.filters.push(["neq", col, val]); return q; },
        range() { return q; },
        then(onF, onR) { return Promise.resolve(resolve()).then(onF, onR); },
      };
      return q;
    },
  };
}

test("loadEligibleEntries: frasorterer akademi/solgt/slettet, beholder gyldige", async () => {
  const entries = [
    { rider_id: "ok", team_id: "t1" },
    { rider_id: "academy", team_id: "t1" },
    { rider_id: "sold", team_id: "t1" },
    { rider_id: "deleted", team_id: "t1" },
  ];
  const riders = [
    { id: "ok", team_id: "t1", is_academy: false, is_retired: false },
    { id: "academy", team_id: "t1", is_academy: true, is_retired: false },
    { id: "sold", team_id: "t2", is_academy: false, is_retired: false },
  ];
  const { data, error } = await loadEligibleEntries({
    supabase: mockSupabase({ riders }),
    baseQuery: () => Promise.resolve({ data: entries, error: null }),
  });
  assert.equal(error, null);
  assert.deepEqual(data.map((e) => e.rider_id), ["ok"]);
});

test("loadEligibleEntries: tom baseQuery → tom liste", async () => {
  const { data, error } = await loadEligibleEntries({
    supabase: mockSupabase({}),
    baseQuery: () => Promise.resolve({ data: [], error: null }),
  });
  assert.equal(error, null);
  assert.deepEqual(data, []);
});

test("loadEligibleEntries: baseQuery-fejl propageres", async () => {
  const { data, error } = await loadEligibleEntries({
    supabase: mockSupabase({}),
    baseQuery: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  });
  assert.equal(data, null);
  assert.equal(error.message, "boom");
});

test("loadEligibleEntries: paged=true henter via range", async () => {
  const pagedEntries = [{ rider_id: "ok", team_id: "t1" }];
  const baseQuery = () => ({
    range: (from) => Promise.resolve({ data: from === 0 ? pagedEntries : [], error: null }),
  });
  const { data, error } = await loadEligibleEntries({
    supabase: mockSupabase({ riders: [{ id: "ok", team_id: "t1", is_academy: false, is_retired: false }] }),
    baseQuery, paged: true,
  });
  assert.equal(error, null);
  assert.deepEqual(data.map((e) => e.rider_id), ["ok"]);
});

test("clearFutureRaceEntries: sletter kun fremtidige løb-entries", async () => {
  let deleteState = null;
  const supabase = mockSupabase({
    raceEntriesSelect: [{ race_id: "r1" }, { race_id: "r2" }],
    onDelete: (s) => { deleteState = s; },
  });
  const { cleared, error } = await clearFutureRaceEntries({ supabase, riderId: "rid" });
  assert.equal(error, null);
  assert.equal(cleared, 2);
  assert.ok(deleteState.filters.some((f) => f[0] === "eq" && f[1] === "rider_id" && f[2] === "rid"));
  assert.ok(deleteState.filters.some((f) => f[0] === "in" && f[1] === "race_id"));
});

test("clearFutureRaceEntries: ingen fremtidige entries → 0, ingen delete", async () => {
  let deleted = false;
  const supabase = mockSupabase({ raceEntriesSelect: [], onDelete: () => { deleted = true; } });
  const { cleared } = await clearFutureRaceEntries({ supabase, riderId: "rid" });
  assert.equal(cleared, 0);
  assert.equal(deleted, false);
});

test("clearFutureRaceEntries: tom riderId → no-op", async () => {
  const { cleared } = await clearFutureRaceEntries({ supabase: mockSupabase({}), riderId: null });
  assert.equal(cleared, 0);
});
