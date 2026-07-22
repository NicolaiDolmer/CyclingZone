// Sub-3 (#2771): bit-identitets-golden-gate.
//
// Golden-filen (raceRunnerRouteAware.golden.json) er genereret PÅ main-koden
// af scripts/dev/genRouteAwareGolden.js, FØR stageGapModel/route-aware-
// ændringerne rammer raceSimulator.js. stageProfile-objekterne er bevidst
// BARE (profile_type/finale_type/demand_vector/stage_number — ingen
// rutefelter). Invarianten denne test håndhæver: for etaper UDEN rutedata
// skal simulateStage blive ved med at producere BIT-FOR-BIT samme output,
// uanset hvilke route-aware-udvidelser der lægges oven på engine'en.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { simulateStage } from "./raceSimulator.js";

const golden = JSON.parse(
  readFileSync(new URL("./raceRunnerRouteAware.golden.json", import.meta.url)),
);

test("raceRunnerRouteAware golden gate — bare stageProfile giver bit-identisk output", async (t) => {
  for (const [i, c] of golden.cases.entries()) {
    await t.test(`case ${i}: ${c.stageProfile.profile_type} v3=${c.v3} seed=${c.seed}`, () => {
      const result = simulateStage({
        entrants: c.entrants,
        stageProfile: c.stageProfile,
        seed: c.seed,
        v3: c.v3,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(result)), c.expected);
    });
  }
});
