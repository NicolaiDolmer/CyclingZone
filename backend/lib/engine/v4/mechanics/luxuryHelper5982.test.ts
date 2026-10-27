// backend/lib/engine/v4/mechanics/luxuryHelper5982.test.ts
// #5982 (KUN s5_profiles_v3): luksushjaelperen er en GENVEJ til etapeplanen (ejer 27/10).
// Garantierne testes som skala-uafhaengige udsagn, aldrig som forventede tal:
// maalingerne ligger privat (private-handoffs/5982/).
//
// TVILLINGER (#7266-moenstret): samme hold, rute og segmenter; den ENESTE forskel er
// rollen. Scenarierne er virkelig cykelsport: en bjergetape med en afgoerende
// slutstigning, kaptajnen der knaekker, en topankomst og en flad spurtetape.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LUXURY_HELPER_ROLE,
  isLuxuryHelper,
  luxuryHelperDefaultPlans,
  luxuryHelperIds,
} from "./luxuryHelper5982.ts";
import { teamPlayHook } from "./teamPlay.ts";
import { morningBreakIntent } from "./breakawayPermission.ts";
import { entrantFromAbilitiesRow, normalizeRole } from "../adapters/entrantAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { simulateStageV4 } from "../index.ts";
import { frozenField, frozenStages } from "../testUtils/oldRevisionDigests6199.ts";
import { VALID_RACE_ROLES, workCost } from "../../../raceRoles.js";
import { RACE_V4_TUNING } from "../tuning.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { advanceStagePlan, createStagePlanRuntime, stagePlanEntrants, stagePlanRouteFromV4 } from "../../../stagePlanEngine.ts";
import { STAGE_PLAN_TASKS, stagePlanRouteFromRaw, suggestStagePlan, validateStagePlanLegs } from "../../../stagePlan.ts";
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
  StageInput,
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

// En bjergetape: en tidlig stigning (Col A), en mellemstraekning og den afgoerende
// slutstigning (Col B) kort foer maal (som en klassisk Tour-bjergetape).
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
/** Segmentet efter Col A's top: her begynder vejen mod den afgoerende stigning. */
const AFTER_COL_A = 2;
const DECISIVE_CLIMB = 5;

const FLAT_ROUTE: RouteV2 = {
  distance_km: 180,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 90 }, { kind: "flat", from_km: 90, to_km: 180 }],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
} as RouteV2;

type Spec = { id: string; role: RiderRole; team?: string; effort?: EffortLevel; lux?: boolean; group?: string; status?: RiderState["status"] };

