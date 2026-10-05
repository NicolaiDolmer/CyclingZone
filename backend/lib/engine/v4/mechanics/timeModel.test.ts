// backend/lib/engine/v4/mechanics/timeModel.test.ts
// #6199 + #6200: kontrakt-tests for den faelles tidsmodel (KUN orders_gc_v3).
//   - A: hullet paa en stigning foelger laengde, stejlhed og evneforskel; de
//     afhaengte samles i faa grupper efter hullet; en tom reserve tvinger kun
//     af fra ca. kat. 2; rullende etaper faar den bloede selektion.
//   - B: grupper kan samles igen efter en top (nedkoersel og dal); udbruddet roeres ikke.
//   - 2: nedkoersel mod maal lukker hoejst loftet pr. km og hoejst halvdelen af hullet.
//   - Laasen: uden ordersGcV3 er hooksene uaendrede.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  climbSplitGapSeconds,
  climbTimeSeconds,
  clusterSplitRiders,
  finishDescentChaseCapSeconds,
  finishDescentClosingSeconds,
  finishDescentRemainingCapSeconds,
  isEscapeGroupV3,
  TIME_MODEL_V3_TUNING,
  valleyRegroupTempoV3,
  wprimeForcedCategoryAllowed,
} from "./timeModel.ts";
import { descentHook, finishDescentRegroupBook, regroupOnDescentV3 } from "./descent.ts";
import { selectionPhaseFor } from "./mountainSelection.ts";
import { finaleHook } from "../finale.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, EngineState, Entrant, RaceGroup, RiderState, RouteV2, Segment, SegmentHookContext } from "../types.ts";

const T = TIME_MODEL_V3_TUNING;

function group(id: string, gap: number, riderIds: string[], extra: Partial<RaceGroup> = {}): RaceGroup {
  return { id, kind: "peloton", rider_ids: riderIds, gap_seconds: gap, cohesion: 1, ...extra };
}

function entrantsWithDescending(map: Record<string, number>): Record<string, Entrant> {
  const out: Record<string, Entrant> = {};
  for (const [id, descending] of Object.entries(map)) {
    out[id] = { rider_id: id, abilities: { descending } } as unknown as Entrant;
  }
  return out;
}

// ── A: hullet paa en stigning ────────────────────────────────────────────────

test("A: stigningens tid vokser med laengde og stejlhed (fart clampet til baandet)", () => {
  assert.ok(climbTimeSeconds(7, 10) > climbTimeSeconds(7, 5));
  assert.ok(climbTimeSeconds(9, 8) > climbTimeSeconds(5, 8));
  assert.equal(climbTimeSeconds(0, 10), (10 / T.climbSpeedBoundsKmh[1]) * 3600);
  assert.equal(climbTimeSeconds(7, 0), 0);
});

test("A: hullet er monotont i laengde, stejlhed og underskud, og ligger altid i baandet", () => {
  const base = climbSplitGapSeconds(6, 6, 0.2, 0.5);
  assert.ok(climbSplitGapSeconds(6, 12, 0.2, 0.5) >= base, "laengere stigning, aldrig mindre hul");
  assert.ok(climbSplitGapSeconds(9, 6, 0.2, 0.5) >= base, "stejlere stigning, aldrig mindre hul");
  assert.ok(climbSplitGapSeconds(6, 6, 0.3, 0.5) >= base, "stoerre klatre-underskud, aldrig mindre hul");
  assert.ok(climbSplitGapSeconds(6, 6, 0.2, 0.9) >= base, "stoerre energi-underskud, aldrig mindre hul");
  for (const [g, km, d, e] of [[0, 0, 0, 0], [20, 30, 1, 1], [5, 1, 0.01, 0], [Number.NaN, 5, 0.1, 0.1]] as const) {
    const gap = climbSplitGapSeconds(g, km, d, e);
    assert.ok(gap >= T.climbGapBoundsSeconds[0] && gap <= T.climbGapBoundsSeconds[1], `${gap} i baandet`);
  }
});

test("A: en kort kat. 3 giver et mindre hul end en lang stigning for samme rytter (intet fast trin)", () => {
  assert.ok(climbSplitGapSeconds(5.8, 5.8, 0.15, 0.5) < climbSplitGapSeconds(8, 15, 0.15, 0.5));
});

