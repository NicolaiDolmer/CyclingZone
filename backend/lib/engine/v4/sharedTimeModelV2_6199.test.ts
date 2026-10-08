// #6199 (owner 8/10): official_times_v2 = orders_gc_v3 + the shared time model.
// Deterministic regressions for the calibrated path: the summit-finish climb
// spreads the whole group by each rider's own deficit, selective finales keep
// physical time tiers, and only official_times_v2 reads the calibrated tuning.
import test from "node:test";
import assert from "node:assert/strict";
import { finaleHook } from "./finale.ts";
import { initRiderStates } from "./groups.ts";
import { climbSelectionHook, isSummitFinishClimb } from "./mechanics/climbSelection.ts";
import { SHARED_TIME_MODEL_V2_TUNING, TIME_MODEL_V3_TUNING, timeModelTuningFor, valleyRegroupTempoV3 } from "./mechanics/timeModel.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RouteV2, Segment, SegmentHookContext } from "./types.ts";

const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];

function fixture(climbing: number[], route: RouteV2, segmentIndex = route.segments.length - 1) {
  const entrants: Entrant[] = climbing.map((value, i) => ({
    rider_id: "r" + i,
    abilities: Object.fromEntries(keys.map((k) => [k, k === "climbing" ? value : 60])) as Entrant["abilities"],
    role: "free_role", effort: "normal", condition: 1,
  }));
  const riders = initRiderStates(entrants, RACE_V4_TUNING, "6199-v2");
  for (const r of Object.values(riders)) { r.wprime = 1; r.wprimeMax = 1; }
  const tuning = structuredClone(RACE_V4_TUNING);
  tuning.selection.noiseSdBase = 0;
  const ctx = makeHookCtx({ segment: route.segments[segmentIndex], segmentIndex, route,
    entrants: Object.fromEntries(entrants.map((e) => [e.rider_id, e])), tuning, seed: "6199-v2" });
  return { riders, ctx };
}

const climb = (from: number, to: number, category: Segment extends { category?: infer C } ? C : never = "1" as never): Segment =>
  ({ kind: "climb", from_km: from, to_km: to, category, avg_gradient: 8, top_elevation_m: 1500 } as Segment);
const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const summitRoute = (): RouteV2 => ({ distance_km: 40, profile_type: "mountain", finale_type: "long_climb",
  segments: [flat(0, 20), climb(20, 30), climb(30, 40)], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] } as RouteV2);

function stateWith(riders: EngineState["riders"], groups: RaceGroup[]): EngineState {
  const next = structuredClone(riders);
  for (const g of groups) for (const id of g.rider_ids) next[id].group_id = g.id;
  return { km: 0, groups: structuredClone(groups), riders: next, virtual_gc: {} };
}

const v2Ctx = (ctx: SegmentHookContext, groups: RaceGroup[]): SegmentHookContext =>
  ({ ...ctx, ordersGcV3: true, sharedGroupTime: { entryGroups: groups, incidentCursor: 0 } });
const v3Ctx = (ctx: SegmentHookContext): SegmentHookContext => ({ ...ctx, ordersGcV3: true });

const gapByRider = (state: EngineState): Map<string, number> =>
  new Map(state.groups.flatMap((g) => g.rider_ids.map((id) => [id, g.gap_seconds] as const)));

test("#6199 v2: only official_times_v2 (v3 + shared clock) reads the calibrated time model", () => {
  assert.equal(timeModelTuningFor({}), TIME_MODEL_V3_TUNING);
  assert.equal(timeModelTuningFor({ ordersGcV3: true }), TIME_MODEL_V3_TUNING);
  assert.equal(timeModelTuningFor({ sharedGroupTime: { entryGroups: [] } }), TIME_MODEL_V3_TUNING, "official_times_v1 keeps the v3 numbers");
  assert.equal(timeModelTuningFor({ ordersGcV3: true, sharedGroupTime: { entryGroups: [] } }), SHARED_TIME_MODEL_V2_TUNING);
  assert.equal(TIME_MODEL_V3_TUNING.climbGapAbilityWeightQuadratic, 0, "the v3 gap stays linear");
  assert.deepEqual(Object.keys(SHARED_TIME_MODEL_V2_TUNING).sort(), Object.keys(TIME_MODEL_V3_TUNING).sort());
  // The knobs that only official_times_v2 reads are neutral in the v3 numbers.
  assert.equal(TIME_MODEL_V3_TUNING.letGoMaxGapScale, 1);
  assert.equal(TIME_MODEL_V3_TUNING.valleyClosingSecondsPerKm, 0);
  assert.equal(TIME_MODEL_V3_TUNING.valleyClosingGapFractionPerKm, 0);
  assert.deepEqual(TIME_MODEL_V3_TUNING.climbGapAbilityWeightByProfile, {});
});

