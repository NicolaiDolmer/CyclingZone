// backend/lib/engine/v4/mechanics/breakawayDropped6185.test.ts
// #6185 del 2 + #6234 (KUN orders_gc_v3):
//   1. Motoren melder selv "sat af fra udbruddet" (`breakaway_dropped`), naar en
//      udbryder havner i en gruppe bag udbruddet.
//   2. Et afsat stykke af udbruddet, der lukker hullet, er ikke en indhentning:
//      `breakaway_caught` kun naar ikke-udbrydere henter udbruddet.
// Laasen nederst koerer hele etapen gennem simulateStageV4 og sammenligner en
// digest af StageOutput med vaerdier fastfrosset mod koden FOER denne aendring
// (main paa cbeb70c65). Giver legacy, orders_gc_v1 eller orders_gc_v2 en anden
// digest, er det et laek ud af v3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { validateGroupMembership, validateTimelineEvents } from "../timeline.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { breakawayHook } from "./breakaway.ts";
import { breakawayDropEvents, isBreakawayPiece, rejoinBreakawayPiece } from "./chaseGroup.ts";
import { deriveParticipationHistory } from "../../../raceParticipationHistory.ts";
import { rankedFromV4Output } from "../../../raceEngineV4Bridge.js";
import type {
  AbilityKey, EngineState, Entrant, RaceGroup, RiderRole, RiderState, RouteV2, RulesRevision, Segment, SegmentHookContext, StageInput, StageOutput,
} from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** 8 hold a 5 ryttere med spredte evner (deterministisk, ingen rng). */
function field(): Entrant[] {
  const out: Entrant[] = [];
  for (let team = 0; team < 8; team++) {
    for (let r = 0; r < 5; r++) {
      const i = team * 5 + r;
      const abilities = {} as Record<AbilityKey, number>;
      ABILITY_KEYS.forEach((key, k) => {
        abilities[key] = 15 + ((i * 37 + k * 23 + team * 11) % 80);
      });
      const role: RiderRole = r === 0 ? "captain" : r === 4 ? "hunter" : "helper";
      out.push({ rider_id: `t${team}r${r}`, abilities, role, effort: "normal", condition: 1, team_id: `T${team}` });
    }
  }
  return out;
}

function climb(fromKm: number, toKm: number, category: "HC" | "1" | "2" | "3" | "4", gradient: number, topM: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: gradient, top_elevation_m: topM };
}

const ROUTES: Record<"mountain" | "hilly", RouteV2> = {
  mountain: {
    distance_km: 160,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: 0, to_km: 40 },
      climb(40, 52, "2", 6, 1200),
      { kind: "descent", from_km: 52, to_km: 62, technicality: 2 },
      { kind: "rolling", from_km: 62, to_km: 95 },
      climb(95, 110, "1", 7.5, 1800),
      { kind: "descent", from_km: 110, to_km: 125, technicality: 2 },
      { kind: "flat", from_km: 125, to_km: 145 },
      climb(145, 160, "HC", 8, 2000),
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
  },
  hilly: {
    distance_km: 175,
    profile_type: "hilly",
    finale_type: "reduced_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 45 },
      climb(45, 50, "3", 6, 600),
      { kind: "descent", from_km: 50, to_km: 58, technicality: 2 },
      { kind: "rolling", from_km: 58, to_km: 100 },
      climb(100, 106, "2", 7, 900),
      { kind: "descent", from_km: 106, to_km: 114, technicality: 2 },
      { kind: "rolling", from_km: 114, to_km: 168 },
      climb(168, 175, "3", 5.5, 700),
    ],
    weather: { kind: "sun", wind_exposure: 0.3 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 175 }],
  },
};

const SEEDS = ["6185-pin-a", "6185-pin-b", "6185-pin-c"];

function stage(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): StageOutput {
  const input: StageInput = { route: ROUTES[routeName], startlist: field(), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: revision };
  return simulateStageV4(input);
}