test("A: de afhaengte samles i faa grupper; alle ryttere med, raekkefoelgen foelger hullet", () => {
  const riders = Array.from({ length: 40 }, (_, i) => ({ riderId: `r${String(i).padStart(2, "0")}`, gapSeconds: 5 + i * 9 }));
  const parts = clusterSplitRiders(riders);
  assert.ok(parts.length >= 2 && parts.length <= T.clusterMaxGroups);
  assert.deepEqual(parts.flatMap((p) => p.riderIds).sort(), riders.map((r) => r.riderId).sort());
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i].gapSeconds > parts[i - 1].gapSeconds);
  // En rytter med mindre hul ender aldrig i en gruppe laengere tilbage.
  const partOf = new Map(parts.flatMap((p, idx) => p.riderIds.map((id) => [id, idx] as const)));
  for (let i = 1; i < riders.length; i++) assert.ok(partOf.get(riders[i].riderId)! >= partOf.get(riders[i - 1].riderId)!);
});

test("A: ens huller giver én gruppe; tom liste giver ingen", () => {
  assert.equal(clusterSplitRiders([{ riderId: "a", gapSeconds: 30 }, { riderId: "b", gapSeconds: 31 }]).length, 1);
  assert.deepEqual(clusterSplitRiders([]), []);
});

test("A: en tom reserve tvinger kun af fra ca. kat. 2", () => {
  for (const c of ["HC", "1", "2"]) assert.equal(wprimeForcedCategoryAllowed(c), true, c);
  for (const c of ["3", "4", undefined]) assert.equal(wprimeForcedCategoryAllowed(c), false, String(c));
});

test("A: rullende etaper faar den bloede selektion kun under orders_gc_v3, og kun foer finalestigningen", () => {
  const segments = [
    { kind: "rolling", from_km: 0, to_km: 50 },
    { kind: "climb", from_km: 50, to_km: 53, category: "4", avg_gradient: 5, top_elevation_m: 300 },
    { kind: "rolling", from_km: 53, to_km: 100 },
    { kind: "climb", from_km: 100, to_km: 106, category: "3", avg_gradient: 6, top_elevation_m: 600 },
  ] as Segment[];
  const route = { profile_type: "rolling", segments } as never;
  assert.equal(selectionPhaseFor({ route, segmentIndex: 1 }), undefined, "uden v3: ingen fase");
  assert.equal(selectionPhaseFor({ route, segmentIndex: 1, ordersGcV3: true }), "pre_final");
  assert.equal(selectionPhaseFor({ route, segmentIndex: 3, ordersGcV3: true }), "final");
  const flat = { profile_type: "flat", segments } as never;
  assert.equal(selectionPhaseFor({ route: flat, segmentIndex: 1, ordersGcV3: true }), undefined, "kun rullende");
  assert.equal(selectionPhaseFor({ route: flat, segmentIndex: 1, mountainSelectionPhase: "pre_final" }), "pre_final", "segmentLoops fase vinder");
});

// ── B: grupper kan samles igen undervejs ─────────────────────────────────────

test("B: midtvejs-nedkoersel lukker et hul (aldrig forbi gruppen foran); udbruddet roeres ikke", () => {
  const entrants = entrantsWithDescending({ e1: 60, a1: 60, a2: 60, b1: 60 });
  const groups = [
    group("break", 0, ["e1"], { kind: "breakaway", origin: "breakaway" }),
    group("front", 120, ["a1", "a2"]),
    group("chase", 160, ["b1"], { kind: "chase" }),
  ];
  const out = regroupOnDescentV3(groups, entrants, 10, 2, false);
  const byId = new Map(out.map((g) => [g.id, g.gap_seconds]));
  assert.equal(byId.get("break"), 0, "udbruddet staar");
  assert.equal(byId.get("front"), 120, "gruppen bag udbruddet lukker ikke paa udbruddet");
  assert.ok(byId.get("chase")! < 160 && byId.get("chase")! >= 120, "jagten lukker, men aldrig forbi");
});

