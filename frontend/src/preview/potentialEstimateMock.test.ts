// #7686: previewet skal følge kontrakten. Tændt findes kun skønnet, så et preview ikke
// kan se rigtigt ud, fordi en flade stadig læser et gammelt felt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { previewEstimate, previewPotentialEstimateEnabled, previewProjection, previewReport } from "./potentialEstimateMock.ts";
import { SEED_PROJECTION, SEED_SCOUTING_REPORT, SEED_SCOUT_ESTIMATES } from "./seedData.js";
import { potentialViewOf, prognosisViewOf } from "../lib/potentialEstimateDisplay.ts";

const FORBIDDEN = /"(lo|hi|prog|ceil|loft|progLo|progHi|ceilLo|ceilHi|band|academyPrognosis)":/;

test("standard er slukket, så fixtures og snapshots er uændrede", () => {
  assert.equal(previewPotentialEstimateEnabled(), false);
});

test("ingen af de tre svar bærer interval eller loft", () => {
  for (const id of ["rider-1", "rider-2", "rider-x1", "rider-x2", "rider-x3", "rider-x4"]) {
    const answers = [
      previewEstimate(id, (SEED_SCOUT_ESTIMATES as Record<string, { level?: number }>)[id]),
      previewReport(id, SEED_SCOUTING_REPORT, true),
      previewProjection(id, SEED_PROJECTION),
    ];
    for (const answer of answers) {
      // #6110: rapporten bærer prognose-båndene pr. ryttertype (nu + prognose), aldrig intervallet på skønnet selv.
      const { types: _roleTypes, ...rest } = answer as Record<string, unknown>;
      assert.doesNotMatch(JSON.stringify(rest), FORBIDDEN, id);
      assert.ok(potentialViewOf(answer), id);
    }
  }
});

test("samme rytter har samme skøn på alle tre svar", () => {
  const estimate = previewEstimate("rider-1", SEED_SCOUT_ESTIMATES["rider-1"]);
  const report = previewReport("rider-1", SEED_SCOUTING_REPORT, true);
  const projection = previewProjection("rider-1", SEED_PROJECTION);
  assert.deepEqual(estimate.potentialView, report.potentialView);
  assert.deepEqual(estimate.potentialView, projection.potentialView);
  assert.ok(!("estimateLine" in projection), "#8523: den gamle kurve er væk");
});

test("#6110: rapporten bærer prognosen pr. ryttertype, men aldrig for skjulte ryttere", () => {
  let withList = 0;
  for (const id of ["rider-1", "rider-2", "rider-x1", "rider-x2", "rider-x3", "rider-x4"]) {
    const report = previewReport(id, SEED_SCOUTING_REPORT, true) as { potentialView: { hidden: boolean }; types?: Record<string, unknown>[] };
    if (report.potentialView.hidden) {
      assert.equal(report.types, undefined, id);
      continue;
    }
    withList += 1;
    assert.equal(report.types?.length, 8, id);
    assert.ok(report.types?.every((row) => !("loft" in row) && !("ceilLo" in row)), "kun nu og prognose-bånd");
  }
  assert.ok(withList > 0, "mindst én rytter har en liste");
});

test("#8523: egne ryttere har samme prognose på alle svar, andres ingen", () => {
  const own = previewEstimate("rider-1", SEED_SCOUT_ESTIMATES["rider-1"]);
  const report = previewReport("rider-1", SEED_SCOUTING_REPORT, true);
  assert.ok(prognosisViewOf(own));
  assert.deepEqual(prognosisViewOf(own), prognosisViewOf(report));
  assert.equal(prognosisViewOf(previewEstimate("rider-x1")), null);
  assert.equal(prognosisViewOf(previewReport("rider-x1", SEED_SCOUTING_REPORT, false)), null);
});
