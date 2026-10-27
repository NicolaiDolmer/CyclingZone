// #6912: syntetiske hook-scenarier, ingen kalibrerede balancevaerdier.
import test from "node:test";
import assert from "node:assert/strict";
import { breakawayHook } from "./breakaway.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { BREAKAWAY_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { s5V3RealisticLeadCeilingSeconds } from "./breakawayV3_6804.ts";
import type { EngineState, Entrant, ProfileType, RaceGroup, RiderState, RouteV2 } from "../types.ts";

function fixture(profile: ProfileType = "flat", { intermediate = false, ownAhead = false, helpers = true } = {}) {
  const ceiling = s5V3RealisticLeadCeilingSeconds(profile, true);
  const groups: RaceGroup[] = [
    { id: "escape", kind: "breakaway", origin: "breakaway", rider_ids: ["e1", "e2"], gap_seconds: 0, cohesion: 1 },
    ...(intermediate ? [{ id: "solo", kind: "solo", rider_ids: ["solo"], gap_seconds: ceiling / 2, cohesion: 1 } as RaceGroup] : []),
    { id: "field", kind: "peloton", rider_ids: ["spr", ...(helpers ? ["h1", "h2", "h3", "h4"] : []), "other"], gap_seconds: ceiling * 2, cohesion: 1 },
  ];
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const g of groups) for (const id of g.rider_ids) {
    const isBreak = g.id === "escape";
    const team = id === "spr" || id.startsWith("h") || (ownAhead && id === "e1") ? "sprint-team" : g.id;
    entrants[id] = { rider_id: id, team_id: team, role: id === "spr" ? "sprint_captain" : "helper", effort: "normal", condition: 1,
      abilities: { sprint: id === "spr" ? 90 : isBreak ? 5 : 10, flat: isBreak ? 80 : 50, tempo: isBreak ? 80 : 50, endurance: isBreak ? 80 : 50, climbing: 20, time_trial: 20 } } as Entrant;
    riders[id] = { rider_id: id, group_id: g.id, cp: .5, wprimeMax: .4, wprime: .4, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
  }
  const route: RouteV2 = { distance_km: 200, profile_type: profile, finale_type: "bunch_sprint", segments: [{ kind: "flat", from_km: 0, to_km: 5 }, { kind: "flat", from_km: 120, to_km: 125 }], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [] };
  const state: EngineState = { km: 120, groups, riders, virtual_gc: {} };
  const ctx: Parameters<typeof breakawayHook>[1] = { ...makeHookCtx({ segment: route.segments[1], segmentIndex: 1, route, entrants, tuning: RACE_V4_TUNING }), rulesRevision: "orders_gc_v1", ordersGcV3: true, s5ProfilesV1: true, s5ProfilesV2: true, s5ProfilesV3: true,
    gcContext: { status: "first_stage", stage_number: 1 } as const, sharedGroupTime: { entryGroups: groups, timeModelGeneration: 3 as const } };
  return { state, ctx, ceiling, entrants };
}

for (const profile of ["flat", "rolling"] as const) test(`#6912 ${profile}: interesserede sprinterhold holder terraen-forspring paa snoren uden GC`, () => {
  const { state, ctx, ceiling } = fixture(profile);
  const result = breakawayHook(state, ctx);
  const gap = result.state.groups.find(g => g.id === "field")!.gap_seconds - result.state.groups.find(g => g.id === "escape")!.gap_seconds;
  assert.ok(gap <= ceiling, "feltet skal overtage jagten paa det faktiske hul");
  assert.ok(result.state.riders.h1.team_cp_factor! < (state.riders.h1.team_cp_factor ?? 1), "hjaelperne betaler jagten");
  assert.equal(result.state.riders.spr.team_cp_factor, state.riders.spr.team_cp_factor, "sprintkaptajnen skaanes");
  assert.deepEqual(state, fixture(profile).state, "input er immutabelt");
});

test("#6912: en solo foran feltet skjuler ikke sprinterholdets jagt", () => {
  const { state, ctx, ceiling } = fixture("flat", { intermediate: true });
  const result = breakawayHook(state, ctx);
  assert.ok(result.state.groups.find(g => g.id === "field")!.gap_seconds <= ceiling, "selve feltet skal jage, ikke kun soloen");
});

test("#6912: egne foran og manglende hjaelpere giver ikke gratis sprint-jagt", () => {
  for (const options of [{ ownAhead: true }, { helpers: false }]) {
    const { state, ctx } = fixture("flat", options);
    const result = breakawayHook(state, ctx);
    assert.equal(result.state.riders.spr.team_cp_factor, state.riders.spr.team_cp_factor);
    if (options.ownAhead) assert.equal(result.state.riders.h1.team_cp_factor, state.riders.h1.team_cp_factor);
  }
});

