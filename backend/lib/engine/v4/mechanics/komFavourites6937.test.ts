// backend/lib/engine/v4/mechanics/komFavourites6937.test.ts
// #6937 B2 (ejer 24/10 valg A, KUN s5_profiles_v3): kaptajnerne i en lille
// favoritgruppe ruller over bjergtoppene undervejs; de spurter ikke om
// bjergpoint. Dagens udbrud kaemper som foer, troejefoereren forsvarer som foer,
// topankomsten (maalordenen) og de indlagte spurter er uaendrede, og uden
// v3-flaget er alt bit-identisk med #5914. Egen fil (ikke bonusSeconds.test.ts),
// saa den ikke kolliderer med andre spors aendringer dér.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computePassageOrder, KOM_FAVOURITE_ROLL_OVER_ROLES, passagesHook } from "./bonusSeconds.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { boundRngFor } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RiderRole, RiderState, RouteV2, SegmentHookContext, Waypoint } from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(climbing: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = 50;
  out.climbing = climbing;
  out.endurance = climbing;
  out.sprint = climbing;
  out.acceleration = climbing;
  out.positioning = climbing;
  return out;
}

function entrant(id: string, climbing: number, role: RiderRole): Entrant {
  return { rider_id: id, abilities: abilities(climbing), role, effort: "normal", condition: 1 };
}

function riderState(id: string, groupId: string): RiderState {
  return {
    rider_id: id, group_id: groupId, cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  } as RiderState;
}

/** Favoritgruppe: to staerke kaptajner + en svagere hjaelper; feltet langt bagude. */
function favouritesScene(favGroup: Partial<RaceGroup> = {}) {
  const entrants: Record<string, Entrant> = {
    capA: entrant("capA", 95, "captain"),
    capB: entrant("capB", 90, "captain"),
    helper: entrant("helper", 70, "helper"),
    back: entrant("back", 99, "helper"),
  };
  const groups: RaceGroup[] = [
    { id: "fav", kind: "chase", rider_ids: ["capA", "capB", "helper"], gap_seconds: 0, cohesion: 1, ...favGroup },
    { id: "peloton-0", kind: "peloton", rider_ids: ["back"], gap_seconds: 240, cohesion: 1 },
  ];
  const riders = Object.fromEntries(Object.keys(entrants).map((id) => [id, riderState(id, id === "back" ? "peloton-0" : "fav")]));
  const state: EngineState = { km: 100, groups, riders, virtual_gc: {} };
  return { entrants, state };
}

const KOM_CONTEST = {
  contenderRoles: BONUS_SECONDS_EXTRA_TUNING.komContenderRoles,
  openContestMaxGroupSize: BONUS_SECONDS_EXTRA_TUNING.passageOpenContestMaxGroupSize,
};

function order(scene: ReturnType<typeof favouritesScene>, contest: Record<string, unknown>) {
  return computePassageOrder(scene.state, scene.entrants, boundRngFor("6937"), {
    stream: "passage:kom:0",
    qualityWeights: BONUS_SECONDS_EXTRA_TUNING.komQualityWeightsBig,
    noiseSd: 0,
    contest: { ...KOM_CONTEST, ...contest } as Parameters<typeof computePassageOrder>[3]["contest"],
  });
}

test("#6937: v3-adfaerden gaelder kun s5_profiles_v3; v1, v2 og alt andet er uroert", () => {
  assert.equal(isS5ProfilesV3OrLater("s5_profiles_v3"), true);
  for (const other of ["s5_profiles_v2", "s5_profiles_v1", "official_times_v5", "legacy", null, undefined, "s5_profiles_v3 "]) {
    assert.equal(isS5ProfilesV3OrLater(other), false);
  }
});

test("#6937 B2: kaptajnerne er rollerne der ruller over (kaptajn og sprint-kaptajn)", () => {
  assert.deepEqual([...KOM_FAVOURITE_ROLL_OVER_ROLES].sort(), ["captain", "sprint_captain"]);
});

test("#6937 B2: uden v3 kaemper hele den lille gruppe (#5914): kaptajnerne tager toppen paa evne", () => {
  assert.deepEqual(order(favouritesScene(), {}), ["capA", "capB", "helper", "back"]);
});

test("#6937 B2: i en favoritgruppe ruller kaptajnerne over bag dem der kaemper", () => {
  const got = order(favouritesScene(), { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES });
  assert.deepEqual(got, ["helper", "capA", "capB", "back"], "hjaelperen tager toppen; kaptajnerne passerer bagefter, foer feltet");
});

test("#6937 B2: dagens udbrud kaemper som foer, ogsaa en kaptajn i udbruddet", () => {
  const got = order(favouritesScene({ kind: "breakaway", origin: "breakaway" }), { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES });
  assert.deepEqual(got, ["capA", "capB", "helper", "back"]);
});

test("#6937 B2: bjergtroejens foerer forsvarer som foer, ogsaa som kaptajn i favoritgruppen", () => {
  const got = order(favouritesScene(), { smallGroupRollOverRoles: KOM_FAVOURITE_ROLL_OVER_ROLES, jerseyLeaderId: "capB" });
  assert.deepEqual(got, ["capB", "helper", "capA", "back"]);
});

// ── passagesHook: kun bjergtoppe undervejs, kun under v3-flaget ──────────────

function hookScene(waypoints: Waypoint[], s5ProfilesV3: boolean) {
  const scene = favouritesScene();
  const route: RouteV2 = {
    distance_km: 150, profile_type: "mountain", finale_type: "long_climb",
    segments: [{ kind: "climb", from_km: 90, to_km: 110 }], weather: { kind: "sun", wind_exposure: 0.1 }, waypoints,
  } as RouteV2;
  const ctx: SegmentHookContext = {
    segment: route.segments[0], segmentIndex: 0, route, entrants: scene.entrants, tuning: RACE_V4_TUNING,
    rngFor: boundRngFor("6937-hook"), rngForStage: boundRngFor("6937-hook"), orders: [],
    ...(s5ProfilesV3 ? { s5ProfilesV3: true as const } : {}),
  };
  return passagesHook(scene.state, ctx).state.stage_passages ?? [];
}

const KOM_WP: Waypoint = { kind: "kom", index: 0, name: "Top", km: 100, category: "1", summit_finish: false };
const SPRINT_WP: Waypoint = { kind: "sprint", index: 1, name: "Spurt", km: 105 };

test("#6937 B2: bjergtoppen undervejs gaar til hjaelperen under v3, til kaptajnen uden", () => {
  const winnerOf = (v3: boolean) => hookScene([KOM_WP], v3).find((p) => p.kind === "kom")?.results[0]?.rider_id;
  assert.equal(winnerOf(false), "capA");
  assert.equal(winnerOf(true), "helper");
});

test("#6937 B2: den indlagte spurt er uaendret under v3", () => {
  const sprintOf = (v3: boolean) => hookScene([SPRINT_WP], v3).find((p) => p.kind === "sprint");
  assert.deepEqual(sprintOf(true), sprintOf(false));
});
