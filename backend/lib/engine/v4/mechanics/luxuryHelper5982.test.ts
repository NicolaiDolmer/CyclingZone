// backend/lib/engine/v4/mechanics/luxuryHelper5982.test.ts
// #5982 (KUN s5_profiles_v3): sidste mand (luksushjaelperen) i motoren.
// Garantierne testes som skala-uafhaengige udsagn (som teamPlay.test.ts og
// sharedCaptain.test.ts), aldrig som forventede tal: tuning-tallene og
// maalingerne ligger privat (private-handoffs/5982/).
//
// TVILLINGER (#7266-moenstret): samme hold, rute og segmenter; den ENESTE forskel
// er om rytteren er sidste mand eller almindelig hjaelper. Scenarierne er
// virkelig cykelsport: en bjergetape med en afgoerende slutstigning, kaptajnen der
// knaekker, et lille hold, og etapeplanen der peger paa en tidligere stigning.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LAST_MAN_TUNING,
  LUXURY_HELPER_ROLE,
  decisiveClimbIndex,
  isLastMan,
  lastManWindow,
  planKomIndex,
} from "./luxuryHelper5982.ts";
import { teamPlayHook } from "./teamPlay.ts";
import { morningBreakIntent } from "./breakawayPermission.ts";
import { entrantFromAbilitiesRow, normalizeRole } from "../adapters/entrantAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { VALID_RACE_ROLES, workCost } from "../../../raceRoles.js";
import { RACE_V4_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { advanceStagePlan, createStagePlanRuntime, stagePlanEntrants } from "../../../stagePlanEngine.ts";
import type {
  AbilityKey,
  EffortLevel,
  EngineState,
  Entrant,
  RaceGroup,
  RiderRole,
  RiderState,
  RouteV2,
  Segment,
  TeamOrder,
} from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilitiesAt(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = level;
  return out;
}

// En bjergetape: en tidlig stigning, en lang mellemstrækning og en afgoerende
// slutstigning kort foer maal (som en klassisk Tour-bjergetape).
const MOUNTAIN_SEGMENTS: Segment[] = [
  { kind: "flat", from_km: 0, to_km: 60 },
  { kind: "climb", from_km: 60, to_km: 72, category: "2", avg_gradient: 6, top_elevation_m: 1200 },
  { kind: "descent", from_km: 72, to_km: 84, technicality: 2 },
  { kind: "rolling", from_km: 84, to_km: 150 },
  { kind: "flat", from_km: 150, to_km: 162 },
  { kind: "climb", from_km: 162, to_km: 178, category: "HC", avg_gradient: 8, top_elevation_m: 2100 },
  { kind: "flat", from_km: 178, to_km: 182 },
];
const MOUNTAIN: RouteV2 = {
  distance_km: 182,
  profile_type: "mountain",
  finale_type: "long_climb",
  segments: MOUNTAIN_SEGMENTS,
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [
    { kind: "kom", index: 0, name: "Col A", km: 72, category: "2" },
    { kind: "kom", index: 1, name: "Col B", km: 178, category: "HC" },
    { kind: "finish", index: 0, name: "Maal", km: 182 },
  ],
} as RouteV2;
const DEFAULT_CLIMB = 5;
const EARLY_CLIMB = 1;

const FLAT_ROUTE: RouteV2 = {
  distance_km: 180,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 90 }, { kind: "flat", from_km: 90, to_km: 180 }],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
} as RouteV2;

type Spec = { id: string; role: RiderRole; team?: string; effort?: EffortLevel; lastMan?: boolean; group?: string; status?: RiderState["status"] };

function entrantsOf(specs: Spec[]): Record<string, Entrant> {
  const out: Record<string, Entrant> = {};
  for (const s of specs) {
    out[s.id] = {
      rider_id: s.id, abilities: abilitiesAt(50), role: s.role, effort: s.effort ?? "normal", condition: 1, team_id: s.team ?? "A",
      ...(s.lastMan ? { luxury_helper: true as const } : {}),
    };
  }
  return out;
}

function stateOf(specs: Spec[]): EngineState {
  const riders: Record<string, RiderState> = {};
  const members = new Map<string, string[]>();
  const order: string[] = [];
  for (const s of specs) {
    const g = s.group ?? "g0";
    riders[s.id] = {
      rider_id: s.id, group_id: g, cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
      seconds_over_cp: 0, work_norm: 0, incidents: 0, status: s.status ?? "racing", time_seconds: 0,
    };
    if (!members.has(g)) { members.set(g, []); order.push(g); }
    members.get(g)!.push(s.id);
  }
  const groups: RaceGroup[] = order.map((id, i) => ({ id, kind: i === 0 ? "peloton" : "chase", rider_ids: members.get(id)!, gap_seconds: i * 30, cohesion: 1 } as RaceGroup));
  return { groups, riders } as unknown as EngineState;
}

