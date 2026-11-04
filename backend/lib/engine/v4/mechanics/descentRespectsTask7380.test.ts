// backend/lib/engine/v4/mechanics/descentRespectsTask7380.test.ts
// #7380 (ejer-beslutning 30/10, taendt 31/10, kontakten fjernet): nedkoersels-
// angrebet respekterer rytterens ordre. Kontrakten:
//   1. Reglen gaelder kun under s5_profiles_v3 og senere; uden den er nedkoerslen
//      uroert: ordrer og indsats aendrer intet.
//   2. Under s5_profiles_v3 angriber ingen paa Spar, Grupetto, Beskyt lederen eller
//      en laee-/hjaelperopgave; fri rolle, leder, angreb, foelg angreb, udbrud og
//      normal/alt ud maa stadig.
//   3. Ordren kan kun FJERNE angreb, aldrig skabe et nyt, og monotonien
//      (praefiks-egenskaben) holder blandt de ryttere hvis ordre tillader angreb.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";

import {
  DESCENT_ATTACK_BARRED_TASKS_7380,
  descentAttackBarredByTask7380,
  descentHook,
  isDescentTask7380On,
} from "./descent.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { LIVE_MECHANIC_HOOKS } from "../index.ts";
import { runSegmentLoop } from "../segmentLoop.ts";
import {
  STAGE_PLAN_LEG_EVENT,
  advanceStagePlan,
  createStagePlanRuntime,
  isRiderDropped,
  stagePlanCurrentTasks,
  stagePlanEntrants,
  type StagePlanRuntime,
} from "../../../stagePlanEngine.ts";
import { STAGE_PLAN_TASKS, TASK_EFFORT, type StagePlanTask } from "../../../stagePlan.ts";
import type {
  AbilityKey,
  DescentSegment,
  EffortLevel,
  EngineState,
  Entrant,
  RaceGroup,
  RiderRole,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
  StageInput,
  TeamOrder,
  TimelineEvent,
} from "../types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Fixtures ───────────────────────────────────────────────────────────────

const EFFORTS: readonly EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
const ROLES: readonly RiderRole[] = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"];

function abilities(descending: number): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
}

type RiderSpec = { id: string; descending: number; effort?: EffortLevel; role?: RiderRole; team?: string };

function riderState(id: string, groupId: string): RiderState {
  return {
    rider_id: id, group_id: groupId, cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  };
}

const ROUTE: RouteV2 = {
  distance_km: 100,
  profile_type: "hilly",
  finale_type: "descent",
  segments: [],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [{ kind: "kom", km: 30, index: 0, category: "2", name: "Col A" }],
};

function scenario(
  riders: readonly RiderSpec[],
  opts: {
    technicality?: 1 | 2 | 3;
    orders?: TeamOrder[];
    s5ProfilesV3?: boolean;
    groupOrigin?: "breakaway";
    seed?: string;
    /** Runtimens opgaver (segmentLoop.ts saetter dem fra stagePlanEngine.stagePlanCurrentTasks). */
    stagePlanTasks?: Record<string, StagePlanTask>;
  } = {},
): { state: EngineState; ctx: SegmentHookContext } {
  const entrants: Record<string, Entrant> = {};
  const states: Record<string, RiderState> = {};
  for (const r of riders) {
    entrants[r.id] = {
      rider_id: r.id,
      abilities: abilities(r.descending),
      role: r.role ?? "free_role",
      effort: opts.stagePlanTasks?.[r.id] ? TASK_EFFORT[opts.stagePlanTasks[r.id]] : r.effort ?? "normal",
      condition: 1,
      team_id: r.team ?? "team-a",
    };
    states[r.id] = riderState(r.id, "g-0");
  }
  const group: RaceGroup = {
    id: "g-0",
    kind: opts.groupOrigin === "breakaway" ? "breakaway" : "peloton",
    rider_ids: riders.map((r) => r.id),
    gap_seconds: 0,
    cohesion: 1,
    ...(opts.groupOrigin ? { origin: opts.groupOrigin } : {}),
  };
  const segment: DescentSegment = { kind: "descent", from_km: 40, to_km: 48, technicality: opts.technicality ?? 3 };
  const base = makeHookCtx({
    segment,
    segmentIndex: 3,
    route: ROUTE,
    entrants,
    tuning: RACE_V4_TUNING,
    seed: opts.seed ?? "descent-7380",
    orders: opts.orders ?? [],
  });
  const withTasks: SegmentHookContext = opts.stagePlanTasks ? { ...base, stagePlanTasks: opts.stagePlanTasks } : base;
  const ctx: SegmentHookContext = opts.s5ProfilesV3 === false ? withTasks : { ...withTasks, s5ProfilesV3: true };
  return { state: { km: 40, groups: [group], riders: states, virtual_gc: {} }, ctx };
}

