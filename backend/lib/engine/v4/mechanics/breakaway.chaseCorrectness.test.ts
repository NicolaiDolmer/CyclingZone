import test from "node:test";
import assert from "node:assert/strict";
import { breakawayHook } from "./breakaway.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, EngineState, Entrant, RaceGroup, RiderState, RouteV2 } from "../types.ts";

function fixture() {
  const groups: RaceGroup[] = [
    { id: "escape", kind: "breakaway", origin: "breakaway", rider_ids: ["e1", "e2"], gap_seconds: 0, cohesion: 1 },
    { id: "near", kind: "chase", rider_ids: ["c1", "c2", "c3", "c4"], gap_seconds: 60, cohesion: 1 },
    { id: "tail", kind: "gruppetto", rider_ids: Array.from({ length: 20 }, (_, i) => `t${i}`), gap_seconds: 900, cohesion: 1 },
  ];
  const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const group of groups) for (const riderId of group.rider_ids) {
    const value = group.id === "escape" ? 30 : 90;
    const abilities = Object.fromEntries(keys.map((key) => [key, value])) as Record<AbilityKey, number>;
    entrants[riderId] = { rider_id: riderId, role: "helper", effort: "normal", condition: 1, abilities, team_id: group.id };
    riders[riderId] = { rider_id: riderId, group_id: group.id, cp: .5, wprimeMax: .4, wprime: .4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  const route: RouteV2 = { distance_km: 100, profile_type: "rolling", finale_type: "bunch_sprint", segments: [{ kind: "climb", from_km: 0, to_km: 10, category: "3", avg_gradient: 5, top_elevation_m: 500 }, { kind: "flat", from_km: 10, to_km: 20 }], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] };
  const state: EngineState = { km: 10, groups, riders, virtual_gc: {} };
  const ctx = makeHookCtx({ segment: route.segments[1], segmentIndex: 1, route, entrants, tuning: RACE_V4_TUNING, seed: "large-tail-chase", orders: [{ team_id: "near", kind: "team_tactics", params: { breakaway_stance: "chase", riders: [] } }] });
  return { state, ctx };
}

test("#5951 chasing closes the real pursuing group's gap without moving escapees backwards", () => {
  const { state, ctx } = fixture();
  const result = breakawayHook(state, ctx);
  assert.equal(result.state.groups.find((g) => g.id === "escape")!.gap_seconds, 0, "catching does not drag escapees towards a distant tail");
  assert.ok(result.state.groups.find((g) => g.id === "near")!.gap_seconds < 60, "the actual pursuer advances");
  assert.equal(result.state.groups.find((g) => g.id === "tail")!.gap_seconds, 900, "a non-pursuing tail receives no chase movement");
  assert.deepEqual(state, fixture().state, "input state is immutable");
});

test("#5951 array order and an unrelated larger tail cannot select another pursuing group", () => {
  const { state, ctx } = fixture();
  const first = breakawayHook(state, ctx);
  const reordered = breakawayHook({ ...state, groups: [...state.groups].reverse() }, ctx);
  const gaps = (s: EngineState) => s.groups.map((g) => [g.id, g.gap_seconds]).sort();
  assert.deepEqual(gaps(first.state), gaps(reordered.state));
  const noTail = breakawayHook({ ...state, groups: state.groups.filter((g) => g.id !== "tail") }, ctx);
  assert.equal(first.state.groups.find((g) => g.id === "escape")!.gap_seconds, noTail.state.groups.find((g) => g.id === "escape")!.gap_seconds, "escape time is never changed by a distant tail");
});


test("#5951 a pursuing group does not leave a break it already caught behind while continuing to another", () => {
  const { state, ctx } = fixture();
  const original = state.groups.find((g) => g.id === "escape")!;
  const rearIds = ["t0", "t1"];
  const groups: RaceGroup[] = [
    { ...original, id: "z-front" },
    { ...original, id: "a-rear", rider_ids: rearIds, gap_seconds: 30 },
    ...state.groups.filter((g) => g.id !== "escape").map((g) => ({ ...g, rider_ids: g.rider_ids.filter((id) => !rearIds.includes(id)) })),
  ];
  const result = breakawayHook({ ...state, groups }, ctx);
  const chase = result.state.groups.find((g) => g.id === "near")!;
  const caughtIds = result.events.filter((e) => e.type === "breakaway_caught").flatMap((e) => e.params?.rider_ids as string[] ?? []);
  assert.ok(caughtIds.includes("t0"), "the closer escape was actually caught");
  assert.equal(result.state.groups.find((g) => g.id === "a-rear")!.gap_seconds, chase.gap_seconds, "caught riders join the continuing chase instead of receiving a catch penalty");
});
