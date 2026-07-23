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

// #2804: golden-fixturerne UDELADER rutefelterne (undefined). Produktionens
// legacy-etaper har dem som NULL — og Number(null) === 0 er finit, så et bart
// Number.isFinite(Number(x)) læste NULL som "rutedata findes, 0 km". Alle 1060
// sæson-1-profiler havde præcis den form, og gaten ovenfor kunne ikke se det.
// Denne test lukker hullet: NULL skal give SAMME output som fravær.
const NULLABLE_ROUTE_FIELDS = ["distance_km", "climbs", "sectors", "sprints", "elevation_gain_m"];

test("raceRunnerRouteAware golden gate — NULL-rutefelter er identiske med manglende felter (#2804)", async (t) => {
  for (const [i, c] of golden.cases.entries()) {
    await t.test(`case ${i} med NULL: ${c.stageProfile.profile_type} v3=${c.v3} seed=${c.seed}`, () => {
      const nulled = { ...c.stageProfile };
      for (const f of NULLABLE_ROUTE_FIELDS) {
        assert.equal(nulled[f], undefined, `fixture ${i} har uventet ${f} — golden skal være bar`);
        nulled[f] = null;
      }
      const result = simulateStage({
        entrants: c.entrants,
        stageProfile: nulled,
        seed: c.seed,
        v3: c.v3,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(result)), c.expected);
    });
  }
});