function attackerIds(events: readonly TimelineEvent[]): string[] {
  return events
    .filter((e) => e.type === "finale_attack")
    .flatMap((e) => (e.params as { rider_ids: string[] }).rider_ids)
    .sort();
}

/** Angriberne paa nedkoerslen; `s5ProfilesV3: false` = en aeldre revision, hvor #7380 ikke gaelder. */
function attackersFor(riders: readonly RiderSpec[], opts: Parameters<typeof scenario>[1] = {}): string[] {
  const s = scenario(riders, opts);
  return attackerIds(descentHook(s.state, s.ctx).events);
}

function planOrder(team: string, riders: Array<{ rider_id: string; legs: unknown[] }>): TeamOrder {
  return { team_id: team, kind: "stage_plan", params: { riders } };
}

// To staerke nedkoerere (samme vindue) og en svag: uden ordrer angriber de to staerke.
const STRONG_A = 90;
const STRONG_B = 88;
const WEAK = 20;

// ── 1. Kun s5_profiles_v3; aeldre revisioner er uroert ──────────────────────

test("#7380: gaelder altid under s5_profiles_v3, aldrig paa aeldre revisioner", () => {
  assert.equal(isDescentTask7380On({ s5ProfilesV3: true }), true);
  assert.equal(isDescentTask7380On({}), false, "kun s5_profiles_v3 og senere");
});

test("#7380: uden s5_profiles_v3 er nedkoerslen uroert: ordrer og indsats aendrer intet", () => {
  const specArb = fc.array(
    fc.record({
      descending: fc.integer({ min: 0, max: 99 }),
      effort: fc.constantFrom(...EFFORTS),
      role: fc.constantFrom(...ROLES),
    }),
    { minLength: 2, maxLength: 9 },
  );
  fc.assert(
    fc.property(specArb, fc.constantFrom<1 | 2 | 3>(1, 2, 3), (specs, technicality) => {
      const riders = specs.map((s, i) => ({ id: `r${i}`, ...s }));
      // Referencen: samme ryttere og roller uden ordre-signal (alle normal, ingen plan).
      const neutral = riders.map((r) => ({ id: r.id, descending: r.descending, role: r.role }));
      const orders = [planOrder("team-a", riders.map((r) => ({ rider_id: r.id, legs: [{ task: "stay_sheltered" }] })))];
      const tasks: Record<string, StagePlanTask> = Object.fromEntries(riders.map((r, i) => [r.id, STAGE_PLAN_TASKS[i % STAGE_PLAN_TASKS.length]]));
      const run = (rs: RiderSpec[], o: TeamOrder[], t?: Record<string, StagePlanTask>) => {
        const { state, ctx } = scenario(rs, { technicality, orders: o, s5ProfilesV3: false, stagePlanTasks: t });
        const result = descentHook(state, ctx);
        return { result, state };
      };
      const ref = run(neutral, []);
      const got = run(riders, orders);
      // Ogsaa med runtimens opgaver i ctx (og den indsats de giver): aeldre revision aendrer intet.
      const gotTasks = run(neutral, orders, tasks);
      const refTasks = run(neutral, [], tasks);
      assert.deepEqual(gotTasks.result, refTasks.result);
      assert.deepEqual(got.result.events, ref.result.events);
      assert.deepEqual(got.result.state.groups, ref.result.state.groups);
      assert.deepEqual(got.result.state.riders, ref.result.state.riders);
      assert.equal(got.result.state === got.state, ref.result.state === ref.state, "no-op-reference uaendret");
    }),
    { numRuns: 200, seed: 7380 },
  );
});

// ── 2. Under s5_profiles_v3: ordren respekteres ─────────────────────────────