test("B: i dalen efter en top kan hullet ikke vokse inden for raekkevidden; det kan stadig krympe", () => {
  const segments = [
    { kind: "climb", from_km: 0, to_km: 5 },
    { kind: "descent", from_km: 5, to_km: 10 },
    { kind: "rolling", from_km: 10, to_km: 30 },
  ] as Segment[];
  const groups = [
    group("break", 0, ["e"], { kind: "breakaway", origin: "breakaway" }),
    group("front", 200, ["a"]),
    group("near", 230, ["b"], { kind: "chase" }),
    group("far", 230 + T.valleyReachSeconds + 50, ["c"], { kind: "gruppetto" }),
  ];
  const tempo = new Map([["break", { dtSeconds: 1000 }], ["front", { dtSeconds: 1010 }], ["near", { dtSeconds: 1030 }], ["far", { dtSeconds: 1060 }]]);
  const out = valleyRegroupTempoV3(groups, tempo, segments, 2, undefined);
  assert.equal(out.get("break")!.dtSeconds, 1000, "udbruddet roeres ikke");
  assert.equal(out.get("front")!.dtSeconds, 1010, "gruppen bag udbruddet maales ikke mod udbruddet");
  assert.equal(out.get("near")!.dtSeconds, 1010, "inden for raekkevidden: hullet vokser ikke");
  assert.equal(out.get("far")!.dtSeconds, 1060, "uden for raekkevidden: driver som foer");
  // Hurtigere bagfra: uroert (hullet kan krympe).
  const faster = new Map([["front", { dtSeconds: 1010 }], ["near", { dtSeconds: 1000 }]]);
  assert.equal(valleyRegroupTempoV3([group("front", 0, ["a"]), group("near", 20, ["b"])], faster, segments, 2, undefined), faster);
});

test("B: dal-reglen gaelder ikke foer etapens foerste stigning, paa en stigning eller for en uheldsjagt", () => {
  const segments = [
    { kind: "rolling", from_km: 0, to_km: 20 },
    { kind: "climb", from_km: 20, to_km: 25 },
    { kind: "rolling", from_km: 25, to_km: 40 },
  ] as Segment[];
  const groups = [group("front", 0, ["a"]), group("near", 30, ["b"])];
  const tempo = new Map([["front", { dtSeconds: 1000 }], ["near", { dtSeconds: 1020 }]]);
  assert.equal(valleyRegroupTempoV3(groups, tempo, segments, 0, undefined), tempo, "foer foerste stigning");
  assert.equal(valleyRegroupTempoV3(groups, tempo, segments, 1, undefined), tempo, "paa stigningen");
  assert.equal(valleyRegroupTempoV3(groups, tempo, segments, 2, { b: "alone" }), tempo, "uheldsjagt");
  assert.equal(valleyRegroupTempoV3(groups, tempo, segments, 2, undefined).get("near")!.dtSeconds, 1000);
});

test("udbruds-definitionen: kun dagens udbrud (oprindelse udbrud, art udbrud eller solo)", () => {
  assert.equal(isEscapeGroupV3({ kind: "breakaway", origin: "breakaway" }), true);
  assert.equal(isEscapeGroupV3({ kind: "solo", origin: "breakaway" }), true);
  assert.equal(isEscapeGroupV3({ kind: "chase", origin: "breakaway" }), false);
  assert.equal(isEscapeGroupV3({ kind: "breakaway", origin: "descent" }), false);
});

// ── 2: nedkoersel mod maal ───────────────────────────────────────────────────

test("2: nedkoersel mod maal lukker hoejst loftet pr. km og hoejst halvdelen af hullet", () => {
  const km = 8;
  for (const gap of [5, 20, 60, 300]) {
    for (const tech of [1, 2, 3]) {
      const closed = finishDescentClosingSeconds(gap, km, tech, 90, 40);
      assert.ok(closed <= T.finishDescentMaxSecondsPerKm * km + 1e-9, `${closed} <= loft pr. km`);
      assert.ok(closed <= gap * T.finishDescentMaxGapShare + 1e-9, `${closed} <= halvdelen af ${gap}`);
    }
  }
  assert.equal(finishDescentClosingSeconds(300, km, 3, 90, 40), T.finishDescentMaxSecondsPerKm * km, "klart bedre nedkoerer, teknisk vej: fuldt loft");
});

