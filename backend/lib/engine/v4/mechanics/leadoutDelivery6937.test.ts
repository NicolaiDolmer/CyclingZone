// backend/lib/engine/v4/mechanics/leadoutDelivery6937.test.ts
// #6937 (ejer-direktiv 24/10, KUN s5_profiles_v3): lead-outen slaar sjaeldent sin
// egen sprintkaptajn. Naar kaptajnen er i finalen, betaler hans lead-out-ryttere en
// fast pris i placerings-scoren (de saetter sig op efter afleveringen). Det haenger
// sammen med evnerne: en lead-out der er klart bedre end kaptajnen kan stadig slaa
// ham. Uden v3-flaget er finalen bit-identisk. Egen fil (ikke leadout.test.ts /
// finale.test.ts), saa den ikke kolliderer med andre spors aendringer dér.

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyLeadoutDeliveryCost, LEADOUT_ORDER_KIND, type LeadoutOrder } from "./leadout.ts";
import { finaleHook } from "../finale.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { LEADOUT_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, EngineState, RiderState, RouteV2, Segment, TeamOrder } from "../types.ts";

// ── applyLeadoutDeliveryCost (ren) ────────────────────────────────────────────

const ORDER: LeadoutOrder = { team_id: "T", captain_rider_id: "cap", leadout_rider_ids: ["lo1", "lo2"] };
const SCORED = [
  { riderId: "cap", score: 0.7 },
  { riderId: "lo1", score: 0.8 },
  { riderId: "lo2", score: 0.6 },
  { riderId: "other", score: 0.75 },
];

test("#6937: lead-out-ryttere i puljen betaler prisen naar kaptajnen er med; kaptajn og andre er uroerte", () => {
  const out = applyLeadoutDeliveryCost(SCORED, [ORDER], new Set(["cap", "lo1", "lo2", "other"]), 0.25);
  assert.deepEqual(out.map((s) => [s.riderId, Math.round(s.score * 100) / 100]), [["cap", 0.7], ["lo1", 0.55], ["lo2", 0.35], ["other", 0.75]]);
  assert.equal(SCORED[1].score, 0.8, "input muteres aldrig");
});

test("#6937: ingen kaptajn i puljen (sat af, styrtet) -> lead-outen koerer sin egen spurt", () => {
  const out = applyLeadoutDeliveryCost(SCORED, [ORDER], new Set(["lo1", "lo2", "other"]), 0.25);
  assert.deepEqual(out.map((s) => s.score), SCORED.map((s) => s.score));
});

test("#6937: pris 0 eller ugyldig aendrer intet; en rytter der selv er maal betaler aldrig", () => {
  assert.deepEqual(applyLeadoutDeliveryCost(SCORED, [ORDER], new Set(["cap", "lo1"]), 0).map((s) => s.score), SCORED.map((s) => s.score));
  assert.deepEqual(applyLeadoutDeliveryCost(SCORED, [ORDER], new Set(["cap", "lo1"]), Number.NaN).map((s) => s.score), SCORED.map((s) => s.score));
  const crossed: LeadoutOrder = { team_id: "U", captain_rider_id: "lo1", leadout_rider_ids: ["cap"] };
  const out = applyLeadoutDeliveryCost(SCORED, [ORDER, crossed], new Set(["cap", "lo1"]), 0.25);
  assert.deepEqual(out.slice(0, 2).map((s) => s.score), [0.7, 0.8]);
});

// ── finaleHook: massespurten ──────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(base: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = base;
  return { ...out, ...overrides };
}

function entrant(id: string, team: string, role: Entrant["role"], ab: Record<AbilityKey, number>): Entrant {
  return { rider_id: id, team_id: team, abilities: ab, role, effort: "normal", condition: 1 } as Entrant;
}

function riderState(id: string): RiderState {
  return {
    rider_id: id, group_id: "peloton-0", cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  } as RiderState;
}

const SEGMENT: Segment = { kind: "flat", from_km: 140, to_km: 150 } as Segment;
const ROUTE: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint", segments: [SEGMENT],
  weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [],
} as RouteV2;

function sprint(lead: Record<AbilityKey, number>, captain: Record<AbilityKey, number>, v3: boolean): string[] {
  const entrants: Record<string, Entrant> = {
    cap: entrant("cap", "T", "sprint_captain", captain),
    lo: entrant("lo", "T", "helper", lead),
    x: entrant("x", "X", "free_role", abilities(30)),
  };
  const ids = Object.keys(entrants);
  const state: EngineState = {
    km: 140, groups: [{ id: "peloton-0", kind: "peloton", rider_ids: ids, gap_seconds: 0, cohesion: 1 }],
    riders: Object.fromEntries(ids.map((id) => [id, riderState(id)])), virtual_gc: Object.fromEntries(ids.map((id) => [id, 0])),
  };
  const orders: TeamOrder[] = [{ team_id: "T", kind: LEADOUT_ORDER_KIND, params: { captain_rider_id: "cap", leadout_rider_ids: ["lo"] } }];
  const ctx = { ...makeHookCtx({ segment: SEGMENT, route: ROUTE, entrants, tuning: RACE_V4_TUNING, seed: "6937-leadout", orders }), ...(v3 ? { s5ProfilesV3: true as const } : {}) };
  return finaleHook(state, ctx).state.finish_order ?? [];
}

// Lead-outen har den hoejeste score paa papiret (positionering og acceleration), men
// kaptajnen er den bedste sprinter.
const CAPTAIN = abilities(60, { sprint: 95 });
const LEADOUT = abilities(95, { sprint: 85 });

test("#6937: uden v3 slaar en lead-out med hoejere score sin sprintkaptajn (dagens fejl)", () => {
  const order = sprint(LEADOUT, CAPTAIN, false);
  assert.ok(order.indexOf("lo") < order.indexOf("cap"), `forventede lo foer cap, fik ${order.join(",")}`);
});

test("#6937: under v3 saetter lead-outen sig op: sprintkaptajnen slutter foran ham", () => {
  const order = sprint(LEADOUT, CAPTAIN, true);
  assert.ok(order.indexOf("cap") < order.indexOf("lo"), `forventede cap foer lo, fik ${order.join(",")}`);
});

test("#6937: en lead-out der er klart bedre end kaptajnen kan stadig slaa ham under v3", () => {
  const order = sprint(abilities(99), abilities(40), true);
  assert.ok(order.indexOf("lo") < order.indexOf("cap"), `forventede lo foer cap, fik ${order.join(",")}`);
});

test("#6937: prisen er positiv og mindre end hele evne-skalaen (bounded, ingen deterministisk straf)", () => {
  assert.ok(LEADOUT_EXTRA_TUNING.deliveryScoreCostV3 > 0 && LEADOUT_EXTRA_TUNING.deliveryScoreCostV3 < 1);
});