type RunOpts = { route?: RouteV2; v3?: boolean; orders?: TeamOrder[]; applyPlan?: boolean };

/**
 * Holdspillet alene over hele ruten (ingen anden mekanik), faktoren efter hvert segment.
 * `applyPlan`: etapeplanens indsats skifter undervejs som i segment-loopet (stagePlanEngine).
 */
function runTeamPlay(specs: Spec[], opts: RunOpts = {}): Array<Record<string, number>> {
  const route = opts.route ?? MOUNTAIN;
  const baseEntrants = entrantsOf(specs);
  let state = stateOf(specs);
  const plan = opts.applyPlan ? createStagePlanRuntime(opts.orders ?? [], route, baseEntrants) : null;
  const trace: Array<Record<string, number>> = [];
  route.segments.forEach((segment, segmentIndex) => {
    if (plan) advanceStagePlan(plan, { state, segment, segmentIndex, isLastSegment: segmentIndex === route.segments.length - 1, entrants: baseEntrants });
    const entrants = plan ? stagePlanEntrants(plan, baseEntrants) : baseEntrants;
    const ctx = { ...makeHookCtx({ segment, segmentIndex, route, entrants, tuning: RACE_V4_TUNING, orders: opts.orders ?? [] }), ...(opts.v3 === false ? {} : { s5ProfilesV3: true as const, ordersGcV3: true as const }) };
    state = teamPlayHook(state, ctx).state;
    trace.push(Object.fromEntries(Object.keys(state.riders).map((id) => [id, state.riders[id].team_cp_factor ?? 1])));
  });
  return trace;
}

/** Faktoren FOER segment `index` (efter det forrige). */
const before = (trace: Array<Record<string, number>>, index: number, id: string) => (index === 0 ? 1 : trace[index - 1][id]);

/** Segmentet hvor arbejdsvinduet foran stigningen begynder. */
function windowStart(climb: number, route: RouteV2 = MOUNTAIN): number {
  const w = lastManWindow(route, climb)!;
  return route.segments.findIndex((s) => s.from_km <= w.fromKm && w.fromKm < s.to_km);
}

// Et lille hold: kaptajnen og én arbejder (tvillingen: sidste mand vs hjaelper).
const small = (lastMan: boolean, extra: Partial<Spec> = {}): Spec[] => [
  { id: "cap", role: "captain" },
  { id: "x", role: "helper", lastMan, ...extra },
];

// Fuld stab: kaptajnen, tre hjaelpere og arbejderen.
const full = (lastMan: boolean): Spec[] => [
  { id: "cap", role: "captain" },
  { id: "h1", role: "helper" },
  { id: "h2", role: "helper" },
  { id: "h3", role: "helper" },
  { id: "x", role: "helper", lastMan },
];

// ── Kontrakten ───────────────────────────────────────────────────────────────

test("#5982: rollen hedder luxury_helper og er med i rolle-vokabularet", () => {
  assert.equal(LUXURY_HELPER_ROLE, "luxury_helper");
  assert.ok(VALID_RACE_ROLES.includes(LUXURY_HELPER_ROLE));
});

test("#5982: motoren ser sidste mand som en hjaelper med markoeren (entrantAdapter)", () => {
  assert.equal(normalizeRole(LUXURY_HELPER_ROLE), "helper");
  const e = entrantFromAbilitiesRow({ rider_id: "r1" }, { role: LUXURY_HELPER_ROLE, teamId: "A" });
  assert.equal(e.role, "helper");
  assert.equal(e.luxury_helper, true);
  assert.ok(isLastMan(e));
  const plain = entrantFromAbilitiesRow({ rider_id: "r2" }, { role: "helper", teamId: "A" });
  assert.equal("luxury_helper" in plain, false, "en almindelig hjaelper faar ingen markoer (byte-identisk)");
});

test("#5982: sidste mand forsoeger aldrig morgenudbrud uden ordre (sparer sig)", () => {
  const e = entrantFromAbilitiesRow({ rider_id: "r1" }, { role: LUXURY_HELPER_ROLE, teamId: "A" });
  for (const effort of ["save", "normal", "protect"] as EffortLevel[]) {
    assert.equal(morningBreakIntent({ role: e.role, effort, tryBreak: undefined }), "none", effort);
  }
  assert.equal(morningBreakIntent({ role: e.role, effort: "normal", tryBreak: true }), "ordered");
});