test("#7380 uden etapeplan: Spar, Grupetto og Beskyt lederen angriber ikke; normal og alt ud gaar", () => {
  for (const effort of EFFORTS) {
    const riders: RiderSpec[] = [
      { id: "a", descending: STRONG_A, effort },
      { id: "b", descending: STRONG_B },
      { id: "w", descending: WEAK },
    ];
    const older = attackersFor(riders, { s5ProfilesV3: false });
    const v3 = attackersFor(riders);
    assert.deepEqual(older, ["a", "b"], `aeldre revision angriber begge (${effort})`);
    const barred = effort === "save" || effort === "grupetto" || effort === "protect";
    assert.deepEqual(v3, barred ? ["b"] : ["a", "b"], effort);
  }
});

test("#7380: er alle i vinduet spaerret, angribes der ikke, og ingen udenfor vinduet rykker ind", () => {
  const riders: RiderSpec[] = [
    { id: "a", descending: STRONG_A, effort: "save" },
    { id: "b", descending: STRONG_B, effort: "grupetto" },
    { id: "m", descending: 60 },
    { id: "w", descending: WEAK },
  ];
  assert.ok(!attackersFor(riders, { s5ProfilesV3: false }).includes("m"), "m er uden for vinduet ogsaa uden #7380");
  const { state, ctx } = scenario(riders);
  const result = descentHook(state, ctx);
  assert.deepEqual(attackerIds(result.events), []);
  assert.equal(result.state.groups.length, 1, "ingen split");
});

test("#7380 etapeplan gennem descentHook: runtimens laee-opgave spaerrer, ogsaa paa normal indsats", () => {
  // Hjaelperen paa "hold lederen fremme" koerer normal indsats; uden opgaven ville han angribe.
  const riders: RiderSpec[] = [
    { id: "h", descending: STRONG_A, effort: "normal", role: "helper" },
    { id: "f", descending: STRONG_B, effort: "normal", role: "free_role" },
    { id: "w", descending: WEAK, role: "captain" },
  ];
  assert.deepEqual(attackersFor(riders, { stagePlanTasks: { h: "shelter_leader" } }), ["f"]);
  assert.deepEqual(attackersFor(riders), ["f", "h"], "uden plan: normal maa");
  // Hooket genberegner aldrig planen: en plan-ordre uden runtimens opgave aendrer intet her.
  const orders = [planOrder("team-a", [{ rider_id: "h", legs: [{ task: "shelter_leader" }] }])];
  assert.deepEqual(attackersFor(riders, { orders }), ["f", "h"]);
});

// ── descentAttackBarredByTask7380: opgaven afgoer det ───────────────────────

test("#7380: hver opgave for sig: laee/hjaelper/grupetto/koer i maal spaerrer, resten maa (uanset indsats)", () => {
  const allowed = new Set<StagePlanTask>(["breakaway", "follow_moves", "attack", "ride_for_result"]);
  for (const task of STAGE_PLAN_TASKS) {
    assert.equal(descentAttackBarredByTask7380({ effort: TASK_EFFORT[task], task }), !allowed.has(task), task);
  }
  // Beskyt lederen-indsatsen skelnes paa opgaven, ikke paa indsatsen.
  assert.equal(descentAttackBarredByTask7380({ effort: "protect", task: "tempo" }), true);
  assert.equal(descentAttackBarredByTask7380({ effort: "protect", task: "follow_moves" }), false);
});

test("#7380: uden plan afgoer indsatsen: Spar, Grupetto og Beskyt lederen spaerrer; normal og alt ud maa", () => {
  for (const effort of EFFORTS) {
    const expected = effort === "save" || effort === "grupetto" || effort === "protect";
    assert.equal(descentAttackBarredByTask7380({ effort }), expected, effort);
    assert.equal(descentAttackBarredByTask7380({ effort, task: null }), expected, `${effort} (null)`);
  }
});

// ── Flere segmenter gennem den rigtige etapeplan-runtime ────────────────────

const RT_TEAM = "A";
const RT_ENTRANTS: Record<string, Entrant> = {
  cap: rtEntrant("cap", RT_TEAM, "captain", WEAK),
  u: rtEntrant("u", RT_TEAM, "hunter", STRONG_A),
  f: rtEntrant("f", "B", "free_role", STRONG_B),
  w: rtEntrant("w", "B", "helper", WEAK),
};

