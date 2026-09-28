// #5843: en rytter der skifter trup må ikke blive stående i den gamle trups løb.
import test from "node:test";
import assert from "node:assert/strict";
import { clearOffSquadEntries, offSquadOpenRaceIds } from "./squadEntryCleanup.js";

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