test("#5982: ordre-adapteren giver sidste mand en hjaelpers standardordre", () => {
  const roster = (role: string) => [
    { team_id: "A", rider_id: "cap", role: "captain", is_ai: false },
    { team_id: "A", rider_id: "spr", role: "sprint_captain", is_ai: false },
    { team_id: "A", rider_id: "x", role, is_ai: false },
  ];
  const plan = (role: string) => buildStageOrderPlan({ rows: [], stageNumber: 1, roster: roster(role) } as unknown as Parameters<typeof buildStageOrderPlan>[0]);
  assert.deepEqual(plan(LUXURY_HELPER_ROLE).orders, plan("helper").orders);
});

test("#5982: gammel motor (v3-broen) koerer sidste mand som en hjaelper med hjaelperens pris", () => {
  for (const profile of ["mountain", "flat", "itt"]) {
    for (const effort of ["save", "normal", "all_out"] as const) {
      assert.equal(workCost(LUXURY_HELPER_ROLE, profile, effort), workCost("helper", profile, effort), `${profile}/${effort}`);
    }
  }
});

// ── Den afgoerende stigning ──────────────────────────────────────────────────

test("#5982: den afgoerende stigning er rutens sidste kategoriserede stigning", () => {
  assert.equal(decisiveClimbIndex(MOUNTAIN, null), DEFAULT_CLIMB);
  assert.equal(decisiveClimbIndex(FLAT_ROUTE, null), -1);
});

test("#5982: etapeplanens rutepunkt kan vaelge en anden stigning; et ukendt punkt falder tilbage", () => {
  assert.equal(decisiveClimbIndex(MOUNTAIN, 0), EARLY_CLIMB);
  assert.equal(decisiveClimbIndex(MOUNTAIN, 1), DEFAULT_CLIMB);
  assert.equal(decisiveClimbIndex(MOUNTAIN, 7), DEFAULT_CLIMB);
});

test("#5982: planKomIndex laeser kun rytterens eget holds etapeplan", () => {
  const order = (team: string): TeamOrder => ({
    team_id: team, kind: "stage_plan",
    params: { riders: [{ rider_id: "x", legs: [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }] }] },
  });
  assert.equal(planKomIndex([order("A")], "x", "A"), 0);
  assert.equal(planKomIndex([order("B")], "x", "A"), null, "et andet holds ordre styrer aldrig rytteren");
  assert.equal(planKomIndex([], "x", "A"), null);
});

test("#5982: arbejdsvinduet er de sidste km op til foden af stigningen", () => {
  const w = lastManWindow(MOUNTAIN, DEFAULT_CLIMB)!;
  assert.equal(w.climb, DEFAULT_CLIMB);
  assert.equal(w.toKm, MOUNTAIN_SEGMENTS[DEFAULT_CLIMB].from_km, "vinduet slutter ved foden");
  assert.equal(w.toKm - w.fromKm, LAST_MAN_TUNING.approachKm);
  assert.ok(w.beforeShare > 0 && w.windowShare > 0 && w.beforeShare + w.windowShare <= 1 + 1e-12);
  assert.equal(lastManWindow(MOUNTAIN, 0), null, "et ikke-stigningssegment giver intet vindue");
  const climbAtStart = { ...MOUNTAIN, segments: [{ kind: "climb", from_km: 0, to_km: 8, category: "3", avg_gradient: 5, top_elevation_m: 600 }, ...MOUNTAIN_SEGMENTS.slice(1)] } as RouteV2;
  const atStart = lastManWindow(climbAtStart, 0)!;
  assert.deepEqual([atStart.fromKm, atStart.toKm], [0, 8], "uden tilloeb er vinduet selve stigningen");
});

// ── Byte-identitet ───────────────────────────────────────────────────────────

test("#5982: aeldre revisioner — sidste mand er en almindelig hjaelper (byte-identisk)", () => {
  assert.deepEqual(runTeamPlay(full(true), { v3: false }), runTeamPlay(full(false), { v3: false }));
  assert.deepEqual(runTeamPlay(small(true), { v3: false }), runTeamPlay(small(false), { v3: false }));
});

test("#5982: \"Alt ud\" — sidste mand koerer for sig selv, som en hjaelper paa alt ud", () => {
  assert.deepEqual(runTeamPlay(small(true, { effort: "all_out" })), runTeamPlay(small(false, { effort: "all_out" })));
});