function digestOf(output: StageOutput): string {
  // Afrundet til 1e-6 foer hash (samme grund som segmentLoop.timeModel6199.test.ts).
  const quantized = JSON.stringify(output, (_k, v) =>
    typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
  return createHash("sha256").update(quantized).digest("hex").slice(0, 24);
}

// Fastfrosset mod koden FOER #6234/#6185 del 2 (main cbeb70c65).
const PINNED_PRE_6234: Record<string, string> = {
  "mountain/6185-pin-a/legacy": "b19588f5a20461918ea68f31",
  "mountain/6185-pin-a/orders_gc_v1": "ab7e30c0e7dd012460dee93e",
  "mountain/6185-pin-a/orders_gc_v2": "f3b67f3ee035e8f271054f2f",
  "mountain/6185-pin-b/legacy": "2646f69fe0ec5fdbaefd47f8",
  "mountain/6185-pin-b/orders_gc_v1": "a10142c9b752ca39b0cdfc82",
  "mountain/6185-pin-b/orders_gc_v2": "81a217e14a8dce301ef7312b",
  "mountain/6185-pin-c/legacy": "2361a9cf81ed7daadebc0524",
  "mountain/6185-pin-c/orders_gc_v1": "b91e055296b1395e95712215",
  "mountain/6185-pin-c/orders_gc_v2": "12da82c852c1ddc4937d1391",
  "hilly/6185-pin-a/legacy": "ce36b8c9d8f0cadea1d8e5d9",
  "hilly/6185-pin-a/orders_gc_v1": "b0fd5ae1a074e6a9c147eceb",
  "hilly/6185-pin-a/orders_gc_v2": "bb0428130081a7bcee3739b2",
  "hilly/6185-pin-b/legacy": "dcaf542dbccdab730c2798e4",
  "hilly/6185-pin-b/orders_gc_v1": "c58ee9e4311427728d62683a",
  "hilly/6185-pin-b/orders_gc_v2": "9c103121b611e5064d7ee895",
  "hilly/6185-pin-c/legacy": "b8e75b66d9dba10ca36a3b4f",
  "hilly/6185-pin-c/orders_gc_v1": "120e44fce73dd05110d37111",
  "hilly/6185-pin-c/orders_gc_v2": "d4a94e61b4280adb3b8c5bcd",
};

test("#6234/#6185 v3 slukket: legacy/v1/v2 giver en byte-identisk etape med koden foer aendringen (fastfrosset digest)", () => {
  const actual: Record<string, string> = {};
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (const seed of SEEDS) {
      for (const revision of ["legacy", "orders_gc_v1", "orders_gc_v2"] as RulesRevision[]) {
        actual[`${routeName}/${seed}/${revision}`] = digestOf(stage(routeName, revision, seed));
      }
    }
  }
  if (process.env.PRINT_PINS_6234) console.log(JSON.stringify(actual, null, 2));
  assert.deepEqual(actual, PINNED_PRE_6234);
});

// ── Hook-niveau (#6234): et afsat stykke lukker hullet ────────────────────────

