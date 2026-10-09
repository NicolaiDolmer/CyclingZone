// #6200: official_times_v3 (switched off) = official_times_v2 + the descent
// finish on mountain stages. Two rules, owner contract on #6199/#6200:
//   1. The last climb before a descent finish is raced like a summit finish:
//      every rider loses the time his own deficit gives, so a clearly better
//      climber rides away and never loses time to a worse one on the climb.
//   2. The descent to the line closes at most the cap per km and at most a share
//      of the gap at the top, also when a short stretch without climbing follows
//      the descent (the cap runs from the top to the line).
// official_times_v2 stays byte-identical (officialTimesV2Frozen6200.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURRENT_RACE_RULES_REVISION,
  isKnownRulesRevision,
  isOrdersGcV3OrLater,
  ordersGcGeneration,
  preservesOfficialStageTimes,
  sharedTimeModelGeneration,
  usesSharedGroupTime,
} from "../../raceEngineRulesRevision.ts";
import { initRiderStates } from "./groups.ts";
import { climbSelectionHook, isDescentFinishDecidingClimb } from "./mechanics/climbSelection.ts";
import {
  SHARED_TIME_MODEL_V2_TUNING,
  SHARED_TIME_MODEL_V3_TUNING,
  TIME_MODEL_V3_TUNING,
  finishDescentChaseCapSeconds,
  finishDescentIndexFor,
  runInOpenOnlyTempo,
  timeModelTuningFor,
} from "./mechanics/timeModel.ts";
import { normalizeRulesRevision } from "./segmentLoop.ts";
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import { digestOf, frozenStageOutput } from "./testUtils/oldRevisionDigests6199.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RouteV2, Segment, SegmentHookContext } from "./types.ts";

// ── Revision contract ─────────────────────────────────────────────────────────

test("#6200: official_times_v3 is a known, switched-off revision of the official-times line", () => {
  assert.equal(isKnownRulesRevision("official_times_v3"), true);
  assert.equal(normalizeRulesRevision("official_times_v3"), "official_times_v3");
  assert.equal(CURRENT_RACE_RULES_REVISION, "official_times_v2", "new races still bind to official_times_v2");
  assert.equal(ordersGcGeneration("official_times_v3"), 3);
  assert.equal(isOrdersGcV3OrLater("official_times_v3"), true);
  assert.equal(usesSharedGroupTime("official_times_v3"), true);
  assert.equal(preservesOfficialStageTimes("official_times_v3"), true);
  assert.equal(sharedTimeModelGeneration("official_times_v3"), 3);
  for (const older of ["legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", null, undefined, "x"]) {
    assert.equal(sharedTimeModelGeneration(older), 0, String(older));
  }
});

test("#6200: only official_times_v3 (generation 3 on the shared clock) reads the v3 time model", () => {
  const shared = { ordersGcV3: true as const, sharedGroupTime: { entryGroups: [] } };
  assert.equal(timeModelTuningFor(shared), SHARED_TIME_MODEL_V2_TUNING);
  assert.equal(timeModelTuningFor({ ...shared, sharedGroupTime: { entryGroups: [], timeModelGeneration: 3 } }), SHARED_TIME_MODEL_V3_TUNING);
  assert.equal(timeModelTuningFor({ sharedGroupTime: { timeModelGeneration: 3 } }), TIME_MODEL_V3_TUNING, "without the v3 package nothing changes");
  // The v3 model is official_times_v2 plus exactly the two descent-finish knobs.
  const changed = Object.keys(SHARED_TIME_MODEL_V3_TUNING).filter((k) =>
    JSON.stringify((SHARED_TIME_MODEL_V3_TUNING as Record<string, unknown>)[k]) !== JSON.stringify((SHARED_TIME_MODEL_V2_TUNING as Record<string, unknown>)[k]));
  assert.deepEqual(changed.sort(), ["descentFinishClimbRaceProfiles", "finishDescentMaxRunInKm"]);
  // Neutral in every older model.
  for (const t of [TIME_MODEL_V3_TUNING, SHARED_TIME_MODEL_V2_TUNING]) {
    assert.deepEqual(t.descentFinishClimbRaceProfiles, []);
    assert.equal(t.finishDescentMaxRunInKm, 0);
  }
  // Per-profile calibration of official_times_v2 is kept under v3.
  for (const [profile, weight] of Object.entries(SHARED_TIME_MODEL_V2_TUNING.climbGapAbilityWeightByProfile)) {
    const t = timeModelTuningFor({ ...shared, sharedGroupTime: { entryGroups: [], timeModelGeneration: 3 }, route: { profile_type: profile as RouteV2["profile_type"] } });
    assert.equal(t.climbGapAbilityWeight, weight, profile);
    assert.equal(t.finishDescentMaxRunInKm, SHARED_TIME_MODEL_V3_TUNING.finishDescentMaxRunInKm, profile);
  }
});