test("#5982: en rute uden kategoriseret stigning — sidste mand er en almindelig hjaelper", () => {
  assert.deepEqual(runTeamPlay(full(true), { route: FLAT_ROUTE }), runTeamPlay(full(false), { route: FLAT_ROUTE }));
});

test("#5982: hoejst én pr. hold — en ekstra markoer paa samme hold er en almindelig hjaelper", () => {
  const two: Spec[] = [{ id: "cap", role: "captain" }, { id: "x", role: "helper", lastMan: true }, { id: "y", role: "helper", lastMan: true }];
  const one: Spec[] = [{ id: "cap", role: "captain" }, { id: "x", role: "helper", lastMan: true }, { id: "y", role: "helper" }];
  assert.deepEqual(runTeamPlay(two), runTeamPlay(one));
});

test("#5982: et andet hold paavirkes ikke af at et hold har en sidste mand", () => {
  const rival: Spec[] = [{ id: "rc", role: "captain", team: "B" }, { id: "rh", role: "helper", team: "B" }];
  const withLm = runTeamPlay([...full(true), ...rival]);
  const without = runTeamPlay([...full(false), ...rival]);
  for (let i = 0; i < withLm.length; i++) {
    assert.equal(withLm[i].rc, without[i].rc);
    assert.equal(withLm[i].rh, without[i].rh);
  }
});

// ── Tvillinger: mere hjaelp paa den afgoerende stigning, mindre traethed foer ─

for (const [name, specs] of [["lille hold", small], ["fuld stab", full]] as const) {
  test(`#5982 tvilling (${name}): mindre traethed foer den afgoerende stigning`, () => {
    const lm = runTeamPlay(specs(true));
    const helper = runTeamPlay(specs(false));
    const start = windowStart(DEFAULT_CLIMB);
    assert.ok(before(lm, start, "x") > before(helper, start, "x"), `sidste mand friskere ved vinduet: ${before(lm, start, "x")} vs ${before(helper, start, "x")}`);
  });

  test(`#5982 tvilling (${name}): kaptajnen faar maalbart mere hjaelp paa den afgoerende stigning`, () => {
    const lm = runTeamPlay(specs(true));
    const helper = runTeamPlay(specs(false));
    const start = windowStart(DEFAULT_CLIMB);
    const climb = DEFAULT_CLIMB;
    // Hjaelpen der virker PAA stigningen, er den der er givet paa vej ind i den
    // (team_cp_factor laeses af naeste segments tick): kaptajnens faktor ved foden.
    const gainLm = before(lm, climb, "cap") - before(lm, start, "cap");
    const gainHelper = before(helper, climb, "cap") - before(helper, start, "cap");
    assert.ok(gainLm > gainHelper, `hjaelp ind i stigningen: ${gainLm} vs ${gainHelper}`);
    assert.ok(before(lm, climb, "cap") >= before(helper, climb, "cap"), "kaptajnen er mindst lige saa frisk ved foden");
  });
}

test("#5982 tvilling: sidste mand bruger aldrig flere kraefter over etapen end en almindelig hjaelper", () => {
  for (const specs of [small, full]) {
    const last = runTeamPlay(specs(true)).at(-1)!;
    const helper = runTeamPlay(specs(false)).at(-1)!;
    assert.ok(1 - last.x <= 1 - helper.x + 1e-12, `pris ${1 - last.x} vs ${1 - helper.x}`);
  }
});

test("#5982 bevarelse: kaptajnens laeskaerm overstiger aldrig holdets pris gange effektiviteten", () => {
  const end = runTeamPlay(small(true)).at(-1)!;
  const paid = 1 - end.x;
  const gained = end.cap - 1;
  assert.ok(gained >= 0 && paid > 0);
  assert.ok(gained <= paid * TEAM_PLAY_EXTRA_TUNING.transferEfficiency + 1e-12, `${gained} > ${paid} x effektivitet`);
});

test("#5982 bounded: kaptajnens faktor holder sig under holdspillets loft ogsaa med sidste mand", () => {
  for (const row of runTeamPlay(full(true))) {
    assert.ok(row.cap <= 1 + TEAM_PLAY_EXTRA_TUNING.captainMaxBonusFraction + 1e-12);
  }
  assert.ok(LAST_MAN_TUNING.ceilingShareOfCaptainMax > 0 && LAST_MAN_TUNING.approachKm > 0);
});

// ── Eget loeb ────────────────────────────────────────────────────────────────

test("#5982 eget loeb: sidder kaptajnen i en anden gruppe (sat), betaler sidste mand intet", () => {
  const trace = runTeamPlay([{ id: "cap", role: "captain", group: "g1" }, { id: "x", role: "helper", lastMan: true }]);
  for (const row of trace) assert.equal(row.x, 1);
});