const FLAT_ROUTE: RouteV2 = {
  distance_km: 100, profile_type: "flat", finale_type: "bunch_sprint",
  segments: Array.from({ length: 10 }, (_, i) => ({ kind: "flat" as const, from_km: i * 10, to_km: (i + 1) * 10 })),
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

function riderState(id: string, group: string): RiderState {
  return { rider_id: id, group_id: group, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}

/** Udbrud (E0,E1) foran, et afsat stykke (E2-E4) lige bag, feltet langt bagude. */
function pieceState(pieceGap: number): { state: EngineState; entrants: Record<string, Entrant> } {
  const all = field();
  const entrants = Object.fromEntries(all.map((e) => [e.rider_id, e]));
  const escapees = ["t0r4", "t1r4"];
  const piece = ["t2r4", "t3r4", "t4r4"];
  const rest = all.map((e) => e.rider_id).filter((id) => !escapees.includes(id) && !piece.includes(id));
  const groups: RaceGroup[] = [
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: escapees, gap_seconds: 0, cohesion: 1 },
    { id: "chase-1000", kind: "chase", origin: "breakaway", rider_ids: piece, gap_seconds: pieceGap, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: rest, gap_seconds: 600, cohesion: 1 },
  ];
  const riders: Record<string, RiderState> = {};
  for (const g of groups) for (const id of g.rider_ids) riders[id] = riderState(id, g.id);
  return { state: { km: 40, groups, riders, virtual_gc: {} }, entrants };
}

function hookCtx(entrants: Record<string, Entrant>, v3: boolean, segmentIndex = 4): SegmentHookContext {
  const base = makeHookCtx({ segment: FLAT_ROUTE.segments[segmentIndex], segmentIndex, route: FLAT_ROUTE, entrants, tuning: RACE_V4_TUNING });
  return { ...base, rulesRevision: "orders_gc_v1", ...(v3 ? { ordersGcV3: true as const } : {}) };
}

test("#6234: under orders_gc_v2 a dropped piece closing the gap is reported as a catch (the bug, unchanged)", () => {
  const { state, entrants } = pieceState(1);
  const r = breakawayHook(state, hookCtx(entrants, false));
  const caught = r.events.filter((e) => e.type === "breakaway_caught");
  assert.equal(caught.length, 1);
  assert.equal(caught[0].params.chase_group_id, "chase-1000");
  assert.equal(r.events.some((e) => e.type === "breakaway_dropped"), false, "v2 never reports drops");
});

test("#6234: under orders_gc_v3 the piece rejoins the break: no catch, one merge, the break stays a break", () => {
  const { state, entrants } = pieceState(1);
  const r = breakawayHook(state, hookCtx(entrants, true));
  assert.equal(r.events.some((e) => e.type === "breakaway_caught"), false, "a piece of the break never catches the break");
  const merged = r.events.filter((e) => e.type === "group_merged");
  assert.deepEqual(merged.map((e) => e.params), [{ group_id: "chase-1000", into_group_id: "breakaway-0", rider_ids: ["t2r4", "t3r4", "t4r4"] }]);
  const breakaway = r.state.groups.find((g) => g.id === "breakaway-0");
  assert.equal(breakaway?.kind, "breakaway", "the break keeps its kind although the piece was larger");
  assert.deepEqual([...(breakaway?.rider_ids ?? [])].sort(), ["t0r4", "t1r4", "t2r4", "t3r4", "t4r4"]);
  assert.equal(r.state.groups.some((g) => g.id === "chase-1000"), false);
  assert.equal(r.events.some((e) => e.type === "breakaway_dropped"), false, "riders back in the break are not dropped");
});

test("#6234: under orders_gc_v3 non-escapees closing the gap is still a catch", () => {
  const { state, entrants } = pieceState(1);
  // Stykket er feltet her: samme ryttere, men uden udbruddets oprindelse.
  const fieldPiece: EngineState = { ...state, groups: state.groups.map((g) => g.id === "chase-1000" ? { ...g, origin: undefined } : g) };
  const r = breakawayHook(fieldPiece, hookCtx(entrants, true));
  assert.equal(r.events.filter((e) => e.type === "breakaway_caught").length, 1);
});

test("#6185: under orders_gc_v3 a piece behind the break is reported once as dropped", () => {
  const { state, entrants } = pieceState(200);
  const first = breakawayHook(state, hookCtx(entrants, true, 4));
  const drops = first.events.filter((e) => e.type === "breakaway_dropped");
  assert.deepEqual(drops.map((e) => ({ km: e.km, ...e.params })), [
    { km: 50, group_id: "chase-1000", from_group_id: "breakaway-0", rider_ids: ["t2r4", "t3r4", "t4r4"] },
  ]);
  for (const value of Object.values(drops[0].params)) assert.notEqual(typeof value, "number", "fog-gate: no numbers");
  assert.deepEqual(first.state.breakaway_dropped_ids, ["t2r4", "t3r4", "t4r4"]);
  const second = breakawayHook(first.state, hookCtx(entrants, true, 5));
  assert.equal(second.events.some((e) => e.type === "breakaway_dropped"), false, "no second report for the same drop");
});

// ── Ren detektion (chaseGroup.ts) ────────────────────────────────────────────

test("breakawayDropEvents: a piece ahead of the break (an attack) is not dropped; a solo behind is", () => {
  const groups: RaceGroup[] = [
    { id: "solo-2000", kind: "solo", origin: "breakaway", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 },
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ["b", "c"], gap_seconds: 20, cohesion: 1 },
    { id: "solo-2001", kind: "solo", origin: "breakaway", rider_ids: ["d"], gap_seconds: 60, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: ["x", "y"], gap_seconds: 300, cohesion: 1 },
  ];
  const r = breakawayDropEvents(groups, [], 42);
  assert.deepEqual(r.events, [{ km: 42, type: "breakaway_dropped", params: { group_id: "solo-2001", from_group_id: "breakaway-0", rider_ids: ["d"] } }]);
  assert.deepEqual(r.dropped, ["d"]);
});