function splitField({ allOut = false, descent = false, gc = false } = {}) {
  const f = fixture();
  const field = f.state.groups.find(g => g.id === "field")!;
  const middle: RaceGroup = { id: "middle", kind: "chase", rider_ids: ["h3", "h4"], gap_seconds: f.ceiling / 2, cohesion: 1 };
  field.rider_ids = field.rider_ids.filter(id => !middle.rider_ids.includes(id));
  f.state.groups.push(middle);
  for (const id of middle.rider_ids) f.state.riders[id].group_id = "middle";
  if (allOut) for (const id of ["h1", "h2", "h3", "h4", "other"]) f.entrants[id] = { ...f.entrants[id], effort: "all_out" };
  if (descent) {
    f.ctx.segment = { kind: "descent", from_km: 120, to_km: 125, technicality: 1 };
    f.ctx.route = { ...f.ctx.route, segments: [f.ctx.route.segments[0], f.ctx.segment] };
    f.state.finish_descent_regroup = { field: { topGapSeconds: f.ceiling * 2, closedSeconds: Number.MAX_SAFE_INTEGER }, middle: { topGapSeconds: f.ceiling / 2, closedSeconds: Number.MAX_SAFE_INTEGER } };
  }
  if (gc) {
    middle.gap_seconds = f.ceiling * 2;
    field.gap_seconds = f.ceiling * 4;
    for (const id of ["x1", "x2", "x3", "x4"]) {
      f.entrants[id] = { ...f.entrants.h1, rider_id: id };
      f.state.riders[id] = { ...f.state.riders.h1, rider_id: id };
      field.rider_ids.push(id);
    }
    f.entrants.h3 = { ...f.entrants.h3, role: "captain" };
    f.ctx.gcContext = { status: "standings", stage_number: 2, leader_id: "h3", standings: ["h3", "e1", "e2", "spr", "h4", "h1", "h2", "other"].map((id, i) => ({ rider_id: id, rank: i + 1, gap_seconds: i })) };
  }
  f.ctx.sharedGroupTime = { ...f.ctx.sharedGroupTime!, entryGroups: f.state.groups };
  return f;
}

test("#6912 review: begge jagtgrupper respekterer opbrugt nedkoerselsbog", () => {
  const { state, ctx } = splitField({ descent: true });
  const result = breakawayHook(state, ctx);
  assert.equal(result.state.groups.find(g => g.id === "field")!.gap_seconds, state.groups.find(g => g.id === "field")!.gap_seconds);
  assert.deepEqual(result.state.finish_descent_regroup, state.finish_descent_regroup);
});

test("#6912 review: et bageste felt med all_out-hjaelpere faar ikke gratis snor-kontrol", () => {
  const { state, ctx, ceiling } = splitField({ allOut: true });
  const result = breakawayHook(state, ctx);
  assert.ok(result.state.groups.find(g => g.id === "field")!.gap_seconds > ceiling);
  assert.equal(result.state.riders.h1.team_cp_factor, state.riders.h1.team_cp_factor);
});

test("#6912 review: feltets jagt erstatter ikke mellemgruppens klassementsjagt", () => {
  const { state, ctx } = splitField({ gc: true });
  const result = breakawayHook(state, ctx);
  assert.ok(result.state.groups.find(g => g.id === "middle")!.gap_seconds < state.groups.find(g => g.id === "middle")!.gap_seconds);
  assert.ok(result.state.riders.h4.team_cp_factor! < (state.riders.h4.team_cp_factor ?? 1));
});

test("#6912: filmen navngiver den foerste reelle indhentning, ikke blot det stoerste felt", () => {
  const { state, ctx } = splitField();
  state.groups.find(g => g.id === "middle")!.gap_seconds = 1;
  const entrants = ctx.entrants as Record<string, Entrant>;
  for (const id of ["h3", "h4"]) entrants[id] = { ...entrants[id], abilities: { ...entrants[id].abilities, sprint: 100, tempo: 100, endurance: 100 } };
  ctx.segment = { kind: "flat", from_km: ctx.route.distance_km - BREAKAWAY_EXTRA_TUNING.chaseFloorFinalKm - 5, to_km: ctx.route.distance_km };
  ctx.route = { ...ctx.route, finale_type: "breakaway", segments: [ctx.route.segments[0], ctx.segment] };
  ctx.rngForStage = () => () => 0.99;
  const result = breakawayHook(state, ctx);
  const caught = result.events.find(e => e.type === "breakaway_caught");
  assert.equal(caught?.params.chase_group_id, "middle");
  assert.ok(Number(caught?.params.exact_km) < ctx.segment.to_km);
});