// ── Route shapes ──────────────────────────────────────────────────────────────

const climb = (from: number, to: number, avg_gradient = 8): Segment =>
  ({ kind: "climb", from_km: from, to_km: to, category: "1", avg_gradient, top_elevation_m: 1500 } as Segment);
const descent = (from: number, to: number): Segment => ({ kind: "descent", from_km: from, to_km: to, technicality: 2 } as Segment);
const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const rolling = (from: number, to: number): Segment => ({ kind: "rolling", from_km: from, to_km: to } as Segment);
const route = (segments: Segment[], profile_type: RouteV2["profile_type"] = "mountain", finale_type: RouteV2["finale_type"] = "descent"): RouteV2 =>
  ({ distance_km: segments[segments.length - 1].to_km, profile_type, finale_type, segments, weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] } as RouteV2);

test("#6200: the finish descent is the last segment, or under v3 the descent before a short stretch without climbing", () => {
  const v3 = SHARED_TIME_MODEL_V3_TUNING;
  const runIn = v3.finishDescentMaxRunInKm;
  const last = route([flat(0, 20), climb(20, 30), descent(30, 40)]);
  assert.equal(finishDescentIndexFor(last), 2);
  assert.equal(finishDescentIndexFor(last, v3), 2);
  const short = route([flat(0, 20), climb(20, 30), descent(30, 40), rolling(40, 40 + runIn)]);
  assert.equal(finishDescentIndexFor(short), -1, "older revisions: only a descent that is the last segment");
  assert.equal(finishDescentIndexFor(short, SHARED_TIME_MODEL_V2_TUNING), -1);
  assert.equal(finishDescentIndexFor(short, v3), 2);
  assert.equal(finishDescentIndexFor(route([flat(0, 20), climb(20, 30), descent(30, 40), rolling(40, 41), flat(41, 40 + runIn)]), v3), 2);
  assert.equal(finishDescentIndexFor(route([flat(0, 20), climb(20, 30), descent(30, 40), rolling(40, 40 + runIn + 1)]), v3), -1, "a long run-in is a valley, not the finish descent");
  assert.equal(finishDescentIndexFor(route([climb(0, 10), descent(10, 20), climb(20, 22)]), v3), -1, "a climb after the descent");
  assert.equal(finishDescentIndexFor({ ...short, finale_type: "punch" }, v3), -1, "only on a descent finale");
});

test("#6200: the deciding climb is the last climb block before a descent finish on a v3 mountain profile", () => {
  const v3 = SHARED_TIME_MODEL_V3_TUNING;
  const r = route([climb(0, 10), descent(10, 20), flat(20, 40), climb(40, 46), climb(46, 52), descent(52, 64), rolling(64, 66)]);
  assert.deepEqual(r.segments.map((_, segmentIndex) => isDescentFinishDecidingClimb({ route: r, segmentIndex }, v3)),
    [false, false, false, true, true, false, false]);
  assert.equal(isDescentFinishDecidingClimb({ route: r, segmentIndex: 3 }, SHARED_TIME_MODEL_V2_TUNING), false, "official_times_v2 keeps the threshold selection");
  assert.equal(isDescentFinishDecidingClimb({ route: { ...r, finale_type: "long_climb" }, segmentIndex: 3 }, v3), false);
  assert.equal(isDescentFinishDecidingClimb({ route: { ...r, profile_type: "hilly" }, segmentIndex: 3 }, v3), false, "only the mountain profiles");
  assert.equal(isDescentFinishDecidingClimb({ route: { ...r, profile_type: "high_mountain" }, segmentIndex: 4 }, v3), true);
});

// ── 1: the better climber rides away on the deciding climb ────────────────────

const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];

function climbFixture(climbing: number[], r: RouteV2, segmentIndex: number) {
  const entrants: Entrant[] = climbing.map((value, i) => ({
    rider_id: "r" + i,
    abilities: Object.fromEntries(keys.map((k) => [k, k === "climbing" ? value : 60])) as Entrant["abilities"],
    role: "free_role", effort: "normal", condition: 1,
  }));
  const riders = initRiderStates(entrants, RACE_V4_TUNING, "6200-v3");
  for (const rider of Object.values(riders)) { rider.wprime = 1; rider.wprimeMax = 1; }
  const tuning = structuredClone(RACE_V4_TUNING);
  tuning.selection.noiseSdBase = 0;
  const ctx = makeHookCtx({ segment: r.segments[segmentIndex], segmentIndex, route: r,
    entrants: Object.fromEntries(entrants.map((e) => [e.rider_id, e])), tuning, seed: "6200-v3" });
  return { riders, ctx };
}

