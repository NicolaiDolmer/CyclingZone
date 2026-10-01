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

function twoBreaks(frontId: string, rearId: string) {
  const { state, ctx } = fixture();
  const original = state.groups.find(group => group.id === "escape")!;
  const rearIds = ["t0", "t1"];
  const groups: RaceGroup[] = [
    { ...original, id: frontId },
    { ...original, id: rearId, rider_ids: rearIds, gap_seconds: 60 },
    ...state.groups.filter(group => group.id !== "escape").map(group => ({ ...group, gap_seconds: group.id === "near" ? 120 : group.gap_seconds, rider_ids: group.rider_ids.filter(id => !rearIds.includes(id)) })),
  ];
  return { state: { ...state, groups }, ctx };
}

test("#5951 floor closing and outcomes do not depend on target identifiers", () => {
  function run(frontId: string, rearId: string) {
    const { state, ctx } = twoBreaks(frontId, rearId);
    const segment = { kind: "flat" as const, from_km: 90, to_km: 95 };
    return breakawayHook(state, { ...ctx, segment, route: { ...ctx.route, profile_type: "flat", finale_type: "breakaway", segments: [ctx.route.segments[0], segment] }, rngForStage: () => () => 0.99 });
  }
  const frontFirst = run("a-front", "z-rear");
  const rearFirst = run("z-front", "a-rear");
  const positions = (state: EngineState) => state.groups.map(group => [group.rider_ids.join(","), group.gap_seconds]).sort();
  const outcomes = (events: typeof frontFirst.events) => events.filter(event => event.type === "breakaway_caught" || event.type === "breakaway_survived").map(event => [event.type, event.params.rider_ids, event.params.gap_seconds]).sort();
  assert.deepEqual(positions(frontFirst.state), positions(rearFirst.state));
  assert.deepEqual(frontFirst.state.riders, rearFirst.state.riders, "shared work is priced once and independent of target IDs");
  assert.deepEqual(outcomes(frontFirst.events), outcomes(rearFirst.events));
});

test("#5951 a final shared advance catches a rear escape that resisted its own chase", () => {
  const { state, ctx } = twoBreaks("z-front", "a-rear");
  state.groups = state.groups.map(group => ({ ...group, gap_seconds: group.id === "near" ? 150 : group.id === "a-rear" ? 52 : group.gap_seconds }));
  const entrants = Object.fromEntries(Object.entries(ctx.entrants).map(([id, entrant]) => [id, id === "t0" || id === "t1" ? { ...entrant, abilities: Object.fromEntries(Object.keys(entrant.abilities).map(key => [key, 100])) as Entrant["abilities"] } : entrant]));
  const alone = breakawayHook({ ...state, groups: state.groups.map(group => group.id === "z-front" ? { ...group, kind: "chase" } : group) }, { ...ctx, entrants });
  assert.ok(!alone.events.some(event => event.type === "breakaway_caught" && event.params.group_id === "a-rear"), "rear escape survives its own chase");
  const together = breakawayHook(state, { ...ctx, entrants });
  assert.ok(together.events.some(event => event.type === "breakaway_caught" && event.params.group_id === "a-rear"), "the final shared advance catches it");
  assert.ok(!together.events.some(event => event.type === "breakaway_survived" && event.params.group_id === "a-rear"));
  assert.equal(together.state.groups.find(group => group.id === "a-rear")!.gap_seconds, together.state.groups.find(group => group.id === "near")!.gap_seconds);
});