// #5843: en rytter der skifter trup må ikke blive stående i den gamle trups løb.
import test from "node:test";
import assert from "node:assert/strict";
import { clearOffSquadEntries, clearOffSquadEntriesSafe, offSquadOpenRaceIds } from "./squadEntryCleanup.js";

const open = (squad) => ({ squad, status: "scheduled", stages_completed: 0 });

test("#5843 offSquadOpenRaceIds: kun kommende løb i en ANDEN trup end rytterens nye", () => {
  const entries = [
    { race_id: "U1", races: open("u23") },
    { race_id: "J1", races: open("junior") },
    { race_id: "S1", races: open("senior") },
    { race_id: "S2", races: { squad: null, status: "scheduled", stages_completed: 0 } }, // manglende squad = senior
    { race_id: "U2", races: { squad: "u23", status: "scheduled", stages_completed: 1 } }, // startet → låst (#1825)
    { race_id: "U3", races: { squad: "u23", status: "completed", stages_completed: 1 } },
  ];
  assert.deepEqual(offSquadOpenRaceIds(entries, "senior").sort(), ["J1", "U1"]);
  assert.deepEqual(offSquadOpenRaceIds(entries, "u23").sort(), ["J1", "S1", "S2"]);
  assert.deepEqual(offSquadOpenRaceIds(entries, "junior").sort(), ["S1", "S2", "U1"]);
});

function mockSupabase(rows) {
  const rec = { deletes: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "race_entries");
      return {
        select() {
          const api = { eq() { return api; }, then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); } };
          return api;
        },
        delete() {
          const filters = {};
          const api = {
            eq(col, val) { filters[col] = val; return api; },
            in(col, vals) { filters[col] = vals; return api; },
            then(res, rej) { rec.deletes.push(filters); return Promise.resolve({ error: null }).then(res, rej); },
          };
          return api;
        },
      };
    },
  };
  return { supabase, rec };
}

test("#5843 clearOffSquadEntries: promoveret til senior → U23-/juniorløbene ryddes, seniorløbet bliver", async () => {
  const { supabase, rec } = mockSupabase([
    { race_id: "U1", races: open("u23") },
    { race_id: "S1", races: open("senior") },
  ]);
  const res = await clearOffSquadEntries(supabase, { riderId: "r1", squad: "senior" });
  assert.equal(res.cleared, 1);
  assert.deepEqual(rec.deletes, [{ rider_id: "r1", race_id: ["U1"] }]);
});

test("#5843 clearOffSquadEntries: intet at rydde → ingen delete", async () => {
  const { supabase, rec } = mockSupabase([{ race_id: "S1", races: open("senior") }]);
  const res = await clearOffSquadEntries(supabase, { riderId: "r1", squad: "senior" });
  assert.equal(res.cleared, 0);
  assert.equal(rec.deletes.length, 0);
});

test("#5903 clearOffSquadEntriesSafe: junior → U23 rydder juniorløbet, U23-løbet bliver", async () => {
  // Hændelsen 28/9: rytteren var autofyldt i et juniorløb og skiftede derefter til U23.
  const { supabase, rec } = mockSupabase([
    { race_id: "J1", races: open("junior") },
    { race_id: "U1", races: open("u23") },
  ]);
  const res = await clearOffSquadEntriesSafe(supabase, { riderId: "r1", squad: "u23", label: "test" });
  assert.equal(res.cleared, 1);
  assert.deepEqual(rec.deletes, [{ rider_id: "r1", race_id: ["J1"] }]);
});

test("#5903 clearOffSquadEntriesSafe: en fejl kastes aldrig videre (skiftet er allerede skrevet)", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (msg) => { errors.push(String(msg)); };
  try {
    const res = await clearOffSquadEntriesSafe({}, {
      riderId: "r1", squad: "senior", label: "test",
      clear: async () => { throw new Error("db nede"); },
    });
    assert.deepEqual(res, { cleared: 0, failed: true });
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /test: oprydning fejlede for rytter r1: db nede/);
});
