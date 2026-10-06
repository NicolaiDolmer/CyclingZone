// #5978-ankeret: farlig rytter i udbrud (orders_gc_v3). Giro-etapen hvor fejlen
// blev set i prod (bjergetape 6 i det anonymiserede #6088-felt): klassementets
// nr. 8 i et udbrud paa otte, alle sendt af deres manager. Under orders_gc_v2
// stopper hvert reagerende hold som "contained", mens forspringet er over hans
// afstand (prod-symptomet); under orders_gc_v3 holdes han i snor, og det er
// svaerere at komme af sted. Kun retningen laases her; tallene ligger i
// balance-internals/5978/ (hard rule 17).

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRaceEngineV4Adapter } from "../../lib/raceEngineV4Bridge.js";
import * as core from "../../lib/engine/v4/index.ts";
import * as tuning from "../../lib/engine/v4/tuning.ts";
import * as entrants from "../../lib/engine/v4/adapters/entrantAdapter.ts";
import * as route from "../../lib/engine/v4/adapters/routeAdapter.ts";
import * as orders from "../../lib/engine/v4/orders/teamOrdersAdapter.ts";
import * as timeline from "../../lib/engine/v4/timeline.ts";
import { loadFixture } from "./giroCaptainTimeLoss6088.mjs";
import { analyzeAnchorRun, anchorOrders, ANCHOR_STAGE, runDangerousRiderLeash, standingsChain } from "./dangerousRiderLeash5978.mjs";

const v4 = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
const data = loadFixture();
const SEEDS = 8;
const chain = standingsChain({ v4, data, lastStage: ANCHOR_STAGE });

test("anchorOrders: GC-nr. 8 og tre ryttere omkring nr. 21-24 faar en ordre, fyld fra bunden af klassementet", () => {
  const { standings } = chain.get(ANCHOR_STAGE);
  const { orders: changed, dangerousId, breakIds } = anchorOrders({ data, standings });
  assert.equal(dangerousId, standings[7].rider_id);
  assert.equal(breakIds.length, 8);
  const rankOf = new Map(standings.map((s, i) => [s.rider_id, i + 1]));
  const ranks = breakIds.map((id) => rankOf.get(id)).sort((a, b) => a - b);
  assert.deepEqual(ranks.slice(0, 4), [8, 21, 23, 24]);
  assert.ok(ranks.slice(4).every((r) => r > standings.length / 2), "fyld er ingen GC-trussel");
  const ordered = new Set(changed.filter((o) => o.stage_number === ANCHOR_STAGE).flatMap((o) => o.riders.filter((r) => r.try_break).map((r) => r.rider_id)));
  for (const id of breakIds) assert.ok(ordered.has(id), `${id} har en udbrudsordre`);
});

test("analyzeAnchorRun: 'contained' taelles kun mens han sidder i udbruddet over sin afstand, for hold han er rival for", () => {
  const gapById = new Map([["x", 100], ["p", 0], ["q", 0]]);
  const out = {
    groupSnapshots: [
      { km: 10, groups: [{ group_id: "b", kind: "breakaway", rider_ids: ["x"], gap_seconds: 0 }, { group_id: "pel", kind: "peloton", rider_ids: Array.from({ length: 30 }, (_, i) => `r${i}`), gap_seconds: 150 }] },
      { km: 20, groups: [{ group_id: "b", kind: "breakaway", rider_ids: ["x"], gap_seconds: 0 }, { group_id: "pel", kind: "peloton", rider_ids: Array.from({ length: 30 }, (_, i) => `r${i}`), gap_seconds: 50 }] },
    ],
    timeline: { events: [
      { km: 0, type: "breakaway_formed", params: { rider_ids: ["x"] } },
      { km: 20, type: "gc_reaction", params: { status: "stopped", reason: "contained", protected_rider_id: "p" } },
      { km: 20, type: "gc_reaction", params: { status: "stopped", reason: "contained", protected_rider_id: "q" } },
    ] },
  };
  const a = analyzeAnchorRun(out, "x", gapById, (id) => id === "p");
  assert.equal(a.escaped, true);
  assert.equal(a.maxLead, 150);
  assert.equal(a.containedWhileIn, 1, "kun holdet han er rival for; forspringet ved segmentets start (150) var over afstanden (100)");
});

test("#5978 anker (Giro etape 6): v2 genskaber 'contained' over hans afstand; v3 holder ham i snor og goer det svaerere at komme af sted", () => {
  const r = runDangerousRiderLeash({ v4, data, seeds: SEEDS, chain });
  const v2 = r.orders_gc_v2;
  const v3 = r.orders_gc_v3;
  assert.equal(r.dangerousRank, 8);
  // Foer (v2): prod-symptomet.
  assert.ok(v2.escapedSeeds > 0, "v2: han kommer afsted");
  assert.ok(v2.containedWhileIn > 0, "v2: reaktioner stopper som 'contained' mens forspringet er over hans afstand");
  // Efter (v3): ingen 'contained' mens snoren burde holde.
  assert.equal(v3.containedWhileIn, 0);
  // Dannelsen: det er svaerere for ham at komme afsted (hoej risiko).
  assert.ok(v3.escapedSeeds < v2.escapedSeeds, `v3 ${v3.escapedSeeds} < v2 ${v2.escapedSeeds}`);
  // Snoren: forspringet bliver mindre end under v2, naar han er afsted.
  if (v3.escapedSeeds > 0) {
    const max = (xs) => Math.max(...xs);
    assert.ok(max(v3.maxLeadWhileIn) < max(v2.maxLeadWhileIn), "snoren holder forspringet nede");
  }
  // Udbruddet holder sjaeldnere hjem med ham (ingen garanti for nogen af delene).
  assert.ok(v3.survivedWithHim <= v2.survivedWithHim);
});