test("breakawayDropEvents: a rider back in the break leaves the list and can be dropped again; silent riders are listed without an event", () => {
  const back: RaceGroup[] = [{ id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ["b", "d"], gap_seconds: 0, cohesion: 1 }];
  assert.deepEqual(breakawayDropEvents(back, ["d"], 10).dropped, []);
  const again: RaceGroup[] = [back[0], { id: "chase-3000", kind: "chase", origin: "breakaway", rider_ids: ["e", "f"], gap_seconds: 30, cohesion: 1 }];
  const r = breakawayDropEvents(again, [], 30, (id) => id === "f");
  assert.deepEqual(r.events.map((e) => e.params.rider_ids), [["e"]]);
  assert.deepEqual(r.dropped, ["e", "f"]);
});

test("breakawayDropEvents: without a break nothing is reported and the known list is kept", () => {
  const caught: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ["a", "x"], gap_seconds: 0, cohesion: 1 }];
  assert.deepEqual(breakawayDropEvents(caught, ["d"], 10), { events: [], dropped: ["d"] });
});

test("isBreakawayPiece / rejoinBreakawayPiece", () => {
  assert.equal(isBreakawayPiece({ kind: "chase", origin: "breakaway" }), true);
  assert.equal(isBreakawayPiece({ kind: "breakaway", origin: "breakaway" }), false);
  assert.equal(isBreakawayPiece({ kind: "chase" }), false);
  const groups: RaceGroup[] = [
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 },
    { id: "chase-1", kind: "chase", origin: "breakaway", rider_ids: ["b", "c"], gap_seconds: 1, cohesion: 0.5 },
  ];
  assert.deepEqual(rejoinBreakawayPiece(groups, "chase-1", "breakaway-0"), [
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ["a", "b", "c"], gap_seconds: 0, cohesion: 0.5 },
  ]);
  assert.equal(groups.length, 2, "input is not mutated");
});

// ── Hele etapen under orders_gc_v3 ───────────────────────────────────────────