function rtEntrant(id: string, team: string, role: RiderRole, descending: number): Entrant {
  return { rider_id: id, abilities: abilities(descending), role, effort: "normal", condition: 1, team_id: team };
}

function rtState(groups: Array<{ ids: string[]; gap: number; origin?: "breakaway" }>): EngineState {
  const riders: Record<string, RiderState> = {};
  const raceGroups: RaceGroup[] = groups.map((g, i) => {
    for (const id of g.ids) riders[id] = riderState(id, `g-${i}`);
    return {
      id: `g-${i}`,
      kind: g.origin === "breakaway" ? "breakaway" : i === 0 ? "peloton" : "chase",
      rider_ids: g.ids,
      gap_seconds: g.gap,
      cohesion: 1,
      ...(g.origin ? { origin: g.origin } : {}),
    };
  });
  return { km: 0, groups: raceGroups, riders, virtual_gc: {} };
}

const TOGETHER = (): EngineState => rtState([{ ids: ["cap", "u", "f", "w"], gap: 0 }]);

function rtRoute(segments: Segment[], komKm: number | null): RouteV2 {
  return {
    distance_km: segments[segments.length - 1].to_km,
    profile_type: "hilly",
    finale_type: "descent",
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: komKm === null ? [] : [{ kind: "kom", km: komKm, index: 0, category: "2", name: "Col A" }],
  };
}

/** Koer runtimen frem til `upTo` (inklusive), med hver segmentstarts tilstand fra `stateAt`. */
function runRuntime(rt: StagePlanRuntime, route: RouteV2, upTo: number, stateAt: (i: number) => EngineState): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (let i = 0; i <= upTo; i++) {
    events.push(...advanceStagePlan(rt, { state: stateAt(i), segment: route.segments[i], segmentIndex: i, isLastSegment: i === route.segments.length - 1, entrants: RT_ENTRANTS }));
  }
  return events;
}

/** Nedkoerslen paa segment `index` med runtimens startliste og opgaver (som segmentLoop.ts). */
function descentAttackersFromRuntime(rt: StagePlanRuntime, route: RouteV2, index: number, state: EngineState, v3 = true): string[] {
  const ctx: SegmentHookContext = {
    ...makeHookCtx({ segment: route.segments[index], segmentIndex: index, route, entrants: stagePlanEntrants(rt, RT_ENTRANTS), tuning: RACE_V4_TUNING, seed: "descent-7380-rt" }),
    ...(v3 ? { s5ProfilesV3: true as const } : {}),
    stagePlanTasks: stagePlanCurrentTasks(rt),
  };
  return attackerIds(descentHook(state, ctx).events);
}

test("#7380 (review P1): sat-leddet er klaebende: sat, tilbage i gruppen, stadig laee-opgaven og intet angreb", () => {
  const route = rtRoute([
    { kind: "flat", from_km: 0, to_km: 30 },
    { kind: "climb", from_km: 30, to_km: 45, category: "2", avg_gradient: 6, top_elevation_m: 1200 },
    { kind: "descent", from_km: 45, to_km: 60, technicality: 3 },
    { kind: "flat", from_km: 60, to_km: 100 },
  ], 45);
  const legs = [{ task: "ride_for_result" }, { task: "shelter_leader", from: { at: "dropped" } }];
  const rt = createStagePlanRuntime([planOrder(RT_TEAM, [{ rider_id: "u", legs }])], route, RT_ENTRANTS)!;
  // Udgangen af segment 0: u ligger bag sin kaptajn (sat). Udgangen af stigningen: alle samlet igen.
  const dropped = rtState([{ ids: ["cap", "f", "w"], gap: 0 }, { ids: ["u"], gap: 30 }]);
  const events = runRuntime(rt, route, 2, (i) => (i === 1 ? dropped : TOGETHER()));
  assert.deepEqual(events.map((e) => [e.params.rider_id, e.params.task, e.params.reason]), [["u", "shelter_leader", "dropped"]]);
  assert.equal(isRiderDropped("u", TOGETHER(), RT_ENTRANTS), false, "stillingen nu siger 'ikke sat'");
  assert.equal(stagePlanCurrentTasks(rt)["u"], "shelter_leader", "runtimen bliver paa sat-leddet");
  assert.deepEqual(descentAttackersFromRuntime(rt, route, 2, TOGETHER()), ["f"]);
  assert.deepEqual(descentAttackersFromRuntime(rt, route, 2, TOGETHER(), false), ["f", "u"], "aeldre revision: som foer");
});

