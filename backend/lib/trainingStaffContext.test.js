// Plan B (#1441) — loadTrainingStaffContext: DB → { facilityTier, staff } for trænings-motoren.
import test from "node:test";
import assert from "node:assert/strict";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const TEAM_ID = "team-1";

// Minimal thenable query-mock: state = { tabel: rækker[] }; filtre via .eq() på alle kolonner.
function createSupabaseMock(state, opts = {}) {
  function builder(table, filters = []) {
    return {
      select() { return builder(table, filters); },
      eq(col, val) { return builder(table, [...filters, [col, val]]); },
      then(resolve) {
        if (opts.errorTable === table) {
          return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        }
        const rows = (state[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
  }
  return { from(table) { return builder(table); } };
}

test("neutral: hold uden facilitet + uden staff → { 0, null }", async () => {
  const ctx = await loadTrainingStaffContext(createSupabaseMock({}), TEAM_ID);
  assert.deepEqual(ctx, { facilityTier: 0, staff: null });
});

test("facilitet uden chef → { tier, staff: null }", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 3 }, { team_id: TEAM_ID, track: "medical", tier: 5 }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.deepEqual(ctx, { facilityTier: 3, staff: null });
});

test("facilitet + chef m. persisteret ability-række → staff = { overall, dimensions, levels }", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 4 }],
    team_staff: [{ id: "st-1", team_id: TEAM_ID, role: "training", status: "active", tier: 4, name: "Karel Novotny" }],
    staff_derived_abilities: [{ staff_id: "st-1", overall: 77, dimensions: { physical: 88 }, levels: { youth: 70 } }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.equal(ctx.facilityTier, 4);
  assert.deepEqual(ctx.staff, { overall: 77, dimensions: { physical: 88 }, levels: { youth: 70 } });
});

test("self-heal: manglende ability-række → deterministisk derivation fra (role,tier,name)", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 2 }],
    team_staff: [{ id: "st-2", team_id: TEAM_ID, role: "training", status: "active", tier: 2, name: "Sofie Lindqvist" }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  const expected = deriveStaffAbilities({ role: "training", tier: 2, name: "Sofie Lindqvist" });
  assert.equal(ctx.staff.overall, expected.overall);
  assert.deepEqual(ctx.staff.dimensions, expected.dimensions);
  assert.deepEqual(ctx.staff.levels, expected.levels);
});

test("kun ANDRE spors staff/faciliteter → neutral (training-filter)", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "scouting", tier: 5 }],
    team_staff: [{ id: "st-3", team_id: TEAM_ID, role: "medical", status: "active", tier: 3, name: "X" }],
  });
  assert.deepEqual(await loadTrainingStaffContext(supabase, TEAM_ID), { facilityTier: 0, staff: null });
});

test("fyret chef (status != active) tæller ikke", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 1 }],
    team_staff: [{ id: "st-4", team_id: TEAM_ID, role: "training", status: "fired", tier: 1, name: "Y" }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.deepEqual(ctx, { facilityTier: 1, staff: null });
});

test("BEST-EFFORT: DB-fejl → neutral kontekst, kaster ALDRIG (træningsdagen må ikke vælte)", async () => {
  const supabase = createSupabaseMock({}, { errorTable: "team_facilities" });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.deepEqual(ctx, { facilityTier: 0, staff: null });
});