function stateWith(riders: EngineState["riders"], groups: RaceGroup[]): EngineState {
  const next = structuredClone(riders);
  for (const g of groups) for (const id of g.rider_ids) next[id].group_id = g.id;
  return { km: 0, groups: structuredClone(groups), riders: next, virtual_gc: {} };
}

const sharedCtx = (ctx: SegmentHookContext, groups: RaceGroup[], generation?: 3): SegmentHookContext =>
  ({ ...ctx, ordersGcV3: true, sharedGroupTime: { entryGroups: groups, incidentCursor: 0, ...(generation ? { timeModelGeneration: generation } : {}) } });

const gapByRider = (state: EngineState): Map<string, number> =>
  new Map(state.groups.flatMap((g) => g.rider_ids.map((id) => [id, g.gap_seconds] as const)));

test("#6200 v3: on the climb before a descent finish a better climber never loses time to a worse one", () => {
  const climbing = [82, 80, 79, 77, 76, 74, 73, 71, 70, 68, 66, 63];
  const r = route([flat(0, 30), climb(30, 42), descent(42, 54)]);
  const { riders, ctx } = climbFixture(climbing, r, 1);
  const groups: RaceGroup[] = [{ id: "front", kind: "peloton", rider_ids: climbing.map((_, i) => "r" + i), gap_seconds: 0, cohesion: 1 }];
  const v3 = gapByRider(climbSelectionHook(stateWith(riders, groups), sharedCtx(ctx, groups, 3)).state);
  assert.equal(v3.get("r0"), 0, "the best climber leads over the top");
  for (let i = 1; i < climbing.length; i++) assert.ok(v3.get("r" + i)! >= v3.get("r" + (i - 1))!, `r${i} is never ahead of a better climber`);
  assert.ok(v3.get("r11")! > v3.get("r3")!, "a larger deficit costs more time");
  // Control: official_times_v2 keeps the threshold selection on this climb, so
  // more riders come over the top together.
  const v2 = gapByRider(climbSelectionHook(stateWith(riders, groups), sharedCtx(ctx, groups)).state);
  const together = (gaps: Map<string, number>) => [...gaps.values()].filter((g) => g === 0).length;
  assert.ok(together(v3) < together(v2), "v3 separates riders official_times_v2 keeps on the wheel");
});

test("#6200 v3: earlier climbs and non-mountain descent finishes keep the official_times_v2 selection", () => {
  const climbing = [82, 80, 79, 77, 76, 74];
  const splitSet = (state: EngineState) => [...gapByRider(state)].filter(([, g]) => g > 0).map(([id]) => id).sort();
  const groups: RaceGroup[] = [{ id: "front", kind: "peloton", rider_ids: climbing.map((_, i) => "r" + i), gap_seconds: 0, cohesion: 1 }];
  const earlier = route([climb(0, 12), descent(12, 20), flat(20, 40), climb(40, 50), descent(50, 60)]);
  const a = climbFixture(climbing, earlier, 0);
  assert.deepEqual(splitSet(climbSelectionHook(stateWith(a.riders, groups), sharedCtx(a.ctx, groups, 3)).state),
    splitSet(climbSelectionHook(stateWith(a.riders, groups), sharedCtx(a.ctx, groups)).state));
  const hilly = route([flat(0, 30), climb(30, 42), descent(42, 54)], "hilly");
  const b = climbFixture(climbing, hilly, 1);
  assert.deepEqual(splitSet(climbSelectionHook(stateWith(b.riders, groups), sharedCtx(b.ctx, groups, 3)).state),
    splitSet(climbSelectionHook(stateWith(b.riders, groups), sharedCtx(b.ctx, groups)).state));
});

// ── 2: the run-in after the finish descent never closes a gap ─────────────────

