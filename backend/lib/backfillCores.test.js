import test from "node:test";
import assert from "node:assert/strict";

import { runPhysiologyBackfill, runRiderTypesBackfill, runBaseValueBackfill } from "./backfillCores.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { ABILITY_KEYS } from "./riderTypes.js";

// Én fleksibel in-memory mock der dækker alle tre kerners læse/skrive-flader:
//   reads:  from(t).select(...).eq?(...).order(...).range(from,to)  (fetchAllRows-kontrakt)
//   writes: from(t).upsert(rows, {onConflict})  |  from(t).update(patch).eq("id", id)
function makeMockSupabase(tables) {
  const writes = { upserts: [], updates: [] };
  function from(table) {
    const api = {
      select() { return api; },
      eq() { return api; },
      order() { return api; },
      range() { return Promise.resolve({ data: tables[table] ?? [], error: null }); },
      upsert(rows, opts) { writes.upserts.push({ table, rows, opts }); return Promise.resolve({ error: null }); },
      update(patch) {
        return {
          eq(col, val) {
            writes.updates.push({ table, patch, col, val });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  }
  return { from, writes };
}

function makeRider(id) {
  const rider = { id, height: 180, weight: 68, birthdate: "2000-01-01", potentiale: 4, primary_type: "climber", uci_points: 100, prize_earnings_bonus: 0 };
  for (const k of STAT_KEYS) rider[k] = 70;
  return rider;
}

function makeAbilities(rider_id) {
  const ab = { rider_id };
  for (const k of ABILITY_KEYS) ab[k] = 60;
  ab.climbing = 80; // gør typen ikke-degenereret
  return ab;
}

test("runPhysiologyBackfill (dryRun) beregner profiler+abilities uden writes", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: true });
  assert.equal(res.riders, 1);
  assert.equal(res.profiles, 1);
  assert.equal(res.abilities, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.upserts.length, 0, "dry-run må ikke skrive");
});

test("runPhysiologyBackfill (apply) upserter physiology + abilities", async () => {
  const supabase = makeMockSupabase({ riders: [makeRider("r1")] });
  const res = await runPhysiologyBackfill(supabase, { dryRun: false });
  assert.equal(res.written, 1);
  const tablesWritten = supabase.writes.upserts.map((u) => u.table).sort();
  assert.deepEqual(tablesWritten, ["rider_derived_abilities", "rider_physiology_profiles"]);
});

test("runRiderTypesBackfill (apply) skriver primary_type/secondary_type", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: false });
  assert.equal(res.riders, 1);
  assert.equal(res.written, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.col, "id");
  assert.equal(u.val, "r1");
  assert.ok(u.patch.primary_type, "primary_type sat");
  assert.ok(u.patch.secondary_type, "secondary_type sat");
});

test("runRiderTypesBackfill (dryRun) skriver intet", async () => {
  const supabase = makeMockSupabase({ rider_derived_abilities: [makeAbilities("r1")] });
  const res = await runRiderTypesBackfill(supabase, { dryRun: true });
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});

test("runBaseValueBackfill (apply) værdisætter kun ryttere med abilities", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1"), { ...makeRider("r2"), primary_type: "sprinter" }],
    rider_derived_abilities: [makeAbilities("r1")], // kun r1 har abilities
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: false });
  assert.equal(res.valued, 1);
  assert.equal(res.noAbilities, 1);
  assert.equal(supabase.writes.updates.length, 1);
  const u = supabase.writes.updates[0];
  assert.equal(u.val, "r1");
  assert.ok(Number.isInteger(u.patch.base_value), "base_value er heltal");
  assert.ok(u.patch.base_value >= 1);
});

test("runBaseValueBackfill (dryRun) skriver intet men rapporterer valued>0", async () => {
  const supabase = makeMockSupabase({
    riders: [makeRider("r1")],
    rider_derived_abilities: [makeAbilities("r1")],
  });
  const res = await runBaseValueBackfill(supabase, { dryRun: true });
  assert.equal(res.valued, 1);
  assert.equal(res.written, 0);
  assert.equal(supabase.writes.updates.length, 0);
});
