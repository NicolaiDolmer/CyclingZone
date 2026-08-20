// Plan B (#1441) — loadTrainingStaffContext: DB → { facilityTier, staff } for trænings-motoren.
import test from "node:test";
import assert from "node:assert/strict";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";

const TEAM_ID = "team-1";

// Minimal thenable query-mock: state = { tabel: rækker[] }; filtre via .eq()/.in() på alle kolonner.
// #3489: .in() tilføjet — trainingStaffContext henter nu staff_derived_abilities for
// FLERE staff-id'er ad gangen (op til MAX_STAFF_SLOTS_PER_ROLE aktive trænings-staff).
function createSupabaseMock(state, opts = {}) {
  function builder(table, filters = []) {
    return {
      select() { return builder(table, filters); },
      eq(col, val) { return builder(table, [...filters, { col, eq: val }]); },
      in(col, vals) { return builder(table, [...filters, { col, in: vals }]); },
      then(resolve) {
        if (opts.errorTable === table) {
          return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        }
        const rows = (state[table] ?? []).filter((r) =>
          filters.every((f) => ("eq" in f ? r[f.col] === f.eq : f.in.includes(r[f.col]))));
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

test("facilitet + chef m. persisteret ability-række (allerede u23-migreret) → staff = { overall, dimensions, levels }", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 4 }],
    team_staff: [{ id: "st-1", team_id: TEAM_ID, role: "training", status: "active", tier: 4, name: "Karel Novotny" }],
    staff_derived_abilities: [{ staff_id: "st-1", overall: 77, dimensions: { physical: 88 }, levels: { u23: 70 } }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.equal(ctx.facilityTier, 4);
  assert.deepEqual(ctx.staff, { overall: 77, dimensions: { physical: 88 }, levels: { u23: 70 } });
});

// #2529: DB-rækker fra FØR migrationen kan stadig have det gamle youth/junior-format
// i vinduet mellem merge og ejer-apply — graceful læsning må ikke knække.
test("facilitet + chef m. FØR-migration ability-række (youth/junior) → normaliseret til u23=MAX", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 4 }],
    team_staff: [{ id: "st-3", team_id: TEAM_ID, role: "training", status: "active", tier: 4, name: "Ane Iturriaga" }],
    staff_derived_abilities: [{ staff_id: "st-3", overall: 80, dimensions: { physical: 90 }, levels: { youth: 55, junior: 71, senior: 60 } }],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.deepEqual(ctx.staff.levels, { u23: 71, senior: 60 });
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

// #3489: op til 2 samtidige aktive trænings-staff nu (fx en U23- + en senior-
// træner) — dagsbonussen skal bruge den STÆRKESTE (højeste overall), uanset
// hvilken kom først i DB-rækkefølgen.
test("2 aktive trænings-staff → bruger den stærkeste (højeste overall)", async () => {
  const supabase = createSupabaseMock({
    team_facilities: [{ team_id: TEAM_ID, track: "training", tier: 4 }],
    team_staff: [
      { id: "st-weak", team_id: TEAM_ID, role: "training", status: "active", tier: 2, name: "Weak Coach" },
      { id: "st-strong", team_id: TEAM_ID, role: "training", status: "active", tier: 5, name: "Strong Coach" },
    ],
    staff_derived_abilities: [
      { staff_id: "st-weak", overall: 40, dimensions: { physical: 45 }, levels: { u23: 50, senior: 40 } },
      { staff_id: "st-strong", overall: 92, dimensions: { physical: 95 }, levels: { u23: 60, senior: 90 } },
    ],
  });
  const ctx = await loadTrainingStaffContext(supabase, TEAM_ID);
  assert.equal(ctx.facilityTier, 4);
  assert.deepEqual(ctx.staff, { overall: 92, dimensions: { physical: 95 }, levels: { u23: 60, senior: 90 } });
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
