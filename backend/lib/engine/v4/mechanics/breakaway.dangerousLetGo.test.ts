// backend/lib/engine/v4/mechanics/breakaway.dangerousLetGo.test.ts
// #6089: under orders_gc_v1 faar et udbrud med en alvorlig GC-trussel (en
// klassementsrytter med udbrudsordre, som et hold i jagtgruppen reagerer paa)
// IKKE det fulde ekstra lad-gaa-forspring; det er til et ikke-farligt udbrud.
// Det ekstra daempes som naar hele feltet lader gaa (#6074's gulv). Et harmloest
// udbrud og legacy er uaendrede. Syntetiske ryttere; testene laaser strukturen,
// ikke kalibrerede tal.
import { test } from "node:test";
import assert from "node:assert/strict";

import { breakawayHook, letGoBalanceFor, letGoMaxGapSeconds, TEAM_TACTICS_ORDER_KIND } from "./breakaway.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey, Entrant, EngineState, GcContext, RiderState, RouteV2, SegmentHookContext, TeamOrder, TimelineEvent,
} from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const ROUTE: RouteV2 = {
  distance_km: 200, profile_type: "mountain", finale_type: "long_climb",
  segments: Array.from({ length: 40 }, (_, i) => ({ kind: "flat" as const, from_km: i * 5, to_km: (i + 1) * 5 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};
const GC: GcContext = {
  status: "standings", stage_number: 6, leader_id: "A0",
  standings: [
    ...TEAMS.map((t, i) => [`${t}0`, i * 20] as [string, number]),
    ...TEAMS.flatMap((t) => [1, 2, 3, 4].map((i) => [`${t}${i}`, 3600 + i] as [string, number])),
  ].map(([rider_id, gap_seconds], i) => ({ rider_id, rank: i + 1, gap_seconds })),
};

function riderState(id: string, group: string): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}
const order = (team: string): TeamOrder => ({ team_id: team, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: "neutral", riders: [] } });

/** Dagens udbrud lige dannet; holdene er neutrale. Returnerer den stoerste separation undervejs. */
function maxSeparation(breakawayIds: string[], revision: "legacy" | "orders_gc_v1", gcContext?: GcContext) {
  const entrants: Record<string, Entrant> = {};
  for (const team of TEAMS) {
    for (let i = 0; i < 5; i++) {
      const id = `${team}${i}`;
      entrants[id] = { rider_id: id, abilities: abilities(i === 0 ? 70 : 50), role: i === 0 ? "captain" : "helper", effort: "normal", condition: 1, team_id: team };
    }
  }
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(entrants)) riders[id] = riderState(id, breakawayIds.includes(id) ? "breakaway-0" : "peloton-0");
  let state: EngineState = {
    km: 5,
    groups: [
      { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: [...breakawayIds].sort(), gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(entrants).filter((id) => !breakawayIds.includes(id)).sort(), gap_seconds: 25, cohesion: 1 },
    ],
    riders, virtual_gc: {},
  };
  const orders = TEAMS.map(order);
  const events: TimelineEvent[] = [];
  let max = 0;
  for (let i = 1; i < ROUTE.segments.length - 1; i++) {
    const base = makeHookCtx({ segment: ROUTE.segments[i], segmentIndex: i, route: ROUTE, entrants, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = { ...base, rulesRevision: revision, ...(gcContext ? { gcContext } : {}) };
    const r = breakawayHook(state, ctx);
    state = r.state;
    events.push(...r.events);
    const b = state.groups.find((g) => g.id === "breakaway-0");
    const p = state.groups.find((g) => g.id === "peloton-0");
    if (b && p) max = Math.max(max, p.gap_seconds - b.gap_seconds);
  }
  return { max, state, events, entrants };
}

test("#6089: a break with a serious GC threat gets less let-go room than the same break unseen", () => {
  // B0 er nr. 2 i klassementet, 20 s efter foereren A0: en alvorlig trussel.
  const seen = maxSeparation(["B0", "C3"], "orders_gc_v1", GC);
  const unseen = maxSeparation(["B0", "C3"], "orders_gc_v1", { status: "missing", stage_number: 6 });
  assert.ok(seen.events.some((e) => e.type === "gc_reaction" && e.params.status === "started"), "a GC team reacts");
  assert.ok(seen.max < unseen.max, `the dangerous break is held shorter (${seen.max} < ${unseen.max})`);
  // Ankeret: hullet kommer aldrig over det daempede loft (uden #6089 naar det
  // det fulde orders_gc_v1-loft, bremsen daemper kun vaeksten).
  const ids = Object.keys(seen.state.riders);
  const base = letGoMaxGapSeconds({ breakawayRiderIds: ["B0", "C3"], fieldRiderIds: ids, entrants: seen.entrants, profileType: "mountain", finaleType: "long_climb" });
  const dampedCeiling = base * letGoBalanceFor("orders_gc_v1", "mountain", 1).maxGapFactor;
  assert.ok(seen.max <= dampedCeiling + 1e-6, `the gap stays under the damped ceiling (${seen.max} <= ${dampedCeiling})`);
  assert.ok(unseen.max > dampedCeiling, "the unseen break gets the full room");
});

test("#6089: the damped room is the all-teams-let-go floor, never below legacy", () => {
  const full = letGoBalanceFor("orders_gc_v1", "mountain");
  const damped = letGoBalanceFor("orders_gc_v1", "mountain", 1);
  assert.ok(damped.maxGapFactor < full.maxGapFactor);
  assert.ok(damped.maxGapFactor >= 1, "the damping only takes from the orders_gc_v1 extra");
  assert.ok(damped.rateFactor >= 1);
});

test("#6089: a harmless break keeps the full orders_gc_v1 room", () => {
  // C3 og D2 er langt nede i klassementet: ingen trussel, ingen daempning.
  const seen = maxSeparation(["C3", "D2"], "orders_gc_v1", GC);
  const unseen = maxSeparation(["C3", "D2"], "orders_gc_v1", { status: "missing", stage_number: 6 });
  assert.equal(seen.max, unseen.max);
});

test("#6089: legacy is untouched by the GC context", () => {
  const withCtx = maxSeparation(["B0", "C3"], "legacy", GC);
  const without = maxSeparation(["B0", "C3"], "legacy");
  assert.deepEqual(withCtx.state, without.state);
  assert.deepEqual(withCtx.events, without.events);
});
