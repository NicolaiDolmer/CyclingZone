// backend/lib/engine/v4/finale.grupetto.test.ts
// #5581: grupettoens anden halvdel i finalen. Ejer-trappen 23/9 (#4914):
// grupetto er "ude af udbrud og finale" og "aldrig top 10". Egen fil (ikke
// finale.test.ts), saa den ikke kolliderer med andre spors aendringer dér.

import { test } from "node:test";
import assert from "node:assert/strict";

import { finaleHook } from "./finale.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, EffortLevel, Entrant, EngineState, RaceGroup, RiderState, RouteV2, Segment } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(value: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = value;
  return out;
}

function entrant(id: string, value: number, effort: EffortLevel = "normal"): Entrant {
  return { rider_id: id, abilities: abilities(value), role: "free_role", effort, condition: 1 };
}

function riderState(id: string, groupId: string, wprime: number): RiderState {
  return {
    rider_id: id,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 1,
    wprime,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  } as RiderState;
}

function ctxFor(entrants: Record<string, Entrant>, profile: RouteV2["profile_type"], segment: Segment) {
  const route: RouteV2 = {
    distance_km: 150,
    profile_type: profile,
    finale_type: null,
    segments: [segment],
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [],
  };
  return makeHookCtx({ segment, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: "5581-finale" });
}

function state(groups: RaceGroup[], riders: Record<string, RiderState>): EngineState {
  return { km: 130, groups, riders, virtual_gc: Object.fromEntries(Object.keys(riders).map((id) => [id, 0])) };
}

/**
 * En frisk, staerk rytter alene bag en traet, svag front. Paa `normal` jager
 * han op i kontendent-puljen (kontrol); paa `grupetto` jager han ikke.
 */
function chaseScenario(effort: EffortLevel) {
  const entrants: Record<string, Entrant> = { lone: entrant("lone", 99, effort) };
  const frontIds = ["a", "b", "c"];
  for (const id of frontIds) entrants[id] = entrant(id, 20);
  const riders: Record<string, RiderState> = { lone: riderState("lone", "solo-1", 1) };
  for (const id of frontIds) riders[id] = riderState(id, "peloton-0", 0.05);
  const groups: RaceGroup[] = [
    { id: "peloton-0", kind: "peloton", rider_ids: frontIds, gap_seconds: 0, cohesion: 1 },
    { id: "solo-1", kind: "solo", rider_ids: ["lone"], gap_seconds: 120, cohesion: 1 },
  ];
  const result = finaleHook(state(groups, riders), ctxFor(entrants, "mountain", { kind: "descent", from_km: 130, to_km: 150 } as Segment));
  return result.state.groups.find((g) => g.rider_ids.includes("lone"))!;
}

test("kontrol: paa 'normal' jager den friske, staerke rytter op i kontendent-puljen", () => {
  const g = chaseScenario("normal");
  assert.ok(g.id.startsWith("finale-"), `forventede en placerings-gruppe, fik ${g.id}`);
});

test("en ren grupetto-gruppe jager ikke op i finalen: den beholder sit hul", () => {
  const g = chaseScenario("grupetto");
  assert.equal(g.id, "solo-1");
  assert.equal(g.gap_seconds, 120);
});

test("i kontendent-puljen placeres grupetto-ryttere efter alle andre (spurter ikke, aldrig foran en koerende)", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (let i = 0; i < ids.length; i++) {
    // p0 er den klart staerkeste, men koerer grupetto.
    entrants[ids[i]] = entrant(ids[i], 90 - i * 6, i === 0 ? "grupetto" : "normal");
    riders[ids[i]] = riderState(ids[i], "peloton-0", 0.6);
  }
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ids, gap_seconds: 0, cohesion: 1 }];
  for (const profile of ["mountain", "flat"] as const) {
    const result = finaleHook(state(groups, riders), ctxFor(entrants, profile, { kind: "flat", from_km: 149, to_km: 150 } as Segment));
    const order = [...result.state.groups]
      .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id))
      .flatMap((g) => g.rider_ids);
    const finishOrder = (result.state as EngineState & { finish_order?: string[] }).finish_order ?? order;
    assert.equal(finishOrder[finishOrder.length - 1], "p0", `${profile}: grupetto-rytteren skal vaere sidst i puljen`);
  }
});
