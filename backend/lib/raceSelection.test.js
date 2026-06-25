// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, buildRiderRows } from "./raceSelection.js";

const base = {
  riderIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  captainId: "r1",
  sprintCaptainId: null,
  hunterId: null,
  teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"]),
  injuredRiderIds: new Set(),
  sizeRule: { min: 6, max: 8 },
  availableCount: 9,
};

test("gyldig udtagelse passerer", () => {
  assert.deepEqual(validateSelection(base), { ok: true, errors: [] });
});

test("størrelse håndhæves (for få / for mange / effectiveMin ved lille trup)", () => {
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r2"] }).errors.includes("selection_wrong_size"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1","r2","r3","r4","r5","r6","r7","r8","r9"] }).errors.includes("selection_wrong_size"));
  // Kun 5 raske på holdet → 5 er nok (effectiveMin).
  const small = validateSelection({
    ...base,
    riderIds: ["r1", "r2", "r3", "r4", "r5"],
    teamRiderIds: new Set(["r1", "r2", "r3", "r4", "r5"]),
    availableCount: 5,
  });
  assert.equal(small.ok, true);
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

// S4: per-etape rute-match — buildRiderRows mapper evner+profiler til riderRows.
test("buildRiderRows: hver rytter får stageSuitability-array (længde = antal etaper)", () => {
  const stages = [
    { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, randomness: 0.5 } },
    { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, randomness: 0.4 } },
  ];
  const riders = [{ id: "r1", firstname: "A", lastname: "B", primary_type: "climber", secondary_type: null }];
  const abilityByRider = new Map([["r1", { climbing: 90, sprint: 20 }]]);
  const conditionByRider = new Map([["r1", { form: 60, fatigue: 10, injured_until: null }]]);
  const rows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr: "2026-06-25" });
  assert.equal(rows[0].stageSuitability.length, 2);
  assert.ok(rows[0].stageSuitability[1] > rows[0].stageSuitability[0]); // klatrer: bjerg > flad
  assert.equal(typeof rows[0].suitability, "number"); // løb-snit bevaret
});

test("buildRiderRows: ingen evner → suitability null + stageSuitability null", () => {
  const stages = [{ stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8 } }];
  const rows = buildRiderRows({
    riders: [{ id: "r1", firstname: "A", lastname: "B" }],
    stages, abilityByRider: new Map(), conditionByRider: new Map(), todayStr: "2026-06-25",
  });
  assert.equal(rows[0].suitability, null);
  assert.equal(rows[0].stageSuitability, null);
});
