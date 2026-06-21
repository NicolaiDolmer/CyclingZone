import test from "node:test";
import assert from "node:assert/strict";

import { runRiderDeriveBackfill } from "./backfillRiderDerive.js";
import { STAT_KEYS } from "../lib/fictionalRiderGenerator.js";

// Kombineret mock der dækker BÅDE findStrandedRiderIds (riders + rider_derived_
// abilities reads) OG deriveForRiderIds (riders .in() read + upsert/update writes).
//   findStranded: riders.select("id, base_value").eq("is_retired",false).order().range()
//                 rider_derived_abilities.select("rider_id").order().range()
//   derive:       riders.select(<stats>).in("id", ids).order().range()  → fuld rytter-række
//                 upsert(...) + update(...).eq("id", id)
function makeMock({ riders = [], derived = [] }) {
  const writes = { upserts: [], updates: [] };
  const fullRiders = riders.map((r) => {
    const row = { id: r.id, height: 180, weight: 68, birthdate: "2000-01-01", potentiale: 4, base_value: r.base_value };
    for (const k of STAT_KEYS) row[k] = 70;
    return row;
  });

  function from(table) {
    let mode = null; // "list" (findStranded riders) | "full" (derive riders)
    let isRetired = null;
    const b = {
      select(cols) {
        if (table === "riders") mode = String(cols).includes("base_value") && !String(cols).includes("height") ? "list" : "full";
        return b;
      },
      eq(col, val) { if (col === "is_retired") isRetired = val; return b; },
      in() { return b; },
      order() { return b; },
      range() {
        if (table === "riders") {
          if (mode === "list") {
            const rows = fullRiders
              .filter((r) => (isRetired == null ? true : (riders.find((x) => x.id === r.id)?.is_retired ?? false) === isRetired))
              .map((r) => ({ id: r.id, base_value: r.base_value }));
            return Promise.resolve({ data: rows, error: null });
          }
          return Promise.resolve({ data: fullRiders, error: null }); // derive: fulde rækker
        }
        if (table === "rider_derived_abilities") {
          return Promise.resolve({ data: derived.map((d) => ({ rider_id: d })), error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      upsert(rows, opts) { writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      update(patch) {
        return { eq(col, val) { writes.updates.push({ table, patch, col, val }); return Promise.resolve({ error: null }); } };
      },
    };
    return b;
  }
  return { from, writes };
}

const noLog = () => {};

test("runRiderDeriveBackfill: ingen strandede → no-op, ingen writes", async () => {
  const supabase = makeMock({
    riders: [{ id: "a", base_value: 100, is_retired: false }],
    derived: ["a"],
  });
  const res = await runRiderDeriveBackfill({ supabase, dryRun: true, log: noLog });
  assert.equal(res.stranded, 0);
  assert.equal(res.healed, 0);
  assert.equal(supabase.writes.upserts.length, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

test("runRiderDeriveBackfill (dry-run): finder strandede men skriver intet", async () => {
  const supabase = makeMock({
    riders: [
      { id: "a", base_value: 100, is_retired: false },
      { id: "stranded", base_value: null, is_retired: false },
    ],
    derived: ["a"],
  });
  const res = await runRiderDeriveBackfill({ supabase, dryRun: true, log: noLog });
  assert.equal(res.dryRun, true);
  assert.equal(res.stranded, 1, "én strandet rytter fundet");
  assert.equal(res.healed, 0, "dry-run healer ingen");
  assert.equal(supabase.writes.upserts.length, 0, "dry-run må ikke upserte");
  assert.equal(supabase.writes.updates.length, 0, "dry-run må ikke opdatere");
});

test("runRiderDeriveBackfill (live): re-deriver strandede ryttere + skriver", async () => {
  const supabase = makeMock({
    riders: [
      { id: "a", base_value: 100, is_retired: false },
      { id: "stranded", base_value: null, is_retired: false },
    ],
    derived: ["a"],
  });
  const res = await runRiderDeriveBackfill({ supabase, dryRun: false, log: noLog });
  assert.equal(res.dryRun, false);
  assert.equal(res.stranded, 1);
  assert.ok(res.healed >= 1, "mindst den strandede rytter blev re-derived");
  // upserts: physiology + abilities for de strandede; updates: type + base_value.
  const upsertTables = [...new Set(supabase.writes.upserts.map((u) => u.table))].sort();
  assert.deepEqual(upsertTables, ["rider_derived_abilities", "rider_physiology_profiles"]);
  assert.ok(supabase.writes.updates.length >= 1, "rider-update (type+base_value) skrevet");
});
