// backend/lib/engine/v4/mechanics/crashDescentShare6938.test.ts
// #6938 U2 (KUN s5_profiles_v3, slukket): et styrt under et nedkoerselsangreb
// (mechanics/descent.ts) faar samme terraen-andel som M10's styrt. Uden v3 er
// andelen tuningens faelles, byte-identisk med foer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { descentHook } from "./descent.ts";
import { crashSeriousShareFor, resolveCrashIncident } from "./incidents.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING, INCIDENTS_EXTRA_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, RiderState, RouteV2, SegmentHookContext } from "../types.ts";

const ABILITIES: Record<AbilityKey, number> = {
  climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
  punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
  cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
};

const entrant = (rider_id: string, descending: number): Entrant =>
  ({ rider_id, abilities: { ...ABILITIES, descending }, role: "free_role", effort: "normal", condition: 1 }) as Entrant;

const riderState = (rider_id: string): RiderState => ({
  rider_id, group_id: "peloton-0", cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0,
  seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
});

const ROUTE: RouteV2 = {
  distance_km: 100, profile_type: "hilly", finale_type: "descent", segments: [],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

// Rigget styrt hos "strong": rul under p, km-fraktion og trappens tre lodtraekninger.
function riggedRngFor(severity: number): SegmentHookContext["rngFor"] {
  return (mechanic: string, riderId?: string) => {
    const plan: Record<string, number[]> = riderId !== "strong" ? {} : {
      descent_incident: [0, 0.5],
      descent_incident_severity: [severity],
      descent_incident_time_loss: [0.5],
      descent_incident_injury: [0],
    };
    const values = plan[mechanic] ?? [];
    let i = 0;
    return () => (i < values.length ? values[i++]! : 0.999999);
  };
}

function run(severity: number, v3: boolean) {
  const riders = { weak: riderState("weak"), strong: riderState("strong") };
  const state: EngineState = {
    km: 40, riders, virtual_gc: {},
    groups: [{ id: "peloton-0", kind: "peloton", rider_ids: ["weak", "strong"], gap_seconds: 0, cohesion: 1 }],
  };
  const ctx = makeHookCtx({
    segment: { kind: "descent", from_km: 40, to_km: 48, technicality: 3 },
    segmentIndex: 3,
    route: ROUTE,
    entrants: { weak: entrant("weak", 0), strong: entrant("strong", 99) },
    tuning: RACE_V4_TUNING,
    seed: "6938-descent",
  });
  return descentHook(state, { ...ctx, ...(v3 ? { s5ProfilesV3: true as const } : {}), rngFor: riggedRngFor(severity) });
}

test("#6938 U2: et nedkoerselsstyrt bruger terraenets andel under s5_profiles_v3; uden v3 = faelles andel", () => {
  const share = crashSeriousShareFor("descent", true)!;
  const common = INCIDENTS_EXTRA_TUNING.crashSeverityShares.serious;
  assert.ok(share > common);
  // En lodtraekning mellem de to andele: alvorligt kun under v3.
  const severity = (share + common) / 2;
  const rolls = { severity, magnitude: 0.5, injury: 0 };
  const ctx = { protectedByRule: false, helperNearby: false };

  const off = run(severity, false);
  const offIncident = off.events.find((e) => e.type === "incident");
  assert.ok(offIncident, "der skal vaere et nedkoerselsstyrt");
  assert.equal(offIncident.params.severity, resolveCrashIncident(rolls, ctx, INCIDENTS_EXTRA_TUNING).severity);
  assert.notEqual(offIncident.params.severity, "serious");
  assert.equal(off.state.riders.strong.status, "racing");

  const on = run(severity, true);
  const onIncident = on.events.find((e) => e.type === "incident");
  assert.ok(onIncident);
  assert.equal(onIncident.params.severity, "serious");
  assert.equal(onIncident.params.outcome, "abandoned");
  assert.equal(on.state.riders.strong.status, "abandoned");
});
