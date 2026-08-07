import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulateStageRows } from "../../../backend/lib/raceClassifications.js";
import { classificationPointTotals } from "./raceClassificationTotals.js";

// #3519 parity-guard: frontend-kopien af CLASSIFICATION_POINTS/CLIMB_PROFILES
// (raceClassificationTotals.js) skal give BIT-IDENTISKE sprint-/bjerg-totaler
// som backend's accumulateStageRows (raceClassifications.js SSOT), for både
// passage-kolonne-vejen (Sub-2 #2770) og legacy-fallback-vejen (etaper uden
// sprint_points/kom_points). Rører frontend-kopien uden at opdatere backend
// FØRST → denne test brister.
test("classificationPointTotals matcher backend accumulateStageRows (passage-kolonner)", () => {
  // accumulateStageRows filtrerer IKKE result_type selv (caller-kontrakt, se
  // raceRunner.js's loadPriorStageRows: .eq("result_type", "stage") FØR kald) —
  // testen spejler samme kontrakt: begge funktioner fodres kun med "stage"-rækker.
  const allResults = [
    { result_type: "stage", stage_number: 1, rider_id: "r1", rank: 1, sprint_points: 5, kom_points: 3 },
    { result_type: "stage", stage_number: 1, rider_id: "r2", rank: 2, sprint_points: 2, kom_points: 0 },
    { result_type: "stage", stage_number: 2, rider_id: "r1", rank: 4, sprint_points: 0, kom_points: 8 },
    { result_type: "stage", stage_number: 2, rider_id: "r2", rank: 1, sprint_points: 12, kom_points: 0 },
    // ikke-stage-række — classificationPointTotals skal ignorere den selv
    // (den, i modsætning til accumulateStageRows, filtrerer result_type internt).
    { result_type: "leader", stage_number: 2, rider_id: "r2", rank: 1, finish_time: "+0:00" },
  ];
  const stageRows = allResults.filter((r) => r.result_type === "stage");
  const profileByStage = { 1: { profile_type: "flat" }, 2: { profile_type: "hilly" } };
  const profileTypeByStage = new Map([[1, "flat"], [2, "hilly"]]);

  const { pointsComp, komComp } = accumulateStageRows({ stageRows, profileTypeByStage });
  const { sprint, mountain } = classificationPointTotals(allResults, profileByStage);

  for (const [riderId, total] of pointsComp) assert.equal(sprint.get(riderId) || 0, total);
  for (const [riderId, total] of komComp) assert.equal(mountain.get(riderId) || 0, total);
  assert.equal(sprint.get("r1"), 5);
  assert.equal(mountain.get("r1"), 11);
});

test("classificationPointTotals matcher backend accumulateStageRows (legacy classPointsForRank-fallback)", () => {
  const stageRows = [
    { result_type: "stage", stage_number: 1, rider_id: "r1", rank: 1, finish_time: "+0:00" }, // flad etape → ingen KOM
    { result_type: "stage", stage_number: 2, rider_id: "r1", rank: 1, finish_time: "+0:00" }, // bjergetape → KOM tæller
    { result_type: "stage", stage_number: 2, rider_id: "r2", rank: 3, finish_time: "+0:12" },
  ];
  const profileByStage = { 1: { profile_type: "flat" }, 2: { profile_type: "mountain" } };
  const profileTypeByStage = new Map([[1, "flat"], [2, "mountain"]]);

  const { pointsComp, komComp } = accumulateStageRows({ stageRows, profileTypeByStage });
  const { sprint, mountain } = classificationPointTotals(stageRows, profileByStage);

  for (const [riderId, total] of pointsComp) assert.equal(sprint.get(riderId) || 0, total);
  for (const [riderId, total] of komComp) assert.equal(mountain.get(riderId) || 0, total);
  // r1: rank1 (etape 1, flad) + rank1 (etape 2, bjerg) = 25+25 sprint, kun etape 2's 25 tæller til KOM
  assert.equal(sprint.get("r1"), 50);
  assert.equal(mountain.get("r1"), 25);
});

test("uptoStage=null summerer alle etaper; et eksplicit stage-loft filtrerer senere etaper fra", () => {
  const stageRows = [
    { result_type: "stage", stage_number: 1, rider_id: "r1", rank: 1, sprint_points: 5, kom_points: 5 },
    { result_type: "stage", stage_number: 3, rider_id: "r1", rank: 1, sprint_points: 7, kom_points: 7 },
  ];
  const profileByStage = { 1: { profile_type: "flat" }, 3: { profile_type: "flat" } };

  const all = classificationPointTotals(stageRows, profileByStage, null);
  assert.equal(all.sprint.get("r1"), 12);

  const uptoStage1 = classificationPointTotals(stageRows, profileByStage, 1);
  assert.equal(uptoStage1.sprint.get("r1"), 5);
  assert.equal(uptoStage1.mountain.get("r1"), 5);
});
