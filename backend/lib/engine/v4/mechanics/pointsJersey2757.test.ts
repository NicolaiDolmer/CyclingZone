// backend/lib/engine/v4/mechanics/pointsJersey2757.test.ts
// #2757 G18 (KUN s5_profiles_v3): klassementskaptajnen spurter ikke i den flade
// massespurt og forsvarer ikke pointtroejen i feltets indlagte spurter. Uden
// v3-flaget er alt bit-identisk. Egen fil, saa den ikke kolliderer med andre spor.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUNCH_SPRINT_FINALES,
  GC_CAPTAIN_ROLE,
  GC_CAPTAIN_ROLL_IN_AFTER,
  GC_CAPTAIN_ROLL_IN_SPREAD,
  gcCaptainRollInApplies,
  intermediateSprintLeaderV3,
  isBunchSprintFinale,
  rollInGcCaptainsOnBunchSprint,
} from "./pointsJersey2757.ts";
import { passagesHook } from "./bonusSeconds.ts";
import { finaleHook } from "../finale.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { boundRngFor } from "../rng.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, FinaleType, GcContext, RaceGroup, RiderRole, RiderState, RouteV2, Segment, SegmentHookContext, Waypoint } from "../types.ts";

const ids = (xs: Array<{ riderId: string }>) => xs.map((x) => x.riderId);
const field = (n: number, captainsAt: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ riderId: captainsAt.includes(i) ? `cap${i}` : `r${i}`, score: n - i }));
const roleOf = (id: string) => (id.startsWith("cap") ? GC_CAPTAIN_ROLE : "helper");
const noEscape = () => false;

test("#2757: kun den flade massespurt (flat_sprint, bunch_sprint)", () => {
  assert.deepEqual([...BUNCH_SPRINT_FINALES].sort(), ["bunch_sprint", "flat_sprint"]);
  for (const f of ["uphill_sprint", "reduced_sprint", "punch", "wall_finish", "long_climb", "descent", "breakaway", "solo_tt", null, undefined] as Array<FinaleType | null | undefined>) {
    assert.equal(isBunchSprintFinale(f), false, String(f));
  }
});

test("#2757: ikke en massespurt = raekkefoelgen uaendret", () => {
  const ordered = field(30, [0, 1]);
  for (const finaleType of ["uphill_sprint", "long_climb", null] as Array<FinaleType | null>) {
    assert.deepEqual(ids(rollInGcCaptainsOnBunchSprint(ordered, { finaleType, roleOf, isEscape: noEscape })), ids(ordered));
  }
});

test("#2757: i massespurten ruller kaptajnen ind bag spurtens front; resten bevarer sin raekkefoelge", () => {
  const ordered = field(40, [0, 3]);
  const got = ids(rollInGcCaptainsOnBunchSprint(ordered, { finaleType: "flat_sprint", roleOf, isEscape: noEscape }));
  assert.equal(got.length, ordered.length);
  assert.deepEqual(new Set(got), new Set(ids(ordered)), "ingen rytter tabt eller dubleret");
  assert.equal(got.indexOf("cap0"), GC_CAPTAIN_ROLL_IN_AFTER);
  assert.equal(got.indexOf("cap3"), GC_CAPTAIN_ROLL_IN_AFTER + 1, "kaptajner med samme maalplads beholder deres indbyrdes orden");
  const others = got.filter((id) => !id.startsWith("cap"));
  assert.deepEqual(others, ids(ordered).filter((id) => !id.startsWith("cap")));
  assert.equal(got[0], "r1", "spurtens bedste ikke-kaptajn vinder");
});

test("#2757: den seedede spredning laegger kaptajnen inde i feltet, aldrig i spurtens front", () => {
  const ordered = field(80, [0]);
  for (const u of [0, 0.25, 0.5, 0.999, 1, -1, Number.NaN]) {
    const got = ids(rollInGcCaptainsOnBunchSprint(ordered, { finaleType: "bunch_sprint", roleOf, isEscape: noEscape, jitter: () => u }));
    const at = got.indexOf("cap0");
    assert.ok(at >= GC_CAPTAIN_ROLL_IN_AFTER && at < GC_CAPTAIN_ROLL_IN_AFTER + GC_CAPTAIN_ROLL_IN_SPREAD, `u=${u} -> ${at}`);
  }
});

test("#2757: en kaptajn i dagens udbrud og andre roller koerer om sejren som foer", () => {
  const ordered = [{ riderId: "capEsc" }, { riderId: "spr" }, { riderId: "cap" }];
  const got = ids(rollInGcCaptainsOnBunchSprint(ordered, {
    finaleType: "flat_sprint",
    roleOf: (id) => (id.startsWith("cap") ? "captain" : "sprint_captain"),
    isEscape: (id) => id === "capEsc",
    rollInAfter: 1,
  }));
  assert.deepEqual(got, ["capEsc", "cap", "spr"], "udbruddets kaptajn beholder sejren; feltets kaptajn ruller ind bag spurtens front");
});

