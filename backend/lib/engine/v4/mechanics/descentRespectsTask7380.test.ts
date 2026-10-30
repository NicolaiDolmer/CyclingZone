// backend/lib/engine/v4/mechanics/descentRespectsTask7380.test.ts
// #7380 (SLUKKET, ejer-beslutning 30/10): nedkoerselsangrebet respekterer
// rytterens ordre. Kontrakten:
//   1. Kontakten er slukket, og slukket (eller taendt uden s5_profiles_v3) er
//      nedkoerslen bit-identisk med main: ordrer og indsats aendrer intet.
//   2. Taendt angriber ingen paa Spar, Grupetto, Beskyt lederen eller en
//      laee-/hjaelperopgave; fri rolle, leder, angreb, foelg angreb, udbrud og
//      normal/alt ud maa stadig.
//   3. Kontakten kan kun FJERNE angreb, aldrig skabe et nyt, og monotonien
//      (praefiks-egenskaben) holder blandt de ryttere hvis ordre tillader angreb.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  DESCENT_TASK_7380_ACTIVE,
  descentAttackBarredByTask7380,
  descentHook,
  descentTask7380Active,
  isDescentTask7380On,
  setDescentTask7380ForBench,
} from "./descent.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
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
  SegmentHookContext,
  TeamOrder,
  TimelineEvent,
} from "../types.ts";

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
  opts: { technicality?: 1 | 2 | 3; orders?: TeamOrder[]; s5ProfilesV3?: boolean; groupOrigin?: "breakaway"; seed?: string } = {},
): { state: EngineState; ctx: SegmentHookContext } {
  const entrants: Record<string, Entrant> = {};
  const states: Record<string, RiderState> = {};
  for (const r of riders) {
    entrants[r.id] = {
      rider_id: r.id,
      abilities: abilities(r.descending),
      role: r.role ?? "free_role",
      effort: r.effort ?? "normal",
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
  const ctx: SegmentHookContext = opts.s5ProfilesV3 === false ? base : { ...base, s5ProfilesV3: true };
  return { state: { km: 40, groups: [group], riders: states, virtual_gc: {} }, ctx };
}

function attackerIds(events: readonly TimelineEvent[]): string[] {
  return events
    .filter((e) => e.type === "finale_attack")
    .flatMap((e) => (e.params as { rider_ids: string[] }).rider_ids)
    .sort();
}

function withSwitch<T>(active: boolean | null, fn: () => T): T {
  setDescentTask7380ForBench(active);
  try {
    return fn();
  } finally {
    setDescentTask7380ForBench(null);
  }
}

function planOrder(team: string, riders: Array<{ rider_id: string; legs: unknown[] }>): TeamOrder {
  return { team_id: team, kind: "stage_plan", params: { riders } };
}

// To staerke nedkoerere (samme vindue) og en svag: uden ordrer angriber de to staerke.
const STRONG_A = 90;
const STRONG_B = 88;
const WEAK = 20;

// ── 1. Kontakten er slukket, og slukket er bit-identisk ─────────────────────

test("#7380: kontakten er SLUKKET (taend kraever ejerens ordrette go i en egen PR)", () => {
  assert.equal(DESCENT_TASK_7380_ACTIVE, false);
  assert.equal(descentTask7380Active(), false);
  assert.equal(isDescentTask7380On({ s5ProfilesV3: true }), false);
  withSwitch(true, () => {
    assert.equal(isDescentTask7380On({ s5ProfilesV3: true }), true);
    assert.equal(isDescentTask7380On({}), false, "kun s5_profiles_v3 og senere");
  });
});

test("#7380: slukket (og taendt uden s5_profiles_v3) er nedkoerslen bit-identisk: ordrer og indsats aendrer intet", () => {
  const specArb = fc.array(
    fc.record({
      descending: fc.integer({ min: 0, max: 99 }),
      effort: fc.constantFrom(...EFFORTS),
      role: fc.constantFrom(...ROLES),
    }),
    { minLength: 2, maxLength: 9 },
  );
  fc.assert(
    fc.property(specArb, fc.constantFrom<1 | 2 | 3>(1, 2, 3), fc.boolean(), (specs, technicality, onWithoutV3) => {
      const riders = specs.map((s, i) => ({ id: `r${i}`, ...s }));
      // Referencen: samme ryttere og roller uden ordre-signal (alle normal, ingen plan).
      const neutral = riders.map((r) => ({ id: r.id, descending: r.descending, role: r.role }));
      const orders = [planOrder("team-a", riders.map((r) => ({ rider_id: r.id, legs: [{ task: "stay_sheltered" }] })))];
      const run = (rs: RiderSpec[], o: TeamOrder[]) => {
        const { state, ctx } = scenario(rs, { technicality, orders: o, s5ProfilesV3: !onWithoutV3 });
        const result = descentHook(state, ctx);
        return { result, state };
      };
      const ref = withSwitch(null, () => run(neutral, []));
      const got = withSwitch(onWithoutV3 ? true : null, () => run(riders, orders));
      assert.deepEqual(got.result.events, ref.result.events);
      assert.deepEqual(got.result.state.groups, ref.result.state.groups);
      assert.deepEqual(got.result.state.riders, ref.result.state.riders);
      assert.equal(got.result.state === got.state, ref.result.state === ref.state, "no-op-reference uaendret");
    }),
    { numRuns: 200, seed: 7380 },
  );
});

// ── 2. Taendt: ordren respekteres ───────────────────────────────────────────

test("#7380 taendt, uden etapeplan: Spar, Grupetto og Beskyt lederen angriber ikke; normal og alt ud gaar", () => {
  for (const effort of EFFORTS) {
    const riders: RiderSpec[] = [
      { id: "a", descending: STRONG_A, effort },
      { id: "b", descending: STRONG_B },
      { id: "w", descending: WEAK },
    ];
    const off = withSwitch(null, () => { const s = scenario(riders); return attackerIds(descentHook(s.state, s.ctx).events); });
    const on = withSwitch(true, () => { const s = scenario(riders); return attackerIds(descentHook(s.state, s.ctx).events); });
    assert.deepEqual(off, ["a", "b"], `slukket angriber begge (${effort})`);
    const barred = effort === "save" || effort === "grupetto" || effort === "protect";
    assert.deepEqual(on, barred ? ["b"] : ["a", "b"], effort);
  }
});

test("#7380 taendt: er alle i vinduet spaerret, angribes der ikke, og ingen udenfor vinduet rykker ind", () => {
  const riders: RiderSpec[] = [
    { id: "a", descending: STRONG_A, effort: "save" },
    { id: "b", descending: STRONG_B, effort: "grupetto" },
    { id: "m", descending: 60 },
    { id: "w", descending: WEAK },
  ];
  const off = withSwitch(null, () => { const s = scenario(riders); return attackerIds(descentHook(s.state, s.ctx).events); });
  assert.ok(!off.includes("m"), "m er uden for vinduet ogsaa slukket");
  withSwitch(true, () => {
    const { state, ctx } = scenario(riders);
    const result = descentHook(state, ctx);
    assert.deepEqual(attackerIds(result.events), []);
    assert.equal(result.state.groups.length, 1, "ingen split");
  });
});

test("#7380 taendt, etapeplan gennem descentHook: laee-opgaven spaerrer, ogsaa paa normal indsats", () => {
  // Hjaelperen paa "hold lederen fremme" koerer normal indsats; uden planen ville han angribe.
  const riders: RiderSpec[] = [
    { id: "h", descending: STRONG_A, effort: "normal", role: "helper" },
    { id: "f", descending: STRONG_B, effort: "normal", role: "free_role" },
    { id: "w", descending: WEAK, role: "captain" },
  ];
  const orders = [planOrder("team-a", [{ rider_id: "h", legs: [{ task: "shelter_leader" }] }])];
  withSwitch(true, () => {
    const withPlan = scenario(riders, { orders });
    assert.deepEqual(attackerIds(descentHook(withPlan.state, withPlan.ctx).events), ["f"]);
    const noPlan = scenario(riders);
    assert.deepEqual(attackerIds(descentHook(noPlan.state, noPlan.ctx).events), ["f", "h"], "uden plan: normal maa");
  });
  // En plan for et ANDET holds rytter ignoreres (samme regel som motoren).
  const foreign = [planOrder("team-b", [{ rider_id: "h", legs: [{ task: "shelter_leader" }] }])];
  withSwitch(true, () => {
    const s = scenario(riders, { orders: foreign });
    assert.deepEqual(attackerIds(descentHook(s.state, s.ctx).events), ["f", "h"]);
  });
});

// ── descentAttackBarredByTask7380: opgaven afgoer det ───────────────────────

type Leg = NonNullable<Parameters<typeof descentAttackBarredByTask7380>[0]["legs"]>[number];
const TASK_EFFORT_7380: Record<Leg["task"], EffortLevel> = {
  breakaway: "normal", stay_sheltered: "save", shelter_leader: "normal", tempo: "protect", follow_moves: "protect",
  attack: "all_out", ride_for_result: "normal", sprint_train: "normal", grupetto: "grupetto", ride_in: "save",
};
function leg(task: Leg["task"], from: { km?: number; dropped?: true } = {}): Leg {
  return { task, effort: TASK_EFFORT_7380[task], fromKm: from.km ?? null, fromDropped: from.dropped === true, routeReason: from.km !== undefined ? "kom" : null };
}
const SEG = { from_km: 40, to_km: 48 };
function barred(legs: Leg[] | null, effort: EffortLevel, inEscape = false, segment = SEG): boolean {
  return descentAttackBarredByTask7380({ effort, legs, segment, segmentIndex: 3, inEscape });
}

test("#7380: hver opgave for sig (et-leds plan): laee/hjaelper/grupetto/koer i maal spaerrer, resten maa", () => {
  const allowed = new Set(["breakaway", "follow_moves", "attack", "ride_for_result"]);
  for (const task of Object.keys(TASK_EFFORT_7380) as Leg["task"][]) {
    assert.equal(barred([leg(task)], TASK_EFFORT_7380[task]), !allowed.has(task), task);
  }
});

test("#7380: Beskyt lederen-indsatsen skelnes paa opgaven (tempo spaerrer, foelg angreb maa)", () => {
  assert.equal(barred([leg("shelter_leader"), leg("tempo", { km: 30 })], "protect"), true);
  assert.equal(barred([leg("stay_sheltered"), leg("follow_moves", { km: 30 })], "protect"), false);
  assert.equal(barred(null, "protect"), true, "uden plan er Beskyt lederen spaerret");
});

test("#7380: kaptajnens standardplan: i laeet foer stigningen spaerret, angreb efter toppen maa", () => {
  const legs = [leg("stay_sheltered"), leg("attack", { km: 30 })];
  assert.equal(barred(legs, "save"), true);
  assert.equal(barred(legs, "all_out"), false);
});

test("#7380: samme indsats i flere led: kaeden indsnaevres ud fra rutepunkterne", () => {
  // ride_for_result (normal) foerst, shelter_leader (normal) fra km 60: paa km 40-48 er han endnu ikke skiftet.
  const hunter = [leg("ride_for_result"), leg("shelter_leader", { km: 60 })];
  assert.equal(barred(hunter, "normal"), false, "rutepunktet ligger efter segmentet");
  assert.equal(barred(hunter, "normal", false, { from_km: 62, to_km: 70 }), true, "efter rutepunktet er han skiftet");
  // shelter_leader foerst, ride_for_result fra km 30 (passeret): det aktuelle led er ride_for_result.
  assert.equal(barred([leg("shelter_leader"), leg("ride_for_result", { km: 30 })], "normal"), false);
});

test("#7380: udbrudsopgaven: i udbruddet maa han; uden for udbruddet gaelder sat-leddet", () => {
  const legs = [leg("breakaway"), leg("shelter_leader", { dropped: true })];
  assert.equal(barred(legs, "normal", true), false, "i udbruddet");
  assert.equal(barred(legs, "normal", false), true, "hentet/kom ikke med");
  const hunterDefault = [leg("breakaway"), leg("ride_for_result", { dropped: true })];
  assert.equal(barred(hunterDefault, "normal", false), false, "begge led maa angribe");
});

test("#7380: tvivl mellem en spaerret og en fri opgave spaerrer (ordren vejer tungest)", () => {
  // Hverken rutepunkt eller udbrud kan afgoere det: begge led er mulige paa segmentet.
  const legs = [leg("ride_for_result"), leg("shelter_leader", { km: 44 })];
  assert.equal(barred(legs, "normal"), true);
});

test("#7380 taendt: i dagens udbrud maa en rytter paa udbrudsopgaven stadig angribe sine udbrudsfaeller", () => {
  const riders: RiderSpec[] = [
    { id: "u", descending: STRONG_A, effort: "normal", role: "hunter" },
    { id: "v", descending: WEAK, role: "free_role", team: "team-b" },
  ];
  const orders = [planOrder("team-a", [{ rider_id: "u", legs: [{ task: "breakaway" }, { task: "shelter_leader", from: { at: "dropped" } }] }])];
  withSwitch(true, () => {
    const inBreak = scenario(riders, { orders, groupOrigin: "breakaway" });
    assert.deepEqual(attackerIds(descentHook(inBreak.state, inBreak.ctx).events), ["u"]);
    const inField = scenario(riders, { orders });
    assert.deepEqual(attackerIds(descentHook(inField.state, inField.ctx).events), [], "uden for udbruddet: sat-leddet (laee)");
  });
});

// ── 3. Kun fjerne, aldrig tilfoeje + monotoni blandt de frie ────────────────

test("#7380 taendt (property): angriberne er en delmaengde af slukket, og monotonien holder blandt de frie", () => {
  const specArb = fc.array(
    fc.record({ descending: fc.integer({ min: 0, max: 99 }), effort: fc.constantFrom(...EFFORTS) }),
    { minLength: 2, maxLength: 9 },
  );
  fc.assert(
    fc.property(specArb, fc.constantFrom<2 | 3>(2, 3), (specs, technicality) => {
      const riders = specs.map((s, i) => ({ id: `r${i}`, ...s }));
      const off = withSwitch(null, () => { const s = scenario(riders, { technicality }); return attackerIds(descentHook(s.state, s.ctx).events); });
      const on = withSwitch(true, () => { const s = scenario(riders, { technicality }); return attackerIds(descentHook(s.state, s.ctx).events); });
      const offSet = new Set(off);
      for (const id of on) assert.ok(offSet.has(id), `${id} angriber kun taendt`);
      const free = riders.filter((r) => !(r.effort === "save" || r.effort === "grupetto" || r.effort === "protect"));
      for (const id of on) assert.ok(free.some((r) => r.id === id), `${id} har en spaerret ordre`);
      // Praefiks: en fri rytter der er bedre end en fri angriber, angriber ogsaa.
      const onSet = new Set(on);
      for (const attacker of free.filter((r) => onSet.has(r.id))) {
        for (const better of free.filter((r) => r.descending > attacker.descending)) {
          assert.ok(onSet.has(better.id), `${better.id} (bedre) blev tilbage mens ${attacker.id} angreb`);
        }
      }
      // Kontakten fjerner kun de spaerrede: de frie angribere er praecis de frie fra slukket.
      assert.deepEqual(on, off.filter((id) => free.some((r) => r.id === id)));
    }),
    { numRuns: 200, seed: 73801 },
  );
});
