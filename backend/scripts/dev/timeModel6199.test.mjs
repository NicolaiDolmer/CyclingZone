// #6199 + #6200: replay-ankre for den faelles tidsmodel (orders_gc_v3) paa de
// to genskabte etaper fra loebet i #6199 (anonymiseret felt fra #6088):
//  - kort afslutning opad (kat. 3, 5,8 km a 5,8 %): nr. 10/30/50 inden for
//    ejerens lofter (20/90/300 s);
//  - tre kat. 1 og 8 km nedkoersel til maal: nedkoerslen lukker aldrig mere
//    end loftet pr. km for nogen i top 10.
// Tallene selv staar ikke her (hard rule 17); kun dommen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRaceEngineV4Adapter } from "../../lib/raceEngineV4Bridge.js";
import * as core from "../../lib/engine/v4/index.ts";
import * as tuning from "../../lib/engine/v4/tuning.ts";
import * as entrants from "../../lib/engine/v4/adapters/entrantAdapter.ts";
import * as route from "../../lib/engine/v4/adapters/routeAdapter.ts";
import * as orders from "../../lib/engine/v4/orders/teamOrdersAdapter.ts";
import * as timeline from "../../lib/engine/v4/timeline.ts";
import { TIME_MODEL_V3_TUNING } from "../../lib/engine/v4/mechanics/timeModel.ts";
import { loadFixture } from "./giroCaptainTimeLoss6088.mjs";
import { caughtEscapeeLate, descentReplayProfile, gapsAtRanks, isShortUphillFinish, runReplay, uphillReplayProfile } from "./timeModel6199.mjs";
import { routeFromStageProfileRow } from "../../lib/engine/v4/adapters/routeAdapter.ts";

const v4 = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
const data = loadFixture();

test("de genskabte etaper har rutens kendetegn: kort afslutning opad og nedkoersel til maal", () => {
  assert.equal(isShortUphillFinish(routeFromStageProfileRow(uphillReplayProfile())), true);
  const descent = descentReplayProfile();
  assert.equal(descent.segments.at(-1).kind, "descent");
  assert.equal(descent.climbs.filter((c) => c.category === "1").length, 3);
});

test("gapsAtRanks og caughtEscapeeLate regner paa de ryttere der kom i maal", () => {
  const results = [0, 5, 9].map((t, i) => ({ rider_id: `r${i}`, time_seconds: 100 + t, status: "finished" }));
  assert.deepEqual(gapsAtRanks(results, [1, 3, 4]), { 1: 0, 3: 9, 4: null });
  const out = {
    timeline: { events: [
      { type: "breakaway_formed", params: { rider_ids: ["e1", "e2"] } },
      { type: "breakaway_caught", params: { rider_ids: ["e1", "e2"] } },
    ] },
    results: [
      ...["p1", "p2", "p3"].map((id) => ({ rider_id: id, time_seconds: 1000, status: "finished" })),
      { rider_id: "e1", time_seconds: 1000, status: "finished" },
      { rider_id: "e2", time_seconds: 1700, status: "finished" },
    ],
  };
  assert.deepEqual(caughtEscapeeLate(out), { late: 1, total: 2 });
});

test("orders_gc_v3: replay-ankrene holder ejerens lofter", () => {
  const result = runReplay({ v4, data, revisions: ["orders_gc_v3"], seeds: 3 })["orders_gc_v3"];
  assert.ok(result.uphill.n10 <= 20, "kort afslutning opad: nr. 10 inden for loftet");
  assert.ok(result.uphill.n30 <= 90, "kort afslutning opad: nr. 30 inden for loftet");
  assert.ok(result.uphill.n50 <= 300, "kort afslutning opad: nr. 50 inden for loftet");
  assert.ok(
    result.descent.descentClosedMaxTop10Median <= TIME_MODEL_V3_TUNING.finishDescentMaxSecondsPerKm * 8 + 1,
    "nedkoerslen til maal lukker aldrig mere end loftet pr. km",
  );
});