test("#6199 v2: the climb-gap weight can differ per stage profile, only under official_times_v2", () => {
  const shared = { ordersGcV3: true as const, sharedGroupTime: { entryGroups: [] } };
  for (const [profile, weight] of Object.entries(SHARED_TIME_MODEL_V2_TUNING.climbGapAbilityWeightByProfile)) {
    const t = timeModelTuningFor({ ...shared, route: { profile_type: profile as RouteV2["profile_type"] } });
    assert.equal(t.climbGapAbilityWeight, weight, profile);
    assert.equal(timeModelTuningFor({ ordersGcV3: true, route: { profile_type: profile as RouteV2["profile_type"] } }), TIME_MODEL_V3_TUNING);
  }
  assert.equal(timeModelTuningFor({ ...shared, route: { profile_type: "high_mountain" } }), SHARED_TIME_MODEL_V2_TUNING);
});

test("#6199 v2: in the valley the group behind closes as speed, never more than the gap; v3 only stops growth", () => {
  const segments = [
    { kind: "climb", from_km: 0, to_km: 5 },
    { kind: "descent", from_km: 5, to_km: 10 },
    { kind: "rolling", from_km: 10, to_km: 30 },
  ] as Segment[];
  const g = (id: string, gap: number, size: number): RaceGroup =>
    ({ id, kind: "chase", gap_seconds: gap, cohesion: 1, rider_ids: Array.from({ length: size }, (_, i) => `${id}${i}`) });
  const groups = [g("front", 0, 10), g("near", 30, 20), g("small", 60, 2)];
  const tempo = new Map([["front", { dtSeconds: 1000 }], ["near", { dtSeconds: 1010 }], ["small", { dtSeconds: 1015 }]]);
  const v3 = valleyRegroupTempoV3(groups, tempo, segments, 2, undefined);
  assert.equal(v3.get("near")!.dtSeconds, 1000, "v3: the gap does not grow");
  const t = SHARED_TIME_MODEL_V2_TUNING;
  const v2 = valleyRegroupTempoV3(groups, tempo, segments, 2, undefined, t);
  const nearClosing = Math.min(30, 20 * (t.valleyClosingSecondsPerKm + t.valleyClosingGapFractionPerKm * 30));
  assert.equal(v2.get("near")!.dtSeconds, 1000 - nearClosing, "v2: a larger group behind closes at the full rate");
  const smallClosing = Math.min(30, 20 * (t.valleyClosingSecondsPerKm + t.valleyClosingGapFractionPerKm * 30) * (2 / 20));
  assert.equal(v2.get("small")!.dtSeconds, v2.get("near")!.dtSeconds - smallClosing, "a small group behind a large one closes in proportion to its numbers");
  const touching = valleyRegroupTempoV3([g("front", 0, 10), g("near", 5, 20)], new Map([["front", { dtSeconds: 1000 }], ["near", { dtSeconds: 1000 }]]), segments, 2, undefined, t);
  assert.equal(touching.get("near")!.dtSeconds, 995, "closing never passes the group ahead: contact, not overtaking");
});

test("#6199 v2: the summit climb block is the last run of climbs on a long_climb finale", () => {
  const route = summitRoute();
  assert.deepEqual([0, 1, 2].map((segmentIndex) => isSummitFinishClimb({ route, segmentIndex })), [false, true, true]);
  assert.equal(isSummitFinishClimb({ route: { ...route, finale_type: "punch" }, segmentIndex: 2 }), false);
  assert.equal(isSummitFinishClimb({ route: { ...route, segments: [...route.segments, flat(40, 45)] }, segmentIndex: 2 }), false);
  // The owner's short uphill finish (about 3-7 km at 5-7 %) is ridden as a group, not a summit race.
  const short = { ...route, segments: [flat(0, 34), { ...climb(34, 40), avg_gradient: 6 } as Segment] } as RouteV2;
  assert.equal(isSummitFinishClimb({ route: short, segmentIndex: 1 }), false);
  const steep = { ...route, segments: [flat(0, 34), { ...climb(34, 40), avg_gradient: 9 } as Segment] } as RouteV2;
  assert.equal(isSummitFinishClimb({ route: steep, segmentIndex: 1 }), true);
});

test("#6199 v2: on the summit climb every rider loses his own deficit time, ordered by ability", () => {
  const climbing = [80, 79, 76, 72, 68, 62];
  const { riders, ctx } = fixture(climbing, summitRoute());
  const groups: RaceGroup[] = [{ id: "front", kind: "peloton", rider_ids: climbing.map((_, i) => "r" + i), gap_seconds: 0, cohesion: 1 }];
  const v2 = climbSelectionHook(stateWith(riders, groups), v2Ctx(ctx, groups));
  const gaps = gapByRider(v2.state);
  assert.equal(gaps.get("r0"), 0, "the best climber leads");
  for (let i = 1; i < climbing.length; i++) assert.ok(gaps.get("r" + i)! >= gaps.get("r" + (i - 1))!, `r${i} is never ahead of a better climber`);
  assert.ok(gaps.get("r5")! > gaps.get("r2")!, "a larger deficit costs more time");
  // Control: the v3 threshold model keeps the near-equal riders on the wheel.
  const v3 = climbSelectionHook(stateWith(riders, groups), v3Ctx(ctx));
  const v3Gaps = gapByRider(v3.state);
  const keptV3 = [...v3Gaps].filter(([, g]) => g === 0).length;
  const keptV2 = [...gaps].filter(([, g]) => g === 0).length;
  assert.ok(keptV2 < keptV3, "the summit race separates riders the threshold model keeps together");
});

