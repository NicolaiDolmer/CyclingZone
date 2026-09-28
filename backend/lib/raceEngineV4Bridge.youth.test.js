// Ejer 28/9: ungdomsløb får en mildere v4-tidsgrænse. Broen sætter løbets trup
// på motorens input KUN for u23/junior, så et seniorinput er uændret.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildV4StageInput } from "./raceEngineV4Bridge.js";

const modules = {
  route: { routeFromStageProfileRow: () => ({ distance_km: 10, segments: [], waypoints: [] }) },
  entrants: { entrantFromAbilitiesRow: (row, opts) => ({ rider_id: opts.riderId }) },
  tuning: { RACE_V4_TUNING: { marker: true } },
  orders: { buildStageOrderPlan: () => ({ orders: [], aiEffortByRider: new Map() }) },
};

function inputFor(squad) {
  return buildV4StageInput({
    modules,
    entrants: [{ rider_id: "a", team_id: "T1", abilities: {}, fatigue: 0 }],
    stageProfile: { stage_number: 1, profile_type: "hilly", finale_type: "reduced_sprint", distance_km: 175 },
    seedString: "race:youth:1",
    stageNumber: 1,
    squad,
  });
}

test("u23 og junior: truppen sættes på motorens input", () => {
  assert.equal(inputFor("u23").squad, "u23");
  assert.equal(inputFor("junior").squad, "junior");
});

test("senior og udeladt trup: ingen squad-nøgle, inputtet er som før", () => {
  for (const squad of ["senior", null, undefined]) {
    assert.equal(Object.hasOwn(inputFor(squad), "squad"), false);
  }
});
