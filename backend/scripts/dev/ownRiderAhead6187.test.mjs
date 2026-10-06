// #6187-ankeret: et hold jagter aldrig sine egne (orders_gc_v3). Giro-etapen hvor
// fejlen blev set i prod (bjergetape 7 i det anonymiserede #6088-felt), koert
// over flere seeds med samme klassement foer etapen. Under orders_gc_v2 jager
// Hold A sit eget udbrud (prod-symptomet); under orders_gc_v3 goer intet hold
// det, og hvert hold faar hoejst én forklarende linje i loebsfilmen.

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
import { ownChaseViolations, prodSituationOrders, runOwnRiderAhead, standingsBefore } from "./ownRiderAhead6187.mjs";

const v4 = createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
const data = loadFixture();
const SEEDS = 6;

test("ownChaseViolations: egen rytter paa trusselslisten og et hold der henter sit eget udbrud taelles", () => {
  const teamByRider = new Map([["a1", "A"], ["a2", "A"], ["b1", "B"]]);
  const events = [
    { km: 10, type: "gc_reaction", params: { team_id: "A", status: "started", rider_ids: ["a2", "b1"] } },
    { km: 10, type: "gc_reaction", params: { team_id: "B", status: "started", rider_ids: ["a2"] } },
    { km: 20, type: "breakaway_caught", params: { group_id: "g", rider_ids: ["a1", "b1"], chasing_team_ids: ["A"] } },
    { km: 30, type: "gc_reaction", params: { team_id: "A", status: "stopped" } },
  ];
  assert.deepEqual(ownChaseViolations(events, teamByRider).map((v) => `${v.kind}:${v.team_id}`), ["gc_reaction:A", "chase:A"]);
});

test("prod-situationen aendrer kun Hold A's ordre paa etapen: neutral, to holdkammerater i udbrud", () => {
  const standings = standingsBefore({ v4, data });
  const changed = prodSituationOrders({ data, standings });
  const diff = changed.filter((o, i) => o !== data.orders[i]);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].breakaway_stance, "neutral");
  assert.equal(diff[0].riders.filter((r) => r.try_break).length, 2);
});

test("#6187 anker (prod-situationen): Hold A jager sit eget udbrud under v2, aldrig under v3", () => {
  const r = runOwnRiderAhead({ v4, data, seeds: SEEDS, scenario: "prod" });
  const v2 = r.orders_gc_v2;
  const v3 = r.orders_gc_v3;
  assert.ok(v2.teamOwnInBreakSeeds > 0 && v3.teamOwnInBreakSeeds > 0, "Hold A har egne ryttere i udbruddet");
  // Foer (v2): prod-symptomet genskabes.
  assert.ok(v2.teamChasesOwnBreakaway > 0, "v2 genskaber prod-symptomet");
  assert.equal(v2.ownRidersAhead, 0, "v2 har ingen ny filmlinje (uaendret)");
  // Efter (v3): ingen jagt paa egne, for noget hold, og linjen forklarer hvorfor.
  assert.equal(v3.teamChasesOwnBreakaway, 0);
  assert.equal(v3.violations, 0);
  // #5978: under v3 er det svaerere for Hold A's GC-ryttere at komme afsted
  // (farlige for de andre hold), saa linjen forklarer reglen dér hvor den
  // aendrer noget, ikke noedvendigvis for Hold A paa hvert seed.
  assert.ok(v3.ownRidersAhead > 0, "linjen forklarer reglen");
  assert.ok(v3.maxOwnRidersAheadPerTeam <= 1, "hoejst én linje pr. hold pr. etape");
});

test("#6187 anker (ordrerne som i fixturet): jagt-ordren slaas fra for Hold A's eget udbrud under v3", () => {
  const r = runOwnRiderAhead({ v4, data, seeds: SEEDS, scenario: "fixture" });
  assert.ok(r.orders_gc_v2.violations > 0, "v2: et hold jager sine egne");
  assert.equal(r.orders_gc_v2.ownRidersAhead, 0);
  assert.equal(r.orders_gc_v3.violations, 0);
  assert.ok((r.orders_gc_v3.teamLines.chase_order ?? 0) > 0, "Hold A's jagt-ordre forklares");
  assert.ok(r.orders_gc_v3.maxOwnRidersAheadPerTeam <= 1);
});