test("#6199 v2: climbs before the summit block keep the threshold selection", () => {
  const climbing = [80, 79, 76, 72, 68, 62];
  const route = { ...summitRoute(), finale_type: "punch" } as RouteV2;
  const { riders, ctx } = fixture(climbing, route);
  const groups: RaceGroup[] = [{ id: "front", kind: "peloton", rider_ids: climbing.map((_, i) => "r" + i), gap_seconds: 0, cohesion: 1 }];
  const splitSet = (state: EngineState) => [...gapByRider(state)].filter(([, g]) => g > 0).map(([id]) => id).sort();
  assert.deepEqual(splitSet(climbSelectionHook(stateWith(riders, groups), v2Ctx(ctx, groups)).state),
    splitSet(climbSelectionHook(stateWith(riders, groups), v3Ctx(ctx)).state));
});

test("#6199 v2: a selective finale keeps physical time tiers, never behind a surviving group", () => {
  const climbing = [80, 78, 76, 74, 72, 70];
  const { riders, ctx } = fixture(climbing, summitRoute());
  const groups: RaceGroup[] = [
    { id: "front", kind: "peloton", rider_ids: ["r0", "r1", "r2", "r3", "r4"], gap_seconds: 0, cohesion: 1 },
    { id: "back", kind: "solo", rider_ids: ["r5"], gap_seconds: 4, cohesion: 1 },
  ];
  const out = finaleHook(stateWith(riders, groups), v2Ctx(ctx, groups)).state;
  const backGap = out.groups.find((g) => g.rider_ids.includes("r5"))!.gap_seconds;
  const frontTiers = out.groups.filter((g) => !g.rider_ids.includes("r5"));
  assert.ok(frontTiers.length > 1, "the front pool is not one shared time on a summit finish");
  for (const tier of frontTiers) assert.ok(tier.gap_seconds < backGap, "no tier finishes behind the group it never passed");
  assert.equal(out.finish_order?.at(-1), "r5");
  // official_times_v1 (shared clock without the v3 package) keeps one pool.
  const v1 = finaleHook(stateWith(riders, groups), { ...ctx, sharedGroupTime: { entryGroups: groups, incidentCursor: 0 } }).state;
  assert.equal(v1.groups.filter((g) => !g.rider_ids.includes("r5")).length, 1);
});

test("#6199 v2: a mass finish still shares one time", () => {
  const climbing = [80, 78, 76, 74];
  const route: RouteV2 = { distance_km: 20, profile_type: "flat", finale_type: "bunch_sprint",
    segments: [flat(0, 20)], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] } as RouteV2;
  const { riders, ctx } = fixture(climbing, route);
  const groups: RaceGroup[] = [{ id: "front", kind: "peloton", rider_ids: ["r0", "r1", "r2", "r3"], gap_seconds: 0, cohesion: 1 }];
  const out = finaleHook(stateWith(riders, groups), v2Ctx(ctx, groups)).state;
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0].gap_seconds, 0);
});

test("#6199 v2: on a flat mass finish the field's numbers are closing speed over the final km, capped per km", () => {
  const n = 40;
  const route: RouteV2 = { distance_km: 184, profile_type: "flat", finale_type: "bunch_sprint",
    segments: [flat(0, 180), flat(180, 184)], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] } as RouteV2;
  const { riders, ctx } = fixture(Array.from({ length: n }, () => 50), route);
  const breakIds = ["r0", "r1", "r2"];
  const fieldIds = Array.from({ length: n - 3 }, (_, i) => "r" + (i + 3));
  const run = (gap: number, c: SegmentHookContext) => {
    const groups: RaceGroup[] = [
      { id: "break", kind: "breakaway", origin: "breakaway", rider_ids: breakIds, gap_seconds: 0, cohesion: 1 },
      { id: "field", kind: "peloton", rider_ids: fieldIds, gap_seconds: gap, cohesion: 1 },
    ];
    return finaleHook(stateWith(riders, groups), c === ctx ? v2Ctx(ctx, groups) : { ...c, sharedGroupTime: { entryGroups: groups, incidentCursor: 0 } }).state;
  };
  const caught = (state: EngineState) => state.groups.length === 1;
  const perKmCap = SHARED_TIME_MODEL_V2_TUNING.bunchClosingMaxSecondsPerKm * 4;
  assert.equal(caught(run(perKmCap * 0.5, ctx)), true, "a break within the field's closing capacity is caught by contact");
  assert.equal(caught(run(perKmCap * 1.5, ctx)), false, "a lead beyond the per-km capacity survives: no catch window");
  // official_times_v1 (shared clock without the v3 package) keeps its prototype finale.
  assert.equal(caught(run(perKmCap * 0.5, { ...ctx })), false);
});