test("2: en jagt der ikke er den bedre nedkoerer lukker intet; mere teknik og stoerre forspring lukker mere", () => {
  assert.equal(finishDescentClosingSeconds(60, 8, 2, 50, 50), 0);
  assert.equal(finishDescentClosingSeconds(60, 8, 2, 40, 60), 0);
  assert.ok(finishDescentClosingSeconds(60, 8, 3, 60, 50) >= finishDescentClosingSeconds(60, 8, 1, 60, 50));
  assert.ok(finishDescentClosingSeconds(60, 8, 2, 70, 50) >= finishDescentClosingSeconds(60, 8, 2, 55, 50));
  assert.ok(finishDescentClosingSeconds(60, 12, 2, 70, 50) >= finishDescentClosingSeconds(60, 6, 2, 70, 50));
});

test("2: regrupperingen mod maal holder loftet for hver gruppe og bevarer raekkefoelgen", () => {
  const entrants = entrantsWithDescending({ a: 40, b: 90, c: 95 });
  const groups = [group("front", 0, ["a"]), group("g2", 60, ["b"], { kind: "chase" }), group("g3", 64, ["c"], { kind: "chase" })];
  const out = regroupOnDescentV3(groups, entrants, 8, 3, true);
  const byId = new Map(out.map((g) => [g.id, g.gap_seconds]));
  assert.ok(60 - byId.get("g2")! <= T.finishDescentMaxSecondsPerKm * 8 + 1e-9);
  assert.ok(byId.get("g2")! >= 30, "aldrig mere end halvdelen af hullet");
  assert.ok(byId.get("g3")! >= byId.get("g2")!, "raekkefoelgen er invariant");
});

test("2: finalens jagt paa nedkoerslen har samme loft", () => {
  assert.equal(finishDescentChaseCapSeconds(300, 8), T.finishDescentMaxSecondsPerKm * 8);
  assert.equal(finishDescentChaseCapSeconds(10, 8), 10 * T.finishDescentMaxGapShare);
  assert.equal(finishDescentChaseCapSeconds(0, 8), 0);
});

test("2: jagtens rest-loft traekker regrupperingen fra loftet paa hullet ved toppen", () => {
  // Hul 20 s ved toppen, 10 km: loftet er min(10, 15) = 10 s. Regrupperingen lukkede 9 s.
  assert.equal(finishDescentRemainingCapSeconds(11, 10, { topGapSeconds: 20, closedSeconds: 9 }), 1);
  // Regrupperingen brugte hele loftet: jagten faar intet.
  assert.equal(finishDescentRemainingCapSeconds(10, 10, { topGapSeconds: 20, closedSeconds: 10 }), 0);
  // Aldrig mere end loftet paa jagtens eget hul.
  assert.equal(finishDescentRemainingCapSeconds(4, 10, { topGapSeconds: 300, closedSeconds: 0 }), 2);
  // Uden regruppering: loftet paa det resterende hul.
  assert.equal(finishDescentRemainingCapSeconds(300, 8, null), finishDescentChaseCapSeconds(300, 8));
});

test("2: bogen over regrupperingen har kun grupper hvis hul blev lukket", () => {
  const before = [group("front", 0, ["a"]), group("g2", 60, ["b"]), group("g3", 90, ["c"])];
  const after = [group("front", 0, ["a"]), group("g2", 52, ["b"]), group("g3", 90, ["c"])];
  assert.deepEqual(finishDescentRegroupBook(before, after), { g2: { topGapSeconds: 60, closedSeconds: 8 } });
  assert.equal(finishDescentRegroupBook(before, before), null);
});

// Samlet invariant (review-fund paa #6199): regrupperingen (descentHook) og finalens
// jagt (finaleHook) koerer paa SAMME nedkoersel mod maal. Tilsammen maa de hoejst
// lukke min(halvdelen af hullet ved toppen, 1,5 s pr. km), ogsaa for en gruppe der
// baade er den bedre nedkoerer og har al jagtkraften.
const FULL_ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function fullEntrant(riderId: string, overrides: Partial<Record<AbilityKey, number>>): Entrant {
  const abilities = {} as Record<AbilityKey, number>;
  for (const key of FULL_ABILITY_KEYS) abilities[key] = overrides[key] ?? 50;
  return { rider_id: riderId, abilities, role: "free_role", effort: "normal", condition: 1 };
}

function riderState(riderId: string, groupId: string): RiderState {
  return {
    rider_id: riderId, group_id: groupId, cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  };
}