test("#2757: et kort felt: kaptajnen kommer sidst blandt de oevrige, ingen rytter tabes", () => {
  const ordered = field(5, [0, 2]);
  const got = ids(rollInGcCaptainsOnBunchSprint(ordered, { finaleType: "flat_sprint", roleOf, isEscape: noEscape }));
  assert.deepEqual(got, ["r1", "r3", "r4", "cap0", "cap2"]);
});

test("#2757: en sprint-kaptajn er spurteren og ruller aldrig ind", () => {
  const ordered = [{ riderId: "a" }, { riderId: "b" }];
  const got = ids(rollInGcCaptainsOnBunchSprint(ordered, { finaleType: "flat_sprint", roleOf: () => "sprint_captain", isEscape: noEscape, rollInAfter: 0 }));
  assert.deepEqual(got, ["a", "b"]);
});

// ── Indlagte spurter: pointfoereren som klassementskaptajn ───────────────────

function abilities(sprint: number): Record<AbilityKey, number> {
  const keys: AbilityKey[] = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
  const out = {} as Record<AbilityKey, number>;
  for (const key of keys) out[key] = 50;
  out.sprint = sprint;
  out.acceleration = sprint;
  out.positioning = sprint;
  return out;
}
const entrant = (id: string, sprint: number, role: RiderRole): Entrant => ({ rider_id: id, abilities: abilities(sprint), role, effort: "normal", condition: 1 });

test("#2757: intermediateSprintLeaderV3 fjerner kun en klassementskaptajn som pointfoerer", () => {
  const entrants = { cap: entrant("cap", 90, "captain"), spr: entrant("spr", 90, "sprint_captain"), h: entrant("h", 50, "helper") };
  assert.equal(intermediateSprintLeaderV3("cap", entrants), null);
  assert.equal(intermediateSprintLeaderV3("spr", entrants), "spr");
  assert.equal(intermediateSprintLeaderV3("h", entrants), "h");
  assert.equal(intermediateSprintLeaderV3(null, entrants), null);
  assert.equal(intermediateSprintLeaderV3(undefined, entrants), null);
  assert.equal(intermediateSprintLeaderV3("ukendt", entrants), "ukendt");
});

/** Et stort felt (over aaben-konkurrence-graensen) med en staerk kaptajn der foerer pointkonkurrencen. */
function sprintScene(v3: boolean) {
  const entrants: Record<string, Entrant> = { cap: entrant("cap", 99, "captain"), spr: entrant("spr", 60, "sprint_captain") };
  for (let i = 0; i < 20; i++) entrants[`h${i}`] = entrant(`h${i}`, 40, "helper");
  const riderIds = Object.keys(entrants);
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: riderIds, gap_seconds: 0, cohesion: 1 }];
  const riders = Object.fromEntries(riderIds.map((id) => [id, {
    rider_id: id, group_id: "peloton-0", cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  } as RiderState]));
  const state: EngineState = { km: 50, groups, riders, virtual_gc: {} };
  const waypoints: Waypoint[] = [{ kind: "sprint", index: 1, name: "Spurt", km: 60 }];
  const route = {
    distance_km: 180, profile_type: "flat", finale_type: "flat_sprint",
    segments: [{ kind: "flat", from_km: 50, to_km: 70 }], weather: { kind: "sun", wind_exposure: 0.1 }, waypoints,
  } as unknown as RouteV2;
  const ctx: SegmentHookContext = {
    segment: route.segments[0], segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING,
    rngFor: boundRngFor("2757-hook"), rngForStage: boundRngFor("2757-hook"), orders: [],
    jerseyLeaders: { points: "cap", kom: null },
    ...(v3 ? { s5ProfilesV3: true as const } : {}),
  } as SegmentHookContext;
  return (passagesHook(state, ctx).state.stage_passages ?? []).find((p) => p.kind === "sprint");
}

test("#2757: uden v3 forsvarer kaptajnen som pointfoerer den indlagte spurt (#5914, uaendret)", () => {
  assert.equal(sprintScene(false)?.results[0]?.rider_id, "cap");
});

// ── finaleHook: den flade massespurt ──────────────────────────────────────────

const STAGE_RACE: GcContext = { status: "first_stage", stage_number: 1 };