test("#7380 (review P2): skiftet ved segmentets midtpunkt: nedkoerslen ser samme led som runtimen", () => {
  const segments: Segment[] = [
    { kind: "flat", from_km: 0, to_km: 40 },
    { kind: "descent", from_km: 40, to_km: 60, technicality: 3 },
    { kind: "flat", from_km: 60, to_km: 100 },
  ];
  const legs = [{ task: "shelter_leader" }, { task: "ride_for_result", from: { at: "kom", kom_index: 0 } }];
  // Punktet i nedkoerslens foerste halvdel: skiftet sker ved dens start, han maa angribe.
  // Punktet i anden halvdel: skiftet sker foerst ved naeste graense, han er stadig paa laee-opgaven.
  for (const [komKm, task, attackers] of [[48, "ride_for_result", ["f", "u"]], [52, "shelter_leader", ["f"]]] as const) {
    const route = rtRoute(segments, komKm);
    const rt = createStagePlanRuntime([planOrder(RT_TEAM, [{ rider_id: "u", legs }])], route, RT_ENTRANTS)!;
    runRuntime(rt, route, 1, () => TOGETHER());
    assert.equal(stagePlanCurrentTasks(rt)["u"], task, `punkt ved km ${komKm}`);
    assert.deepEqual(descentAttackersFromRuntime(rt, route, 1, TOGETHER()), attackers, `punkt ved km ${komKm}`);
  }
});

test("#7380 (review P2): paa etapens sidste segment skifter holdarbejde ved start, andre opgaver foerst i finalen", () => {
  const route = rtRoute([
    { kind: "flat", from_km: 0, to_km: 60 },
    { kind: "descent", from_km: 60, to_km: 100, technicality: 3 },
  ], null);
  // De sidste km ligger i anden halvdel af den sidste nedkoersel.
  for (const [next, task, attackers] of [["tempo", "tempo", ["f"]], ["stay_sheltered", "ride_for_result", ["f", "u"]]] as const) {
    const legs = [{ task: "ride_for_result" }, { task: next, from: { at: "final_km" } }];
    const rt = createStagePlanRuntime([planOrder(RT_TEAM, [{ rider_id: "u", legs }])], route, RT_ENTRANTS)!;
    runRuntime(rt, route, 1, () => TOGETHER());
    assert.equal(stagePlanCurrentTasks(rt)["u"], task, next);
    assert.deepEqual(descentAttackersFromRuntime(rt, route, 1, TOGETHER()), attackers, next);
  }
});

