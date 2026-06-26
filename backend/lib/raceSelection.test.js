// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, buildRiderRows, getSelectionContext } from "./raceSelection.js";

// #1906: fuld opstilling KRÆVES — en 6/6-klasse skal have præcis 6 udtagne.
const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 6 },
  availableCount: 9,
};

test("gyldig (fuld) udtagelse passerer", () => {
  assert.deepEqual(validateSelection(base), { ok: true, errors: [] });
});

test("fuld opstilling håndhæves (#1906): delvis trup afvises, fuld passerer", () => {
  // For få (2 af 6) → wrong_size.
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r2"] }).errors.includes("selection_wrong_size"));
  // For mange (7 af 6) → wrong_size.
  assert.ok(validateSelection({ ...base, riderIds: ["r1","r2","r3","r4","r5","r6","r7"] }).errors.includes("selection_wrong_size"));
  // Default-klasse {6,8}: fuld = 8 pladser. 6 udtagne → wrong_size; 8 → ok.
  const eight = ["r1","r2","r3","r4","r5","r6","r7","r8"];
  assert.ok(validateSelection({ ...base, sizeRule: { min: 6, max: 8 }, riderIds: ["r1","r2","r3","r4","r5","r6"] }).errors.includes("selection_wrong_size"));
  assert.equal(validateSelection({ ...base, sizeRule: { min: 6, max: 8 }, riderIds: eight }).ok, true);
});

test("for få raske ryttere til fuld opstilling → selection_insufficient_riders (afmeld/hent fri-agenter)", () => {
  // Kun 5 berettigede raske ryttere, men løbet har 6 pladser → kan ikke fylde.
  const small = validateSelection({
    ...base,
    riderIds: ["r1", "r2", "r3", "r4", "r5"],
    teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5"]),
    availableCount: 5,
  });
  assert.equal(small.ok, false);
  assert.ok(small.errors.includes("selection_insufficient_riders"));
  assert.ok(!small.errors.includes("selection_wrong_size"), "insufficient er distinkt fra wrong_size");
});

test("kaptajn kræves, skal være udtaget, roller skal være distinkte", () => {
  assert.ok(validateSelection({ ...base, captainId: null }).errors.includes("selection_captain_required"));
  assert.ok(validateSelection({ ...base, captainId: "r9" }).errors.includes("selection_captain_not_selected"));
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r1" }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, hunterId: "r1" }).errors.includes("selection_role_overlap"));
  assert.ok(validateSelection({ ...base, sprintCaptainId: "r9" }).errors.includes("selection_role_not_selected"));
  assert.ok(validateSelection({ ...base, hunterId: "r9" }).errors.includes("selection_role_not_selected"));
});

test("fremmede, skadede og duplikerede ryttere afvises", () => {
  assert.ok(validateSelection({ ...base, riderIds: [...base.riderIds.slice(0, 5), "alien"] }).errors.includes("selection_rider_not_on_team"));
  assert.ok(validateSelection({ ...base, injuredRiderIds: new Set(["r2"]) }).errors.includes("selection_rider_injured"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r1", "r2", "r3", "r4", "r5"] }).errors.includes("selection_duplicate_rider"));
});

// Rod B (#1800/#1742): getSelectionContext må kun vise/tælle løbs-berettigede ryttere.
// Mock-supabase: thenable builder pr. tabel; eq/in/or registreres så riders-queriet
// kan respektere is_academy-filteret (akademiryttere ekskluderes fra rosteren).
function makeSelectionSupabase(state) {
  function from(table) {
    const f = { eqs: {}, ins: {} };
    const b = {
      select() { return b; },
      eq(col, val) { f.eqs[col] = val; return b; },
      in(col, vals) { f.ins[col] = vals; return b; },
      or() { f.orRetired = true; return b; },
      order() { return b; },
      then(resolve, reject) {
        let rows = state[table] || [];
        if (table === "riders") {
          rows = rows.filter((r) =>
            (f.eqs.team_id === undefined || r.team_id === f.eqs.team_id) &&
            (f.eqs.is_academy === undefined || r.is_academy === f.eqs.is_academy) &&
            (!f.orRetired || r.is_retired == null || r.is_retired === false)
          );
        } else if (f.eqs.race_id !== undefined) {
          rows = rows.filter((r) => r.race_id === f.eqs.race_id && (f.eqs.team_id === undefined || r.team_id === f.eqs.team_id));
        } else if (f.ins.rider_id) {
          rows = rows.filter((r) => f.ins.rider_id.includes(r.rider_id));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("getSelectionContext: ghost-entries (akademi/off-roster) udelades fra selection + counts", async () => {
  const teamId = "t1";
  const state = {
    riders: [
      ...["r1", "r2", "r3", "r4", "r5"].map((id) => ({ id, team_id: teamId, is_academy: false, is_retired: false, firstname: id, lastname: "X" })),
      { id: "academy", team_id: teamId, is_academy: true, is_retired: false, firstname: "A", lastname: "Cad" },
    ],
    race_stage_profiles: [{ race_id: "race1", stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }],
    race_entries: [
      ...["r1", "r2", "r3", "r4", "r5"].map((id) => ({ race_id: "race1", team_id: teamId, rider_id: id, race_role: id === "r1" ? "captain" : "helper", is_auto_filled: false })),
      { race_id: "race1", team_id: teamId, rider_id: "academy", race_role: "helper", is_auto_filled: false }, // ghost: udtaget før akademi-status
    ],
    rider_derived_abilities: ["r1", "r2", "r3", "r4", "r5"].map((id) => ({ rider_id: id, climbing: 50, sprint: 50, aggression: 40 })),
    rider_condition: [],
  };
  const supabase = makeSelectionSupabase(state);
  const ctx = await getSelectionContext({ supabase, race: { id: "race1", race_class: "Class2" }, teamId });
  assert.ok(!ctx.selection.rider_ids.includes("academy"), "akademi-ghost udeladt af selection");
  assert.equal(ctx.selection.rider_ids.length, 5, "kun de 5 gyldige tæller (ærlig count)");
  assert.ok(!ctx.riders.some((r) => r.id === "academy"), "akademirytter ikke i rosteren");
});

// S4: per-etape rute-match — buildRiderRows mapper evner+profiler til riderRows.
test("buildRiderRows: hver rytter får stageSuitability-array (længde = antal etaper)", () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, randomness: 0.5 } },
    { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.4 } },
  ];
  const riders = [{ id: "r1", firstname: "A", lastname: "B", primary_type: "climber", secondary_type: null }];
  const abilityByRider = new Map([["r1", { climbing: 90, sprint: 20, aggression: 73 }]]);
  const conditionByRider = new Map([["r1", { form: 60, fatigue: 10, injured_until: null }]]);
  const rows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr: "2026-06-25" });
  assert.equal(rows[0].stageSuitability.length, 2);
  assert.ok(rows[0].stageSuitability[1] > rows[0].stageSuitability[0]); // klatrer: bjerg > flad
  assert.equal(typeof rows[0].suitability, "number"); // løb-snit bevaret
  assert.equal(rows[0].aggression, 73); // S5: aggression surfaced til jæger-rangering
});

test("buildRiderRows: ingen evner → suitability null + stageSuitability null", () => {
  const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }];
  const rows = buildRiderRows({
    riders: [{ id: "r1", firstname: "A", lastname: "B" }],
    stages, abilityByRider: new Map(), conditionByRider: new Map(), todayStr: "2026-06-25",
  });
  assert.equal(rows[0].suitability, null);
  assert.equal(rows[0].stageSuitability, null);
  assert.equal(rows[0].aggression, null); // ingen evner → aggression null
});
