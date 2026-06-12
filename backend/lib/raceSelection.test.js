// backend/lib/raceSelection.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection } from "./raceSelection.js";

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
});

test("fremmede, skadede og duplikerede ryttere afvises", () => {
  assert.ok(validateSelection({ ...base, riderIds: [...base.riderIds.slice(0, 5), "alien"] }).errors.includes("selection_rider_not_on_team"));
  assert.ok(validateSelection({ ...base, injuredRiderIds: new Set(["r2"]) }).errors.includes("selection_rider_injured"));
  assert.ok(validateSelection({ ...base, riderIds: ["r1", "r1", "r2", "r3", "r4", "r5"] }).errors.includes("selection_duplicate_rider"));
});