test("#5982 eget loeb: er kaptajnen udgaaet (styrt, knaekket), betaler sidste mand intet", () => {
  const trace = runTeamPlay([{ id: "cap", role: "captain", status: "abandoned" }, { id: "x", role: "helper", lastMan: true }]);
  for (const row of trace) assert.equal(row.x, 1);
});

test("#5982 eget loeb: den delte kaptajn overtager hjaelperne, ikke sidste mand", () => {
  const specs: Spec[] = [
    { id: "cap", role: "captain", group: "g1" },
    { id: "co", role: "co_captain" },
    { id: "h1", role: "helper" },
    { id: "x", role: "helper", lastMan: true },
  ];
  const trace = runTeamPlay(specs);
  for (const row of trace) assert.equal(row.x, 1, "sidste mand koerer sit eget loeb");
  assert.ok(trace.at(-1)!.co > 1, "den delte kaptajn faar de almindelige hjaelperes laeskaerm");
});

test("#5982 spurtkaptajn som eneste leder: sidste mand koerer for ham", () => {
  const lm = runTeamPlay([{ id: "spr", role: "sprint_captain" }, { id: "x", role: "helper", lastMan: true }]);
  assert.ok(before(lm, DEFAULT_CLIMB, "spr") > before(lm, windowStart(DEFAULT_CLIMB), "spr"));
});

// ── Etapeplanen vaelger stigningen ───────────────────────────────────────────

test("#5982: etapeplanens rutepunkt flytter arbejdet til den valgte stigning", () => {
  const orders: TeamOrder[] = [{
    team_id: "A", kind: "stage_plan",
    params: { riders: [{ rider_id: "x", legs: [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }] }] },
  }];
  const planned = runTeamPlay(small(true), { orders });
  const earlyStart = windowStart(EARLY_CLIMB);
  const gainEarly = before(planned, EARLY_CLIMB, "cap") - before(planned, earlyStart, "cap");
  const defaultRun = runTeamPlay(small(true));
  const gainEarlyDefault = before(defaultRun, EARLY_CLIMB, "cap") - before(defaultRun, earlyStart, "cap");
  assert.ok(gainEarly > gainEarlyDefault, "mere hjaelp ind i den valgte (tidlige) stigning");
  // Efter sit arbejde er han toemt og ruller i maal: ingen pris resten af etapen, heller ikke paa slutstigningen.
  for (let i = EARLY_CLIMB; i < planned.length; i++) assert.equal(planned[i].x, planned[EARLY_CLIMB - 1].x, `segment ${i}`);
});

test("#5982 tvilling: etapeplanens indsats-skift undervejs — sidste mand betaler aldrig mere end en hjaelper med samme plan", () => {
  // Codex-fund: "tempo" til en tidlig stigning og derefter "ride_in". Hjaelperen betaler fuld
  // pris kun til skiftet og derefter den lave; sidste mands budget skal foelge samme plan.
  const plans: Array<Array<Record<string, unknown>>> = [
    [{ task: "tempo" }, { task: "ride_in", from: { at: "kom", kom_index: 0 } }],
    [{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }, { task: "ride_in", from: { at: "final_km" } }],
    [{ task: "tempo" }, { task: "ride_in", from: { at: "final_km" } }],
  ];
  for (const legs of plans) {
    const orders: TeamOrder[] = [{ team_id: "A", kind: "stage_plan", params: { riders: [{ rider_id: "x", legs }] } }];
    for (const specs of [small, full]) {
      const last = runTeamPlay(specs(true), { orders, applyPlan: true }).at(-1)!;
      const helper = runTeamPlay(specs(false), { orders, applyPlan: true }).at(-1)!;
      assert.ok(1 - last.x <= 1 - helper.x + 1e-12, `${JSON.stringify(legs)}: pris ${1 - last.x} vs ${1 - helper.x}`);
      assert.ok(1 - last.x > 0, "han arbejder stadig");
    }
  }
});

test("#5982: sidste mand bruger hele sit budget naar kaptajnen er med hele dagen (ingen gratis personlig gevinst)", () => {
  for (const specs of [small, full]) {
    const last = runTeamPlay(specs(true)).at(-1)!;
    const helper = runTeamPlay(specs(false)).at(-1)!;
    assert.ok(Math.abs((1 - last.x) - (1 - helper.x)) < 1e-9, `samme samlede pris: ${1 - last.x} vs ${1 - helper.x}`);
  }
});