test("#7380: hele motoren: nedkoerslens opgave og indsats er runtimens, og ingen med en spaerret ordre angriber", () => {
  const input = JSON.parse(readFileSync(path.join(here, "..", "fixtures", "bjerg-selektion", "input.json"), "utf8")) as StageInput;
  input.startlist = input.startlist.map((e, i) => ({ ...e, team_id: `T${Math.floor(i / 3)}` }));
  (input as { rules_revision?: unknown }).rules_revision = "s5_profiles_v3";
  const komIndex = input.route.waypoints.find((w) => w.kind === "kom" && w.summit_finish !== true)!.index;
  const planFor = (role: RiderRole): unknown[] => {
    if (role === "captain" || role === "co_captain" || role === "sprint_captain") return [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: komIndex } }];
    if (role === "helper") return [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }];
    if (role === "hunter") return [{ task: "breakaway" }, { task: "shelter_leader", from: { at: "dropped" } }];
    return [{ task: "ride_for_result" }, { task: "stay_sheltered", from: { at: "dropped" } }];
  };
  const byTeam = new Map<string, Array<{ rider_id: string; legs: unknown[] }>>();
  for (const e of input.startlist) {
    const team = String(e.team_id);
    byTeam.set(team, [...(byTeam.get(team) ?? []), { rider_id: e.rider_id, legs: planFor(e.role) }]);
  }
  input.orders = [...byTeam].map(([team, riders]) => planOrder(team, riders));
  const plans = new Map(input.orders.flatMap((o) => (o.params as { riders: Array<{ rider_id: string; legs: Array<{ task: StagePlanTask }> }> }).riders.map((r) => [r.rider_id, r.legs] as const)));

  type Seen = { from_km: number; tasks: Record<string, StagePlanTask>; efforts: Record<string, EffortLevel>; attackers: string[] };
  const run = () => {
    const seen: Seen[] = [];
    const hooks = {
      ...LIVE_MECHANIC_HOOKS,
      descent: (state: EngineState, ctx: SegmentHookContext) => {
        const result = descentHook(state, ctx);
        const efforts: Record<string, EffortLevel> = {};
        for (const id of Object.keys(ctx.stagePlanTasks ?? {})) efforts[id] = ctx.entrants[id].effort;
        seen.push({ from_km: ctx.segment.from_km, tasks: { ...(ctx.stagePlanTasks ?? {}) }, efforts, attackers: attackerIds(result.events) });
        return result;
      },
    };
    return { seen, events: runSegmentLoop(input, hooks).timeline };
  };

  const on = run();
  assert.ok(on.seen.length > 0, "fixturen har en nedkoersel");
  let switchedBefore = false;
  for (const s of on.seen) {
    assert.deepEqual(Object.keys(s.tasks).sort(), [...plans.keys()].sort(), "alle planer er gyldige og naar hooket");
    for (const [riderId, legs] of plans) {
      // Runtimens opgave paa segmentet = sidste skift ved eller foer dets start (finalens skift taeller ikke).
      const legEvent = on.events.filter((e) => e.type === STAGE_PLAN_LEG_EVENT && e.params.rider_id === riderId && e.km <= s.from_km && e.params.at_finish !== true).at(-1);
      const expected = (legEvent?.params.task as StagePlanTask | undefined) ?? legs[0].task;
      if (expected !== legs[0].task) switchedBefore = true;
      assert.equal(s.tasks[riderId], expected, `${riderId}: nedkoerslens opgave == runtimens`);
      assert.equal(s.efforts[riderId], TASK_EFFORT[expected], `${riderId}: indsatsen foelger opgaven`);
    }
    for (const id of s.attackers) assert.ok(!DESCENT_ATTACK_BARRED_TASKS_7380.has(s.tasks[id]), `${id} angreb paa ${s.tasks[id]}`);
  }
  assert.ok(switchedBefore, "mindst ét skift foer nedkoerslen (ellers tester testen intet)");
});

// ── 3. Kun fjerne, aldrig tilfoeje + monotoni blandt de frie ────────────────

test("#7380 (property): angriberne er en delmaengde af den aeldre revisions, og monotonien holder blandt de frie", () => {
  const specArb = fc.array(
    fc.record({ descending: fc.integer({ min: 0, max: 99 }), effort: fc.constantFrom(...EFFORTS) }),
    { minLength: 2, maxLength: 9 },
  );
  fc.assert(
    fc.property(specArb, fc.constantFrom<2 | 3>(2, 3), (specs, technicality) => {
      const riders = specs.map((s, i) => ({ id: `r${i}`, ...s }));
      const off = attackersFor(riders, { technicality, s5ProfilesV3: false });
      const on = attackersFor(riders, { technicality });
      const offSet = new Set(off);
      for (const id of on) assert.ok(offSet.has(id), `${id} angriber kun under #7380`);
      const free = riders.filter((r) => !(r.effort === "save" || r.effort === "grupetto" || r.effort === "protect"));
      for (const id of on) assert.ok(free.some((r) => r.id === id), `${id} har en spaerret ordre`);
      // Praefiks: en fri rytter der er bedre end en fri angriber, angriber ogsaa.
      const onSet = new Set(on);
      for (const attacker of free.filter((r) => onSet.has(r.id))) {
        for (const better of free.filter((r) => r.descending > attacker.descending)) {
          assert.ok(onSet.has(better.id), `${better.id} (bedre) blev tilbage mens ${attacker.id} angreb`);
        }
      }
      // Ordren fjerner kun de spaerrede: de frie angribere er praecis de frie fra den aeldre revision.
      assert.deepEqual(on, off.filter((id) => free.some((r) => r.id === id)));
    }),
    { numRuns: 200, seed: 73801 },
  );
});
