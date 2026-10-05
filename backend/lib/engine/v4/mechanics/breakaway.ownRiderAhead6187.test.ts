// backend/lib/engine/v4/mechanics/breakaway.ownRiderAhead6187.test.ts
// #6187 (KUN orders_gc_v3): et hold foerer aldrig jagten paa en gruppe hvor det
// selv har en rytter. Ejer-design 5/10:
//   - hverken GC-reaktionen eller jagt-ordren saetter holdets ryttere til at
//     foere i jagten paa gruppen; reglen ophoerer naar holdets rytter er hentet
//     eller sat af,
//   - holdets udbrydere sidder paa hjul, naar gruppen rummer en trussel mod
//     holdets GC-rytter (de foerer ikke og sparer kraefter),
//   - én forklarende linje pr. hold pr. etape.
// orders_gc_v2 er uaendret. Syntetiske ryttere; testene laaser strukturen,
// ikke kalibrerede tal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  breakawayHook,
  computeNetChaseAdvantage,
  ownRidersOnWheel,
  ownRiderWheelSitterIds,
  teamChasePlan,
  TEAM_TACTICS_ORDER_KIND,
} from "./breakaway.ts";
import { groupEffortTempo } from "../segmentLoop.ts";
import { simulateStageV4 } from "../index.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey, Entrant, EngineState, GcContext, RiderState, RouteV2, SegmentHookContext, StageInput, TeamOrder, TimelineEvent,
} from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const TEAMS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const ROUTE: RouteV2 = {
  distance_km: 200, profile_type: "hilly", finale_type: "long_climb",
  segments: Array.from({ length: 40 }, (_, i) => ({ kind: "flat" as const, from_km: i * 5, to_km: (i + 1) * 5 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

// Hold B's GC-rytter er B0 (nr. 2). B1 er holdets egen nr. 4, taet paa B0 i
// klassementet. C0 (nr. 3) er en reel rival for baade A0 og B0.
const GC: GcContext = {
  status: "standings", stage_number: 7, leader_id: "A0",
  standings: [
    ["A0", 0], ["B0", 20], ["C0", 40], ["B1", 45],
    ...TEAMS.filter((t) => t !== "A" && t !== "B" && t !== "C").map((t, i) => [`${t}0`, 60 + i * 20] as [string, number]),
    ...TEAMS.flatMap((t) => [2, 3, 4].map((i) => [`${t}${i}`, 3600 + i] as [string, number])),
    ["A1", 3700], ["C1", 3700],
  ].map(([rider_id, gap_seconds], i) => ({ rider_id: rider_id as string, rank: i + 1, gap_seconds: gap_seconds as number })),
};

function entrants(): Record<string, Entrant> {
  const out: Record<string, Entrant> = {};
  for (const team of TEAMS) {
    for (let i = 0; i < 5; i++) {
      const id = `${team}${i}`;
      const level = i === 0 ? 70 : id === "B1" ? 70 : 50;
      out[id] = { rider_id: id, abilities: abilities(level), role: i === 0 ? "captain" : "helper", effort: "normal", condition: 1, team_id: team };
    }
  }
  return out;
}

function riderState(id: string, group: string): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}
const order = (team: string, stance: "chase" | "neutral" | "let_go" = "neutral"): TeamOrder =>
  ({ team_id: team, kind: TEAM_TACTICS_ORDER_KIND, params: { breakaway_stance: stance, riders: [] } });

function initialState(breakawayIds: string[], all: Record<string, Entrant>): EngineState {
  const riders: Record<string, RiderState> = {};
  for (const id of Object.keys(all)) riders[id] = riderState(id, breakawayIds.includes(id) ? "breakaway-0" : "peloton-0");
  return {
    km: 5,
    groups: [
      { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: [...breakawayIds].sort(), gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: Object.keys(all).filter((id) => !breakawayIds.includes(id)).sort(), gap_seconds: 25, cohesion: 1 },
    ],
    riders, virtual_gc: {},
  };
}

/** Afvikler hooket hen over etapen fra et lige dannet udbrud. */
function run(breakawayIds: string[], opts: { v3: boolean; stances?: Record<string, "chase" | "neutral" | "let_go"> }) {
  const all = entrants();
  let state = initialState(breakawayIds, all);
  const orders = TEAMS.map((t) => order(t, opts.stances?.[t] ?? "neutral"));
  const events: TimelineEvent[] = [];
  for (let i = 1; i < ROUTE.segments.length - 1; i++) {
    const base = makeHookCtx({ segment: ROUTE.segments[i], segmentIndex: i, route: ROUTE, entrants: all, tuning: RACE_V4_TUNING, orders });
    const ctx: SegmentHookContext = { ...base, rulesRevision: "orders_gc_v1", gcContext: GC, ...(opts.v3 ? { ordersGcV3: true as const } : {}) };
    const r = breakawayHook(state, ctx);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events, entrants: all };
}

const started = (events: TimelineEvent[], team: string) =>
  events.filter((e) => e.type === "gc_reaction" && e.params.team_id === team && e.params.status === "started");

test("#6187: under orders_gc_v2 the team chases a break holding its own rider (the bug, unchanged)", () => {
  const v2 = run(["B1", "C0", "D3"], { v3: false });
  assert.ok(started(v2.events, "B").length > 0, "team B reacts although B1 is up the road");
  const threatLists = started(v2.events, "B").map((e) => e.params.rider_ids as string[]);
  assert.ok(threatLists.some((ids) => ids.includes("B1")), "v2 even lists its own rider as a threat");
  assert.equal(v2.events.some((e) => e.type === "own_riders_ahead"), false);
});

test("#6187: own rider ahead + a rival in the same group: no GC reaction from that team, one explaining line", () => {
  const v3 = run(["B1", "C0", "D3"], { v3: true });
  assert.deepEqual(started(v3.events, "B"), [], "team B never starts a reaction while B1 is in the group");
  const all = v3.events.filter((e) => e.type === "own_riders_ahead");
  // Hold D (D3 foran, C0 truer D0) sidder ogsaa paa hjul: én linje pr. hold.
  assert.deepEqual(all.map((e) => e.params.team_id).sort(), ["B", "D"], "at most one line per team");
  assert.equal(all.find((e) => e.params.team_id === "D")?.params.reason, "gc_reaction");
  const lines = all.filter((e) => e.params.team_id === "B");
  assert.equal(lines[0].params.reason, "gc_reaction");
  assert.deepEqual(lines[0].params.rider_ids, ["B1"]);
  assert.equal(lines[0].params.group_id, "breakaway-0");
  assert.equal(lines[0].params.protected_rider_id, "B0");
  for (const value of Object.values(lines[0].params)) assert.notEqual(typeof value, "number", "fog-gate: no numbers");
  // Andre hold med en reel trussel (A0's rival C0) reagerer stadig.
  assert.ok(started(v3.events, "A").length > 0, "team A still reacts to the rival");
  // Hold B's hjaelpere har ikke betalt for nogen jagt.
  for (const id of ["B2", "B3", "B4"]) assert.equal(v3.state.riders[id].team_cp_factor ?? 1, 1, `${id} did not chase`);
});

test("#6187: once the own rider is dropped (not in the group) the team may chase again", () => {
  const v3 = run(["C0", "D3"], { v3: true });
  assert.ok(started(v3.events, "B").length > 0, "without B1 up the road, team B reacts to C0");
  assert.equal(v3.events.some((e) => e.type === "own_riders_ahead" && e.params.team_id === "B"), false);
});

test("#6187: a chase order + own rider ahead: the order is switched off for that group, and on again without him", () => {
  const all = entrants();
  const state = initialState(["B1", "C0", "D3"], all);
  const chaseGroupRiderIds = state.groups[1].rider_ids;
  const orders = [{ team_id: "B", breakaway_stance: "chase" as const, riders: [] }];
  const blocked = teamChasePlan({ orders, chaseGroupRiderIds, entrants: all, riders: state.riders, ownRiderAheadTeamIds: new Set(["B"]) });
  assert.equal(blocked.signal, 0);
  assert.equal(blocked.chaserWork.size, 0);
  const free = teamChasePlan({ orders, chaseGroupRiderIds, entrants: all, riders: state.riders });
  assert.ok(free.signal > 0);
  assert.ok([...free.chaserWork.keys()].every((id) => id.startsWith("B")));
  // let_go er uaendret af reglen (holdet traekker sig stadig ud).
  const letGo = [{ team_id: "B", breakaway_stance: "let_go" as const, riders: [] }];
  assert.equal(
    teamChasePlan({ orders: letGo, chaseGroupRiderIds, entrants: all, riders: state.riders, ownRiderAheadTeamIds: new Set(["B"]) }).signal,
    teamChasePlan({ orders: letGo, chaseGroupRiderIds, entrants: all, riders: state.riders }).signal,
  );
  // Ogsaa med GC-reaktioner i spil: holdet med egen mand foran trækker ikke.
  const reactions = new Map([["B", { intensity: 1, workers: ["B2", "B3", "B4"] }]]);
  const viaReaction = teamChasePlan({ orders, chaseGroupRiderIds, entrants: all, riders: state.riders, reactions, ownRiderAheadTeamIds: new Set(["B"]) });
  assert.equal(viaReaction.chaserWork.size, 0);
});

test("#6187: a chase order with the own rider ahead gets the line once, in the hook", () => {
  const v3 = run(["B1", "D3"], { v3: true, stances: { B: "chase" } });
  const lines = v3.events.filter((e) => e.type === "own_riders_ahead" && e.params.team_id === "B");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].params.reason, "chase_order");
  for (const id of ["B2", "B3", "B4"]) assert.equal(v3.state.riders[id].team_cp_factor ?? 1, 1, `${id} did not chase`);
  const v2 = run(["B1", "D3"], { v3: false, stances: { B: "chase" } });
  assert.ok(["B2", "B3", "B4"].some((id) => (v2.state.riders[id].team_cp_factor ?? 1) < 1), "under v2 the order makes them chase");
});

test("#6187: on the wheel: own riders sit on when a threat to the team's GC rider is in their group", () => {
  const all = entrants();
  const state = initialState(["B1", "C0", "D3"], all);
  const onWheel = ownRidersOnWheel({ groups: state.groups, riders: state.riders, entrants: all, gcContext: GC, route: ROUTE, km: 50 });
  assert.deepEqual(onWheel, [
    { team_id: "B", group_id: "breakaway-0", rider_ids: ["B1"], protected_rider_id: "B0" },
    { team_id: "D", group_id: "breakaway-0", rider_ids: ["D3"], protected_rider_id: "D0" },
  ]);
  // C0 er selv sit holds GC-rytter: han koerer sit eget loeb og sidder aldrig paa hjul.
  assert.equal(onWheel.some((w) => w.team_id === "C"), false);
  // Ingen trussel i gruppen (kun harmloese ryttere): ingen sidder paa hjul.
  const harmless = initialState(["D3", "E4", "F2"], all);
  assert.deepEqual(ownRidersOnWheel({ groups: harmless.groups, riders: harmless.riders, entrants: all, gcContext: GC, route: ROUTE, km: 50 }), []);
  // Uden klassement (raa kontekst "missing") sidder ingen paa hjul.
  assert.equal(ownRiderWheelSitterIds({ groups: state.groups, riders: state.riders, entrants: all, gcContext: { status: "missing" }, route: ROUTE, km: 50 }).size, 0);
  assert.deepEqual([...ownRiderWheelSitterIds({ groups: state.groups, riders: state.riders, entrants: all, gcContext: GC, route: ROUTE, km: 50 })], ["B1", "D3"]);
});

test("#6187: a team that lets the break go, with a rider up there and a threat beside him, gets the on-the-wheel line", () => {
  const v3 = run(["B1", "C0", "D3"], { v3: true, stances: { D: "let_go" } });
  const d = v3.events.filter((e) => e.type === "own_riders_ahead" && e.params.team_id === "D");
  assert.equal(d.length, 1);
  assert.equal(d[0].params.reason, "on_wheel");
  assert.deepEqual(d[0].params.rider_ids, ["D3"]);
  assert.deepEqual(v3.state.own_rider_ahead_teams, ["B", "D"]);
});

test("#6187: on the wheel the break goes slower (less resistance) and the sitters save energy (never at the front)", () => {
  const all = entrants();
  const breakawayRiderIds = ["B1", "C0", "D3"];
  const base = { chaseGroupRiderIds: Object.keys(all).filter((id) => !breakawayRiderIds.includes(id)), breakawayRiderIds, entrants: all, finaleType: "long_climb" as const, remainingKmFraction: 0.5, stance: 0 };
  const everyone = computeNetChaseAdvantage(base);
  const sitting = computeNetChaseAdvantage({ ...base, pullingBreakawayRiderIds: ["C0", "D3"] });
  assert.ok(sitting > everyone, `the chase gains more on a break with a rider on the wheel (${sitting} > ${everyone})`);
  // Uaendret naar ingen sidder paa hjul (bit-identisk).
  assert.equal(computeNetChaseAdvantage({ ...base, pullingBreakawayRiderIds: breakawayRiderIds }), everyone);
  // Modstanden kan aldrig stige af at en SVAG rytter sidder paa hjul.
  assert.ok(computeNetChaseAdvantage({ ...base, pullingBreakawayRiderIds: ["B1", "C0"] }) >= everyone);

  // Tempo: den der sidder paa hjul er aldrig i fronten, og gruppens tempo-CP falder.
  const cp = new Map([["B1", 0.9], ["C0", 0.8], ["D3", 0.5]]);
  const normal = groupEffortTempo(cp, () => "normal", 0.34);
  const wheel = groupEffortTempo(cp, () => "normal", 0.34, undefined, new Set(["B1"]));
  assert.ok(normal.frontRiderIds.has("B1"));
  assert.equal(wheel.frontRiderIds.has("B1"), false, "B1 rides in the draft: draft demand, not front work");
  assert.ok(wheel.collectiveCp < normal.collectiveCp, "the break's tempo comes from weaker riders");
  for (const kind of ["flat", "rolling", "climb"] as const) {
    assert.ok(RACE_V4_TUNING.work.draftFactor[kind] < RACE_V4_TUNING.work.frontWorkFactor[kind], `${kind}: the draft costs less than the front`);
  }
  // Uden saet: identisk med foer.
  assert.deepEqual(groupEffortTempo(cp, () => "normal", 0.34, undefined, undefined), normal);
});

// ── Ægte koersler (review af #6213, punkt 3) ─────────────────────────────────
// Hele motoren (simulateStageV4) under den revision etapen er bundet til, ikke
// hooket med en haandbygget kontekst. Bjergruten giver orders_gc_v2 dens egen
// bjergfase, saa "v2" her er praecis den koersel prod laver.

const PINNED_ROUTE: RouteV2 = {
  distance_km: 160, profile_type: "mountain", finale_type: "long_climb",
  segments: [
    ...Array.from({ length: 10 }, (_, i) => ({ kind: "flat" as const, from_km: i * 10, to_km: (i + 1) * 10 })),
    { kind: "climb" as const, from_km: 100, to_km: 115, category: "1" as const, avg_gradient: 7, top_elevation_m: 1500 },
    { kind: "descent" as const, from_km: 115, to_km: 130 },
    { kind: "climb" as const, from_km: 130, to_km: 160, category: "HC" as const, avg_gradient: 7.5, top_elevation_m: 2100 },
  ],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160, summit_finish: true }],
};