test("#2757: regel 1 gaelder kun under v3 i et etapeloeb", () => {
  assert.equal(gcCaptainRollInApplies({ s5ProfilesV3: true, gcContext: STAGE_RACE }), true);
  assert.equal(gcCaptainRollInApplies({ s5ProfilesV3: true, gcContext: { status: "standings", stage_number: 3, leader_id: null, standings: [] } }), true);
  assert.equal(gcCaptainRollInApplies({ s5ProfilesV3: true, gcContext: { status: "one_day" } }), false);
  assert.equal(gcCaptainRollInApplies({ s5ProfilesV3: true, gcContext: { status: "missing" } }), false);
  assert.equal(gcCaptainRollInApplies({ s5ProfilesV3: true }), false);
  assert.equal(gcCaptainRollInApplies({ gcContext: STAGE_RACE }), false);
});

function finishOrder(finaleType: FinaleType, v3: boolean, captainInBreak = false, gcContext: GcContext | null = STAGE_RACE): string[] {
  const entrants: Record<string, Entrant> = { cap: entrant("cap", 99, "captain") };
  for (let i = 0; i < 40; i++) entrants[`r${i}`] = entrant(`r${i}`, 80 - i, i === 0 ? "sprint_captain" : "helper");
  const ids = Object.keys(entrants);
  const riders = Object.fromEntries(ids.map((id) => [id, {
    rider_id: id, group_id: "peloton-0", cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  } as RiderState]));
  const groups: RaceGroup[] = captainInBreak
    ? [
      { id: "break-0", kind: "breakaway", origin: "breakaway", rider_ids: ["cap", "r39"], gap_seconds: 0, cohesion: 1 } as RaceGroup,
      { id: "peloton-0", kind: "peloton", rider_ids: ids.filter((id) => id !== "cap" && id !== "r39"), gap_seconds: 600, cohesion: 1 },
    ]
    : [{ id: "peloton-0", kind: "peloton", rider_ids: ids, gap_seconds: 0, cohesion: 1 }];
  const state: EngineState = { km: 140, groups, riders, virtual_gc: Object.fromEntries(ids.map((id) => [id, 0])) };
  const segment = { kind: "flat", from_km: 140, to_km: 150 } as Segment;
  const route = { distance_km: 150, profile_type: "flat", finale_type: finaleType, segments: [segment], weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [] } as unknown as RouteV2;
  const ctx = { ...makeHookCtx({ segment, route, entrants, tuning: RACE_V4_TUNING, seed: "2757-finale", orders: [] }), gcContext, ...(v3 ? { s5ProfilesV3: true as const } : {}) };
  return finaleHook(state, ctx).state.finish_order ?? [];
}

test("#2757: uden v3 vinder den staerke kaptajn massespurten (dagens adfaerd, bit-identisk)", () => {
  for (const f of ["flat_sprint", "bunch_sprint"] as FinaleType[]) assert.equal(finishOrder(f, false)[0], "cap", f);
});

test("#2757: under v3 spurter kaptajnen ikke i massespurten; han ruller ind i feltet uden point-plads", () => {
  for (const f of ["flat_sprint", "bunch_sprint"] as FinaleType[]) {
    const order = finishOrder(f, true);
    assert.equal(order.length, 41, "ingen rytter tabes");
    assert.equal(order[0], "r0", "sprinteren vinder");
    const at = order.indexOf("cap");
    assert.ok(at >= GC_CAPTAIN_ROLL_IN_AFTER && at < GC_CAPTAIN_ROLL_IN_AFTER + GC_CAPTAIN_ROLL_IN_SPREAD, `${f}: kaptajnen paa ${at}`);
    assert.deepEqual(order.filter((id) => id !== "cap"), finishOrder(f, false).filter((id) => id !== "cap"), "de oevrige som foer");
  }
});

test("#2757: under v3 er andre finaler end den flade massespurt uaendrede", () => {
  for (const f of ["uphill_sprint", "punch", "long_climb"] as FinaleType[]) assert.deepEqual(finishOrder(f, true), finishOrder(f, false), f);
});

test("#2757: under v3 i et endagsloeb (eller uden klassement) koerer kaptajnen om sejren som foer", () => {
  for (const gc of [{ status: "one_day" } as GcContext, null]) {
    assert.deepEqual(finishOrder("flat_sprint", true, false, gc), finishOrder("flat_sprint", false, false, gc), String(gc?.status));
  }
});

test("#2757: under v3 koerer en kaptajn i udbruddet stadig om sejren", () => {
  assert.equal(finishOrder("flat_sprint", true, true)[0], finishOrder("flat_sprint", false, true)[0]);
  assert.ok(finishOrder("flat_sprint", true, true).indexOf("cap") <= 1);
});

test("#2757: under v3 spurter sprinteren; kaptajnen forsvarer ikke pointtroejen i feltet", () => {
  const sprint = sprintScene(true);
  assert.equal(sprint?.results[0]?.rider_id, "spr");
  assert.notEqual(sprint?.results[1]?.rider_id, undefined);
});