test("#6912: feltets indhentning skjules ikke af en sammenlaegning inde i udbruddet", () => {
  const { state, ctx } = splitField();
  state.groups.find(g => g.id === "middle")!.origin = "breakaway";
  state.groups.find(g => g.id === "middle")!.gap_seconds = 0;
  ctx.segment = { kind: "flat", from_km: 195, to_km: 200 };
  ctx.route = { ...ctx.route, finale_type: "breakaway", segments: [ctx.route.segments[0], ctx.segment] };
  ctx.rngForStage = () => () => 0.99;
  const result = breakawayHook(state, ctx);
  assert.equal(result.events.find(e => e.type === "breakaway_caught")?.params.chase_group_id, "field");
});

test("#6912 review: flere jagtgrupper opkraever kun udbruddets arbejde een gang", () => {
  const one = fixture();
  const two = fixture("flat", { intermediate: true });
  const first = breakawayHook(one.state, one.ctx);
  const second = breakawayHook(two.state, two.ctx);
  for (const id of ["e1", "e2"]) assert.equal(second.state.riders[id].team_cp_factor, first.state.riders[id].team_cp_factor);
});

for (const profile of ["flat", "rolling"] as const) test(`#6912 ${profile}: endagsloeb med reel sprintkaptajn kontrollerer samme faktiske hul`, () => {
  const { state, ctx, ceiling } = fixture(profile);
  ctx.gcContext = { status: "one_day" };
  const result = breakawayHook(state, ctx);
  assert.ok(result.state.groups.find(g => g.id === "field")!.gap_seconds <= ceiling);
  assert.ok(result.state.riders.h1.team_cp_factor! < (state.riders.h1.team_cp_factor ?? 1));
});

test("#6912: filmen forklarer terraenets overskridelse uden jagt-interesse", () => {
  const { state, ctx, ceiling, entrants } = fixture("flat", { ownAhead: true });
  for (const id of state.groups.find(g => g.id === "field")!.rider_ids) entrants[id] = { ...entrants[id], team_id: "sprint-team" };
  ctx.sharedGroupTime = { ...ctx.sharedGroupTime!, entryGroups: state.groups.map(g => g.id === "field" ? { ...g, gap_seconds: ceiling } : g) };
  state.groups.find(g => g.id === "field")!.gap_seconds = ceiling + 1;
  ctx.segment = { kind: "climb", from_km: 120, to_km: 125, category: "4", avg_gradient: 4, top_elevation_m: 100 };
  ctx.route = { ...ctx.route, segments: [ctx.route.segments[0], ctx.segment] };
  const result = breakawayHook(state, ctx);
  assert.ok(result.events.some(e => e.type === "breakaway_unchased" && e.params.group_id === "escape"), "terraenets hul over snoren skal forklares, selv om lad-gaa-fasen er slut");
});

test("#6912: mellemgruppens manglende interesse skjuler ikke feltets jagt", () => {
  const { state, ctx, ceiling, entrants } = fixture("flat", { intermediate: true });
  entrants.solo = { ...entrants.solo, team_id: entrants.e1.team_id };
  ctx.sharedGroupTime = { ...ctx.sharedGroupTime!, entryGroups: state.groups.map(g => ({ ...g, gap_seconds: g.id === "escape" ? 0 : ceiling })) };
  state.groups.find(g => g.id === "solo")!.gap_seconds = ceiling + 1;
  state.groups.find(g => g.id === "field")!.gap_seconds = ceiling * 2;
  ctx.segment = { kind: "descent", from_km: 120, to_km: 125, technicality: 1 };
  ctx.route = { ...ctx.route, segments: [ctx.route.segments[0], ctx.segment] };
  state.finish_descent_regroup = {
    field: { topGapSeconds: ceiling * 2, closedSeconds: Number.MAX_SAFE_INTEGER },
    solo: { topGapSeconds: ceiling + 1, closedSeconds: Number.MAX_SAFE_INTEGER },
  };
  const result = breakawayHook(state, ctx);
  assert.ok(result.state.riders.h1.team_cp_factor! < (state.riders.h1.team_cp_factor ?? 1), "feltets hjaelper udfoerer jagtarbejde");
  assert.equal(result.events.some(e => e.type === "breakaway_unchased" && e.params.group_id === "escape"), false, "mellemgruppen maa ikke erklaere hele udbruddet ujaget");
});