function entrantsOf(specs: Spec[]): Record<string, Entrant> {
  const out: Record<string, Entrant> = {};
  for (const s of specs) {
    out[s.id] = {
      rider_id: s.id, abilities: abilitiesAt(50), role: s.role, effort: s.effort ?? "normal", condition: 1, team_id: s.team ?? "A",
      ...(s.lux ? { luxury_helper: true as const } : {}),
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

type RunOpts = { route?: RouteV2; v3?: boolean; orders?: TeamOrder[] };

/**
 * Holdspillet med etapeplanen som i segment-loopet (v3: createStagePlanRuntime +
 * advanceStagePlan + stagePlanEntrants foer hvert segment). Aeldre revisioner laeser
 * hverken planen eller krogen. Faktoren efter hvert segment.
 */
function runTeamPlay(specs: Spec[], opts: RunOpts = {}): Array<Record<string, number>> {
  const route = opts.route ?? MOUNTAIN;
  const v3 = opts.v3 !== false;
  const baseEntrants = entrantsOf(specs);
  let state = stateOf(specs);
  const plan = v3 ? createStagePlanRuntime(opts.orders ?? [], route, baseEntrants) : null;
  const trace: Array<Record<string, number>> = [];
  route.segments.forEach((segment, segmentIndex) => {
    if (plan) advanceStagePlan(plan, { state, segment, segmentIndex, isLastSegment: segmentIndex === route.segments.length - 1, entrants: baseEntrants });
    const entrants = plan ? stagePlanEntrants(plan, baseEntrants) : baseEntrants;
    const ctx = { ...makeHookCtx({ segment, segmentIndex, route, entrants, tuning: RACE_V4_TUNING, orders: opts.orders ?? [] }), ...(v3 ? { s5ProfilesV3: true as const, ordersGcV3: true as const } : {}) };
    state = teamPlayHook(state, ctx).state;
    trace.push(Object.fromEntries(Object.keys(state.riders).map((id) => [id, state.riders[id].team_cp_factor ?? 1])));
  });
  return trace;
}

/** Faktoren FOER segment `index` (efter det forrige). */
const before = (trace: Array<Record<string, number>>, index: number, id: string) => (index === 0 ? 1 : trace[index - 1][id]);

const planOrder = (riderId: string, legs: unknown[], team = "A"): TeamOrder => ({ team_id: team, kind: "stage_plan", params: { riders: [{ rider_id: riderId, legs }] } });

/** Luksushjaelperens standardplan paa ruten (det motoren koerer, og det fladen foreslaar). */
const defaultLegs = (route: RouteV2 = MOUNTAIN) => suggestStagePlan({ role: "helper", route: stagePlanRouteFromV4(route), teamHasSprintCaptain: false, luxuryHelper: true });

// Et lille hold: kaptajnen og én arbejder. Fuld stab: kaptajnen, tre hjaelpere og arbejderen.
const small = (lux: boolean, extra: Partial<Spec> = {}): Spec[] => [{ id: "cap", role: "captain" }, { id: "x", role: "helper", lux, ...extra }];
const full = (lux: boolean): Spec[] => [
  { id: "cap", role: "captain" },
  { id: "h1", role: "helper" },
  { id: "h2", role: "helper" },
  { id: "h3", role: "helper" },
  { id: "x", role: "helper", lux },
];

// ── Kontrakten ───────────────────────────────────────────────────────────────

test("#5982: rollen hedder luxury_helper og er med i rolle-vokabularet", () => {
  assert.equal(LUXURY_HELPER_ROLE, "luxury_helper");
  assert.ok(VALID_RACE_ROLES.includes(LUXURY_HELPER_ROLE));
});

test("#5982: motoren ser luksushjaelperen som en hjaelper med markoeren (entrantAdapter)", () => {
  assert.equal(normalizeRole(LUXURY_HELPER_ROLE), "helper");
  const e = entrantFromAbilitiesRow({ rider_id: "r1" }, { role: LUXURY_HELPER_ROLE, teamId: "A" });
  assert.equal(e.role, "helper");
  assert.equal(e.luxury_helper, true);
  assert.ok(isLuxuryHelper(e));
  const plain = entrantFromAbilitiesRow({ rider_id: "r2" }, { role: "helper", teamId: "A" });
  assert.equal("luxury_helper" in plain, false, "en almindelig hjaelper faar ingen markoer (byte-identisk)");
});

test("#5982: luksushjaelperen forsoeger aldrig morgenudbrud uden ordre", () => {
  const e = entrantFromAbilitiesRow({ rider_id: "r1" }, { role: LUXURY_HELPER_ROLE, teamId: "A" });
  for (const effort of ["save", "normal", "protect"] as EffortLevel[]) {
    assert.equal(morningBreakIntent({ role: e.role, effort, tryBreak: undefined }), "none", effort);
  }
  assert.equal(morningBreakIntent({ role: e.role, effort: "normal", tryBreak: true }), "ordered");
});

test("#5982: ordre-adapteren giver luksushjaelperen en hjaelpers standardordre", () => {
  const roster = (role: string) => [
    { team_id: "A", rider_id: "cap", role: "captain", is_ai: false },
    { team_id: "A", rider_id: "spr", role: "sprint_captain", is_ai: false },
    { team_id: "A", rider_id: "x", role, is_ai: false },
  ];
  const plan = (role: string) => buildStageOrderPlan({ rows: [], stageNumber: 1, roster: roster(role) } as unknown as Parameters<typeof buildStageOrderPlan>[0]);
  assert.deepEqual(plan(LUXURY_HELPER_ROLE).orders, plan("helper").orders);
});

test("#5982: gammel motor (v3-broen) koerer luksushjaelperen som en hjaelper med hjaelperens pris", () => {
  for (const profile of ["mountain", "flat", "itt"]) {
    for (const effort of ["save", "normal", "all_out"] as const) {
      assert.equal(workCost(LUXURY_HELPER_ROLE, profile, effort), workCost("helper", profile, effort), `${profile}/${effort}`);
    }
  }
});

// ── Standardplanen (genvejen) ────────────────────────────────────────────────

test("#5982: standardplanen er spar dig -> tempo paa den afgoerende stigning -> i maal naar sat", () => {
  assert.deepEqual(defaultLegs(), [
    { task: "stay_sheltered" },
    { task: "tempo", from: { at: "kom", kom_index: 0 } }, // fra Col A's top = vejen ind paa den afgoerende stigning
    { task: "ride_in", from: { at: "dropped" } },
  ]);
});

test("#5982: topankomst uden tidligere stigning — han arbejder de sidste km", () => {
  const route = stagePlanRouteFromRaw({ distance_km: 150, profile_type: "high_mountain", climbs: [{ name: "Top", crest_km: 150, category: "HC", summit_finish: true }] });
  assert.deepEqual(suggestStagePlan({ role: "helper", route, teamHasSprintCaptain: false, luxuryHelper: true }), [
    { task: "stay_sheltered" }, { task: "tempo", from: { at: "final_km" } }, { task: "ride_in", from: { at: "dropped" } },
  ]);
});

test("#5982: ingen afgoerende stigning (flad etape, enkeltstart) — hjaelperens forslag", () => {
  for (const [profile_type, climbs] of [["flat", []], ["flat", [{ name: "A", crest_km: 40, category: "4" }, { name: "B", crest_km: 90, category: "4" }]], ["hilly", [{ name: "A", crest_km: 50, category: "3" }]]] as const) {
    const route = stagePlanRouteFromRaw({ distance_km: 160, profile_type, climbs });
    for (const teamHasSprintCaptain of [false, true]) {
      assert.deepEqual(
        suggestStagePlan({ role: "helper", route, teamHasSprintCaptain, luxuryHelper: true }),
        suggestStagePlan({ role: "helper", route, teamHasSprintCaptain }),
        `${profile_type}/${climbs.length}`,
      );
    }
  }
  assert.equal(suggestStagePlan({ role: "helper", route: stagePlanRouteFromRaw({ distance_km: 30, profile_type: "itt", climbs: [] }), teamHasSprintCaptain: false, luxuryHelper: true }), null);
});

test("#5982: standardplanen er altid en gyldig hjaelper-plan, og markoeren roerer kun hjaelperens forslag", () => {
  const climbSets = [[], [{ name: "A", crest_km: 50, category: "2" }], [{ name: "A", crest_km: 50, category: "2" }, { name: "B", crest_km: 120, category: "1" }], [{ name: "A", crest_km: 40, category: "3" }, { name: "B", crest_km: 90, category: "HC" }, { name: "C", crest_km: 150, category: "1", summit_finish: true }]];
  for (const profile_type of ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", null]) {
    for (const climbs of climbSets) {
      const route = stagePlanRouteFromRaw({ distance_km: 160, profile_type, climbs });
      const legs = suggestStagePlan({ role: "helper", route, teamHasSprintCaptain: false, luxuryHelper: true });
      assert.ok(legs && validateStagePlanLegs(legs, "helper", route) === null, `${profile_type}/${climbs.length}`);
      for (const role of ["captain", "co_captain", "sprint_captain", "hunter", "free_role"] as const) {
        assert.deepEqual(suggestStagePlan({ role, route, teamHasSprintCaptain: false, luxuryHelper: true }), suggestStagePlan({ role, route, teamHasSprintCaptain: false }), role);
      }
    }
  }
  assert.ok(STAGE_PLAN_TASKS.includes("tempo"));
});

test("#5982: motoren koerer standardplanen for en luksushjaelper uden gemt plan; en gemt plan vinder", () => {
  const entrants = entrantsOf(small(true));
  const rt = createStagePlanRuntime([], MOUNTAIN, entrants)!;
  assert.ok(rt, "en luksushjaelper alene giver en plan");
  assert.deepEqual(rt.legs.get("x")!.map((l) => l.task), defaultLegs()!.map((l) => l.task));
  assert.equal(createStagePlanRuntime([], MOUNTAIN, entrantsOf(small(false))), null, "uden luksushjaelper: ingen plan (byte-identisk)");
  const saved = createStagePlanRuntime([planOrder("x", [{ task: "shelter_leader" }])], MOUNTAIN, entrants)!;
  assert.deepEqual(saved.legs.get("x")!.map((l) => l.task), ["shelter_leader"], "spillerens plan vinder");
  const otherTeam = createStagePlanRuntime([planOrder("x", [{ task: "shelter_leader" }], "B")], MOUNTAIN, entrants)!;
  assert.deepEqual(otherTeam.legs.get("x")!.map((l) => l.task), defaultLegs()!.map((l) => l.task), "et andet holds ordre styrer aldrig rytteren");
});

test("#5982: hoejst én pr. hold — en ekstra markoer paa samme hold er en almindelig hjaelper", () => {
  const entrants = entrantsOf([{ id: "cap", role: "captain" }, { id: "x", role: "helper", lux: true }, { id: "y", role: "helper", lux: true }, { id: "z", role: "helper", lux: true, team: "B" }]);
  assert.deepEqual(luxuryHelperIds(entrants), ["x", "z"]);
  assert.deepEqual(luxuryHelperDefaultPlans(stagePlanRouteFromV4(MOUNTAIN), entrants, () => false).map(([id]) => id), ["x", "z"]);
  const two: Spec[] = [{ id: "cap", role: "captain" }, { id: "x", role: "helper", lux: true }, { id: "y", role: "helper", lux: true }];
  const one: Spec[] = [{ id: "cap", role: "captain" }, { id: "x", role: "helper", lux: true }, { id: "y", role: "helper" }];
  assert.deepEqual(runTeamPlay(two), runTeamPlay(one));
});

// ── Motoren koerer planen (ingen dobbelt logik) ──────────────────────────────

test("#5982 tvilling: med kaptajnen i gruppen er luksushjaelperen PRAECIS en hjaelper med samme plan", () => {
  for (const specs of [small, full]) {
    const lux = runTeamPlay(specs(true));
    const helperWithPlan = runTeamPlay(specs(false), { orders: [planOrder("x", defaultLegs()!)] });
    assert.deepEqual(lux, helperWithPlan);
  }
});

test("#5982: spilleren kan flytte arbejdet i etapeplanen (gemt plan = en hjaelper med den plan)", () => {
  const legs = [{ task: "tempo" }, { task: "ride_in", from: { at: "kom", kom_index: 0 } }];
  for (const specs of [small, full]) {
    assert.deepEqual(runTeamPlay(specs(true), { orders: [planOrder("x", legs)] }), runTeamPlay(specs(false), { orders: [planOrder("x", legs)] }));
  }
});

// ── Tvillinger mod en almindelig hjaelper uden plan ──────────────────────────

for (const [name, specs] of [["lille hold", small], ["fuld stab", full]] as const) {
  test(`#5982 tvilling (${name}): friskere paa vejen mod den afgoerende stigning end en hjaelper`, () => {
    const lux = runTeamPlay(specs(true));
    const helper = runTeamPlay(specs(false));
    assert.ok(before(lux, AFTER_COL_A, "x") > before(helper, AFTER_COL_A, "x"), `${before(lux, AFTER_COL_A, "x")} vs ${before(helper, AFTER_COL_A, "x")}`);
    assert.ok(before(lux, DECISIVE_CLIMB, "x") > before(helper, DECISIVE_CLIMB, "x"), "stadig friskere ved foden");
  });

  test(`#5982 tvilling (${name}): han sparer foer og arbejder fuldt efter skiftet`, () => {
    const lux = runTeamPlay(specs(true));
    const helper = runTeamPlay(specs(false));
    const paid = (t: Array<Record<string, number>>, from: number, to: number) => before(t, from, "x") - before(t, to, "x");
    assert.ok(paid(lux, 0, AFTER_COL_A) < paid(helper, 0, AFTER_COL_A), "foer skiftet: billigere end hjaelperen");
    const segs = MOUNTAIN.segments.length;
    assert.ok(paid(lux, AFTER_COL_A, segs) > 0 && paid(lux, AFTER_COL_A, segs) >= paid(helper, AFTER_COL_A, segs) - 1e-9, "efter skiftet arbejder han mindst som hjaelperen");
    assert.ok(lux.at(-1)!.x >= helper.at(-1)!.x - 1e-12, "aldrig flere kraefter over etapen end hjaelperen");
  });
}

// ── Eget loeb (rolle-reglen) ─────────────────────────────────────────────────

test("#5982 eget loeb: sidder kaptajnen i en anden gruppe (sat), betaler luksushjaelperen intet", () => {
  for (const row of runTeamPlay([{ id: "cap", role: "captain", group: "g1" }, { id: "x", role: "helper", lux: true }])) assert.equal(row.x, 1);
});

test("#5982 eget loeb: er kaptajnen udgaaet (styrt, knaekket), betaler luksushjaelperen intet", () => {
  for (const row of runTeamPlay([{ id: "cap", role: "captain", status: "abandoned" }, { id: "x", role: "helper", lux: true }])) assert.equal(row.x, 1);
});

test("#5982 eget loeb: den delte kaptajn overtager hjaelperne, ikke luksushjaelperen", () => {
  const trace = runTeamPlay([
    { id: "cap", role: "captain", group: "g1" },
    { id: "co", role: "co_captain" },
    { id: "h1", role: "helper" },
    { id: "x", role: "helper", lux: true },
  ]);
  for (const row of trace) assert.equal(row.x, 1, "luksushjaelperen koerer sit eget loeb");
  assert.ok(trace.at(-1)!.co > 1, "den delte kaptajn faar de almindelige hjaelperes laeskaerm");
});

test("#5982 spurtkaptajn som eneste leder: luksushjaelperen koerer for ham", () => {
  const lux = runTeamPlay([{ id: "spr", role: "sprint_captain" }, { id: "x", role: "helper", lux: true }]);
  assert.ok(lux.at(-1)!.spr > 1 && lux.at(-1)!.x < 1);
});

test("#5982: et andet hold paavirkes ikke af at et hold har en luksushjaelper", () => {
  const rival: Spec[] = [{ id: "rc", role: "captain", team: "B" }, { id: "rh", role: "helper", team: "B" }];
  const withLux = runTeamPlay([...full(true), ...rival]);
  const without = runTeamPlay([...full(false), ...rival]);
  for (let i = 0; i < withLux.length; i++) {
    assert.equal(withLux[i].rc, without[i].rc);
    assert.equal(withLux[i].rh, without[i].rh);
  }
});

test("#5982: flad etape uden spurtkaptajn — luksushjaelperen koerer hjaelperens forslag", () => {
  const legs = suggestStagePlan({ role: "helper", route: stagePlanRouteFromV4(FLAT_ROUTE), teamHasSprintCaptain: false });
  assert.deepEqual(runTeamPlay(full(true), { route: FLAT_ROUTE }), runTeamPlay(full(false), { route: FLAT_ROUTE, orders: [planOrder("x", legs!)] }));
});

// ── Byte-identitet ───────────────────────────────────────────────────────────

test("#5982: aeldre revisioner — luksushjaelperen er en almindelig hjaelper i holdspillet (byte-identisk)", () => {
  assert.deepEqual(runTeamPlay(full(true), { v3: false }), runTeamPlay(full(false), { v3: false }));
  assert.deepEqual(runTeamPlay(small(true, { group: "g0" }), { v3: false }), runTeamPlay(small(false), { v3: false }));
});

test("#5982: aeldre revisioner — hele motoren er byte-identisk med en markoer paa startlisten", () => {
  const row = frozenStages().find((r) => r.profile_type === "mountain")!;
  const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
  const field = frozenField();
  for (const rules_revision of ["s5_profiles_v2", "official_times_v1"]) {
    const run = (lux: boolean) => simulateStageV4({
      route, startlist: field.map((e) => (lux && e.rider_id === "t0r2" ? { ...e, luxury_helper: true as const } : e)),
      orders: [], seed: "5982-old", tuning: RACE_V4_TUNING, rules_revision,
    } as StageInput);
    assert.deepEqual(run(true), run(false), rules_revision);
  }
});