/** Udbrudsforsoeg fra B1 (holdets egen nr. 4), C0 (rival) og D3 (hjaelper). */
function pinnedInput(rulesRevision: "legacy" | "orders_gc_v1" | "orders_gc_v2" | "orders_gc_v3", seed: string, gcContext: GcContext = GC): StageInput {
  const all = entrants();
  const tryBreak = new Set(["B1", "C0", "D3"]);
  const orders: TeamOrder[] = TEAMS.map((t) => ({
    team_id: t, kind: TEAM_TACTICS_ORDER_KIND,
    params: { breakaway_stance: "neutral", riders: [0, 1, 2, 3, 4].map((i) => ({ rider_id: `${t}${i}`, try_break: tryBreak.has(`${t}${i}`) })) },
  }));
  return {
    route: PINNED_ROUTE, startlist: Object.values(all), orders, seed, tuning: RACE_V4_TUNING,
    ...(rulesRevision === "legacy" ? {} : { rules_revision: rulesRevision, gc_context: gcContext }),
  };
}

const digest = (out: unknown) => createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16);

// Fastfrosset paa main foer #5978 (efter #6213). Legacy, orders_gc_v1 og
// orders_gc_v2 maa ikke rykke af v3-arbejdet. Rykker en af dem, er en kendt
// revision aendret: det er en fejl, ikke en ny baseline.
const PINNED_DIGESTS: Record<string, string> = {
  "legacy:s1": "06881f0fb6669d39", "legacy:s2": "74256eaedf0fa1dd",
  "orders_gc_v1:s1": "58bc40ac4f1a0478", "orders_gc_v1:s2": "3d73f27372205a44",
  "orders_gc_v2:s1": "51042eab3a06c23b", "orders_gc_v2:s2": "a4a2da4b8dbb43dc",
  "orders_gc_v2:oneday": "e0c898a1477fc387",
};

test("#6187/#5978: legacy, orders_gc_v1 and orders_gc_v2 full-engine output is pinned (real runs, not the hook)", () => {
  const actual: Record<string, string> = {};
  for (const key of Object.keys(PINNED_DIGESTS)) {
    const [rev, seed] = key.split(":") as ["legacy" | "orders_gc_v1" | "orders_gc_v2", string];
    const gcContext: GcContext = seed === "oneday" ? { status: "one_day" } : GC;
    actual[key] = digest(simulateStageV4(pinnedInput(rev, `pinned-6187-${seed}`, gcContext)));
  }
  assert.deepEqual(actual, PINNED_DIGESTS);
});

test("#6187: the pinned v2 run is a real v2 run: v3 on the same input differs", () => {
  const v2 = simulateStageV4(pinnedInput("orders_gc_v2", "pinned-6187-s1"));
  const v3 = simulateStageV4(pinnedInput("orders_gc_v3", "pinned-6187-s1"));
  assert.notEqual(digest(v2), digest(v3));
  assert.equal(v2.timeline.events.some((e) => e.type === "own_riders_ahead"), false);
});