test("#6200 v3: on the run-in after the finish descent tempo can open a gap, never close one", () => {
  const g = (id: string, gap: number, size: number, prefix = id): RaceGroup =>
    ({ id, kind: "chase", gap_seconds: gap, cohesion: 1, rider_ids: Array.from({ length: size }, (_, i) => `${prefix}${i}`) });
  const groups = [g("front", 0, 2), g("big", 30, 20), g("slow", 60, 3), g("fast", 90, 5)];
  const tempo = new Map([["front", { dtSeconds: 200 }], ["big", { dtSeconds: 190 }], ["slow", { dtSeconds: 230 }], ["fast", { dtSeconds: 210 }]]);
  const out = runInOpenOnlyTempo(groups, tempo, undefined);
  assert.equal(out.get("front")!.dtSeconds, 200);
  assert.equal(out.get("big")!.dtSeconds, 200, "a larger, faster group behind does not close");
  assert.equal(out.get("slow")!.dtSeconds, 230, "a slower group loses time");
  assert.equal(out.get("fast")!.dtSeconds, 230, "never faster than the group ahead of it");
  const unchanged = new Map([["front", { dtSeconds: 200 }], ["big", { dtSeconds: 205 }]]);
  assert.equal(runInOpenOnlyTempo([g("front", 0, 2), g("big", 30, 20)], unchanged, undefined), unchanged, "same map when nothing changes");
  // A group in an incident chase keeps its own tempo and is no reference.
  const chasers = { chase0: true };
  const withChase = runInOpenOnlyTempo([g("front", 0, 2), g("chase", 20, 1), g("big", 30, 20)],
    new Map([["front", { dtSeconds: 200 }], ["chase", { dtSeconds: 150 }], ["big", { dtSeconds: 195 }]]), chasers);
  assert.equal(withChase.get("chase")!.dtSeconds, 150);
  assert.equal(withChase.get("big")!.dtSeconds, 200);
});

// ── Whole stages: real proxy shapes, the varied frozen field, AI orders ───────

type StageRow = { profile_type: string; finale_type?: string; stage_number?: number } & Record<string, unknown>;
const SEEDS = ["6200-frozen-a", "6200-frozen-b"] as const;

function proxyRows(): StageRow[] {
  const raw = JSON.parse(readFileSync(new URL("../../../scripts/baselines/v4-proxy-stages-2026-09-06.json", import.meta.url), "utf8"));
  return Array.isArray(raw) ? raw : raw.stages;
}

test("#6200 v3: every stage that is not a mountain descent finish is byte-identical to official_times_v2", () => {
  const rows = proxyRows().filter((row) => !(row.finale_type === "descent" && (row.profile_type === "mountain" || row.profile_type === "high_mountain")));
  const shapes = new Map<string, StageRow>();
  for (const row of rows) if (!shapes.has(`${row.profile_type}/${row.finale_type}`)) shapes.set(`${row.profile_type}/${row.finale_type}`, row);
  assert.ok(shapes.size >= 15, "every other stage shape is covered");
  for (const row of shapes.values()) {
    for (const seed of SEEDS) {
      assert.equal(digestOf(frozenStageOutput(row, seed, "official_times_v3")), digestOf(frozenStageOutput(row, seed, "official_times_v2")),
        `${row.profile_type}/${row.finale_type}#${row.stage_number}@${seed}`);
    }
  }
});

test("#6200 v3: on every descent finish the 10th rider's gap at the top closes at most the cap (per km and share)", () => {
  const rows = proxyRows().filter((row) => row.finale_type === "descent");
  assert.ok(rows.length >= 10);
  let measured = 0;
  for (const row of rows) {
    const segs = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]).segments;
    const lastClimb = segs.map((s) => s.kind).lastIndexOf("climb");
    const kmFromTop = segs[segs.length - 1].to_km - segs[lastClimb].to_km;
    for (const seed of SEEDS) {
      const out = frozenStageOutput(row, seed, "official_times_v3");
      const top = out.groupSnapshots[lastClimb];
      const finished = out.results.filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds);
      const rider10 = finished[9];
      const group10 = top.groups.find((g) => g.rider_ids.includes(rider10.rider_id));
      const frontIds = new Set(top.groups.filter((g) => g.gap_seconds === 0).flatMap((g) => g.rider_ids));
      const frontTimes = finished.filter((r) => frontIds.has(r.rider_id)).map((r) => r.time_seconds);
      if (!group10 || !(group10.gap_seconds > 0) || frontTimes.length === 0) continue;
      const closed = group10.gap_seconds - (rider10.time_seconds - Math.min(...frontTimes));
      const cap = finishDescentChaseCapSeconds(group10.gap_seconds, kmFromTop, SHARED_TIME_MODEL_V3_TUNING);
      // 0.5 s: the snapshot sits at the segment border (rounding of the clock).
      assert.ok(closed <= cap + 0.5, `${row.stage_number}@${seed}: closed ${closed.toFixed(2)} s, cap ${cap.toFixed(2)} s`);
      measured++;
    }
  }
  assert.ok(measured >= 10, "the contract is measured on most descent finishes");
});
