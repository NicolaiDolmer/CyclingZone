// #6092-ankeret: GC-kaptajnernes tidstab paa KUPEREDE etaper under
// orders_gc_v2 i et RIGTIGT felt (samme anonymiserede fixture som #6088-ankeret).
// Kaptajnerne koerte med favoritterne; tidstabet til vinderen var udbruddets
// forspring, som orders_gc_v1-loftet goer for stort paa kuperet terraen. Under
// orders_gc_v2 skal det ligge paa legacy-niveau eller bedre, og bjergetaperne
// maa ikke blive daarligere end under orders_gc_v1. Rolle-reglerne skal holde.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRaceEngineV4Adapter } from "../../lib/raceEngineV4Bridge.js";
import * as core from "../../lib/engine/v4/index.ts";
import * as tuning from "../../lib/engine/v4/tuning.ts";
import * as entrants from "../../lib/engine/v4/adapters/entrantAdapter.ts";
import * as route from "../../lib/engine/v4/adapters/routeAdapter.ts";
import * as orders from "../../lib/engine/v4/orders/teamOrdersAdapter.ts";
import * as timeline from "../../lib/engine/v4/timeline.ts";
import { loadFixture, runCaptainTimeLoss } from "./giroCaptainTimeLoss6088.mjs";

const v4 = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
const data = loadFixture();

const meanOf = (result, profiles) => {
  const rows = result.stages.filter((s) => profiles.includes(s.profile));
  return rows.reduce((a, r) => a + r.captainMedianGap, 0) / rows.length;
};

for (const mode of ["single", "chain"]) {
  test(`#6092 (${mode}): kuperet under orders_gc_v2 er paa legacy-niveau eller bedre og under orders_gc_v1, uden rolle-brud`, () => {
    const seeds = 6;
    const legacy = runCaptainTimeLoss({ v4, data, rules: "legacy", seeds, mode });
    const v1 = runCaptainTimeLoss({ v4, data, rules: "orders_gc_v1", seeds, mode });
    const v2 = runCaptainTimeLoss({ v4, data, rules: "orders_gc_v2", seeds, mode });
    const hilly = { legacy: meanOf(legacy, ["hilly"]), v1: meanOf(v1, ["hilly"]), v2: meanOf(v2, ["hilly"]) };
    assert.ok(hilly.v2 <= hilly.legacy, `kuperet v2 ${hilly.v2.toFixed(0)} s > legacy ${hilly.legacy.toFixed(0)} s`);
    assert.ok(hilly.v2 < hilly.v1, `kuperet v2 ${hilly.v2.toFixed(0)} s >= v1 ${hilly.v1.toFixed(0)} s`);
    const mountains = ["mountain", "high_mountain"];
    const m = { v1: meanOf(v1, mountains), v2: meanOf(v2, mountains) };
    assert.ok(m.v2 <= m.v1, `bjerg v2 ${m.v2.toFixed(0)} s > v1 ${m.v1.toFixed(0)} s`);
    assert.equal(v2.stages.reduce((a, s) => a + s.violators, 0), 0);
  });
}