test("#6185/#6234 full stage under orders_gc_v3: drops reported at the split, no catch by escapees, a valid timeline, history uses the event", () => {
  let stagesWithDrops = 0;
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (let s = 0; s < 12; s++) {
      const out = stage(routeName, "orders_gc_v3", `6185-v3-${s}`);
      const events = out.timeline.events;
      assert.deepEqual(validateGroupMembership(events, out.groupSnapshots), [], `${routeName}/${s}: membership`);
      const knownRiderIds = new Set(field().map((e) => e.rider_id));
      assert.deepEqual(validateTimelineEvents(events, { distanceKm: ROUTES[routeName].distance_km, knownRiderIds }), [], `${routeName}/${s}: timeline`);
      const formed = events.find((e) => e.type === "breakaway_formed");
      if (!formed) continue;
      assert.equal(formed.params.drops_reported, true);
      const morning = new Set(formed.params.rider_ids as string[]);
      const drops = events.filter((e) => e.type === "breakaway_dropped");
      if (drops.length) stagesWithDrops++;
      const reported = new Set<string>();
      for (const drop of drops) {
        for (const id of drop.params.rider_ids as string[]) {
          assert.ok(morning.has(id), `${routeName}/${s}: ${id} was in the morning break`);
          reported.add(id);
        }
      }
      // Ingen indhentning foretaget af en gruppe der kun rummer udbrydere.
      for (const caught of events.filter((e) => e.type === "breakaway_caught")) {
        const split = events.find((e) => e.type === "peloton_splits" && e.params.group_id === caught.params.chase_group_id);
        if (split) assert.ok((split.params.rider_ids as string[]).some((id) => !morning.has(id)), `${routeName}/${s}: caught by escapees only at km ${caught.km}`);
      }
      // Historikken: kun motorens melding og uheld saetter af (ingen projektion fra splits).
      const history = deriveParticipationHistory(events);
      const incidentRiders = new Set(events.filter((e) => e.type === "incident").map((e) => e.params.rider_id));
      for (const id of morning) {
        const rider = history.riders.get(id);
        if (rider?.dropped && !incidentRiders.has(id)) assert.ok(reported.has(id), `${routeName}/${s}: ${id} dropped only by the engine's event`);
      }
    }
  }
  assert.ok(stagesWithDrops > 0, "the fixture stages must exercise a drop");
});

// ── Ren revision spor 1 (official_times_v3) ─────────────────────────────────
test("#6185 official_times_v3: en afsat udbryder har breakaway_dropped=true og er aldrig maerket 'ikke indhentet'", () => {
  let droppedRows = 0;
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (let s = 0; s < 12; s++) {
      const out = stage(routeName, "official_times_v3", `6185-v3-${s}`);
      const events = out.timeline.events;
      const formed = events.find((e) => e.type === "breakaway_formed");
      if (!formed) continue;
      assert.equal(formed.params.drops_reported, true, `${routeName}/${s}: v3 melder selv afsatte`);
      const ranked = rankedFromV4Output(out, { rulesRevision: "official_times_v3" });
      const history = deriveParticipationHistory(events, out.results.map((r) => r.rider_id));
      for (const row of ranked) {
        const status = (row as { breakaway_status?: { in_breakaway: boolean; breakaway_caught: boolean | null; breakaway_dropped: boolean } }).breakaway_status;
        if (!status?.in_breakaway) continue;
        const rider = history.riders.get(row.rider_id);
        // Historikken siger afsat -> raekken siger afsat.
        assert.equal(status.breakaway_dropped, rider?.dropped === true, `${routeName}/${s}: ${row.rider_id}`);
        if (status.breakaway_dropped) {
          droppedRows++;
          assert.notEqual(status.breakaway_caught, false, `${routeName}/${s}: ${row.rider_id} er sat af og maa aldrig staa som 'ikke indhentet'`);
        }
      }
    }
  }
  assert.ok(droppedRows > 0, "fixturen skal ramme en afsat udbryder under v3");
});

test("#6185: legacy/v1/v2 never report drops", () => {
  for (const revision of ["legacy", "orders_gc_v1", "orders_gc_v2"] as RulesRevision[]) {
    const out = stage("mountain", revision, "6185-v3-0");
    assert.equal(out.timeline.events.some((e) => e.type === "breakaway_dropped" || e.params.drops_reported !== undefined), false, revision);
  }
});
