// #6088-ankeret: GC-kaptajnernes tidstab under orders_gc_v1 i et RIGTIGT felt
// (anonymiseret udsnit af et etapeloeb) skal ligge paa legacy-niveau eller
// bedre. Foer rettelsen tabte kaptajnerne flere gange saa meget tid, fordi et
// udbrud med staerke ryttere fik hele det ekstra lad-gaa-loft (se
// mechanics/breakaway.ts, #6088-blokken). Rolle-reglerne (ingen leder i
// udbruddet uden "Forsoeg udbrud") skal stadig holde.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRaceEngineV4Adapter } from "../../lib/raceEngineV4Bridge.js";
import * as core from "../../lib/engine/v4/index.ts";
import * as tuning from "../../lib/engine/v4/tuning.ts";
import * as entrants from "../../lib/engine/v4/adapters/entrantAdapter.ts";
import * as route from "../../lib/engine/v4/adapters/routeAdapter.ts";
import * as orders from "../../lib/engine/v4/orders/teamOrdersAdapter.ts";
import * as timeline from "../../lib/engine/v4/timeline.ts";
import { loadFixture, median, runCaptainTimeLoss } from "./giroCaptainTimeLoss6088.mjs";

const v4 = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
const data = loadFixture();

test("median: lige og ulige antal, ikke-tal ignoreres", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([Number.NaN, 5]), 5);
  assert.equal(median([]), null);
});

test("fixturet er anonymiseret: ingen uuid'er og intet loebsnavn", () => {
  const raw = JSON.stringify(data);
  assert.doesNotMatch(raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
  assert.equal(data.race.name, undefined);
});

test("#6088 med GC-standings (som i prod): kaptajnernes tidstab under orders_gc_v1 er paa legacy-niveau eller bedre, uden rolle-brud", () => {
  const legacy = runCaptainTimeLoss({ v4, data, rules: "legacy", seeds: 10, mode: "chain" });
  const v1 = runCaptainTimeLoss({ v4, data, rules: "orders_gc_v1", seeds: 10, mode: "chain" });
  assert.ok(v1.meanOfStageMedians <= legacy.meanOfStageMedians,
    `v1 ${v1.meanOfStageMedians.toFixed(0)} s > legacy ${legacy.meanOfStageMedians.toFixed(0)} s`);
  assert.equal(v1.stages.reduce((a, s) => a + s.violators, 0), 0);
});

test("#6088 uden GC-standings (dryRunUpcomingStage-vejen): tidstabet er hoejst lidt over legacy, aldrig flere gange saa meget", () => {
  const legacy = runCaptainTimeLoss({ v4, data, rules: "legacy", seeds: 6, mode: "single" });
  const v1 = runCaptainTimeLoss({ v4, data, rules: "orders_gc_v1", seeds: 6, mode: "single" });
  assert.ok(v1.meanOfStageMedians <= 1.5 * legacy.meanOfStageMedians,
    `v1 ${v1.meanOfStageMedians.toFixed(0)} s > 1,5 x legacy ${legacy.meanOfStageMedians.toFixed(0)} s`);
  assert.equal(v1.stages.reduce((a, s) => a + s.violators, 0), 0);
});
