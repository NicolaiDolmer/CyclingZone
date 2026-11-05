// #7686: previewet skal følge kontrakten. Tændt findes kun skønnet, så et preview ikke
// kan se rigtigt ud, fordi en flade stadig læser et gammelt felt.
import { test } from "node:test";
import assert from "node:assert/strict";

import { previewEstimate, previewPotentialEstimateEnabled, previewProjection, previewReport } from "./potentialEstimateMock.ts";
import { SEED_PROJECTION, SEED_SCOUTING_REPORT, SEED_SCOUT_ESTIMATES } from "./seedData.js";
import { potentialViewOf, potentialViewValue } from "../lib/potentialEstimateDisplay.ts";

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
      assert.doesNotMatch(JSON.stringify(answer), FORBIDDEN, id);
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
  assert.equal(projection.estimateLine.at(-1)?.value, potentialViewValue(estimate.potentialView));
});