function runFinishDescent(topGap: number, km: number, ordersGcV3: boolean): { book: EngineState["finish_descent_regroup"]; chaseGap: number | null; finalState: EngineState } {
  const frontIds = ["f1", "f2", "f3"];
  const chaseIds = ["c1", "c2", "c3"];
  const entrants: Record<string, Entrant> = {};
  // Fronten: svage nedkoerere, svage forsvarere. Jagten: klart bedre nedkoerere med al jagtkraften.
  for (const id of frontIds) entrants[id] = fullEntrant(id, { descending: 40, tempo: 1, endurance: 1, durability: 1 });
  for (const id of chaseIds) entrants[id] = fullEntrant(id, { descending: 99, tempo: 99, endurance: 99, aggression: 99 });
  const riders: Record<string, RiderState> = {
    ...Object.fromEntries(frontIds.map((id) => [id, riderState(id, "front")])),
    ...Object.fromEntries(chaseIds.map((id) => [id, riderState(id, "chase")])),
  };
  const segments: Segment[] = [
    { kind: "climb", from_km: 0, to_km: 10, category: "1", avg_gradient: 7, top_elevation_m: 1500 },
    // Teknik 1: ingen nedkoerselsangreb, kun regruppering + finalens jagt.
    { kind: "descent", from_km: 10, to_km: 10 + km, technicality: 1 },
  ] as Segment[];
  const route: RouteV2 = {
    distance_km: 10 + km, profile_type: "hilly", finale_type: "descent", segments,
    weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [],
  };
  const ctx: SegmentHookContext = {
    ...makeHookCtx({ segment: segments[1], segmentIndex: 1, route, entrants, tuning: RACE_V4_TUNING, seed: "6199-descent-cap" }),
    ...(ordersGcV3 ? { ordersGcV3: true as const } : {}),
  };
  const state: EngineState = {
    km: 10,
    groups: [group("front", 0, frontIds), group("chase", topGap, chaseIds, { kind: "chase" })],
    riders,
    virtual_gc: Object.fromEntries([...frontIds, ...chaseIds].map((id) => [id, 0])),
  };
  const afterDescent = descentHook(state, ctx).state;
  const finalState = finaleHook(afterDescent, ctx).state;
  const chaseGroup = finalState.groups.find((g) => g.rider_ids.includes("c1"));
  const frontGroup = finalState.groups.find((g) => g.rider_ids.includes("f1"));
  const chaseGap = chaseGroup && frontGroup && chaseGroup.id !== frontGroup.id ? chaseGroup.gap_seconds - frontGroup.gap_seconds : null;
  return { book: afterDescent.finish_descent_regroup, chaseGap, finalState };
}

test("2: regruppering + finalens jagt lukker tilsammen hoejst loftet paa hullet ved toppen", () => {
  for (const km of [3, 8, 15]) {
    for (const topGap of [8, 12, 20, 40, 120, 600]) {
      const { book, chaseGap, finalState } = runFinishDescent(topGap, km, true);
      const cap = finishDescentChaseCapSeconds(topGap, km);
      assert.ok(book?.chase && book.chase.closedSeconds > 0, `regrupperingen lukkede noget (hul ${topGap}, ${km} km)`);
      assert.notEqual(chaseGap, null, `jagten foldes ikke ind (hul ${topGap}, ${km} km)`);
      const closed = topGap - chaseGap!;
      assert.ok(closed <= cap + 0.02, `lukket ${closed} <= loft ${cap} (hul ${topGap}, ${km} km)`);
      assert.ok(closed <= topGap * T.finishDescentMaxGapShare + 0.02, `aldrig mere end halvdelen af ${topGap}`);
      assert.equal(finalState.finish_descent_regroup, undefined, "bogen er brugt op i finalen");
    }
  }
});

test("2: uden orders_gc_v3 bogfoeres intet", () => {
  assert.equal(runFinishDescent(40, 8, false).book, undefined);
});

test("2: klatring taeller med i placeringen i en nedkoerselsfinale", () => {
  assert.ok((T.descentFinaleDemand.climbing ?? 0) > 0);
  assert.ok((T.descentFinaleDemand.descending ?? 0) > 0);
  const sum = Object.values(T.descentFinaleDemand).reduce((a, b) => a + (b ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "vaegtene summer til 1 som de oevrige finale-typer");
});

test("tuning er deep-frosset", () => {
  assert.ok(Object.isFrozen(T));
  assert.ok(Object.isFrozen(T.climbSpeedBoundsKmh));
  assert.ok(Object.isFrozen(T.descentFinaleDemand));
});
