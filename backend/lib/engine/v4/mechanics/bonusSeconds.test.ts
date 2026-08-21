// backend/lib/engine/v4/mechanics/bonusSeconds.test.ts
// Kontrakt-tests + property-test (fast-check, 200 runs, seeded) for M9
// (bonussekunder). SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-
// intra-stage-design.md §4 M9 + #2413 (maal-bonus KUN masse-etaper, GC-effekt
// bounded ~10s/etape).
//
// Testene laaser HENSIGT (retning + bounded stoerrelse): maal-bonus falder
// ALTID inden for tuning.finishSeconds-baandet og er ALTID tom for ITT;
// indlagt-spurt-bonus falder ALTID inden for tuning.intermediateSeconds; det
// samlede per-rytter-loft haandhaeves ALTID uanset input.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyAwardsToVirtualGc,
  awardsToTimelineEvents,
  clampAwardsToPerRiderCap,
  computeFinishBonusAwards,
  computeIntermediateSprintAwards,
  computeIntermediateSprintOrder,
  intermediateSprintHook,
  isMassFinishFinaleType,
  type BonusAward,
} from "./bonusSeconds.ts";
import { boundRngFor } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
  Waypoint,
} from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = overrides[key] ?? 50;
  return out;
}

function makeEntrant(riderId: string, ab: Record<AbilityKey, number>): Entrant {
  return { rider_id: riderId, abilities: ab, role: "free_role", effort: "normal", condition: 1 };
}

function makeRiderState(riderId: string, groupId: string): RiderState {
  return {
    rider_id: riderId,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 1,
    wprime: 1,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  };
}

// ── isMassFinishFinaleType / computeFinishBonusAwards ───────────────────────

test("isMassFinishFinaleType: solo_tt (ITT) er ALDRIG masse-etape, null/kendte masse-typer er", () => {
  assert.equal(isMassFinishFinaleType("solo_tt" as FinaleType), false);
  assert.equal(isMassFinishFinaleType(null), true);
  assert.equal(isMassFinishFinaleType("bunch_sprint" as FinaleType), true);
  assert.equal(isMassFinishFinaleType("punch" as FinaleType), true);
});

test("computeFinishBonusAwards: top 3 faer PRAECIS tuning.finishSeconds, resten intet", () => {
  const order = ["r1", "r2", "r3", "r4", "r5"];
  const awards = computeFinishBonusAwards(order, "bunch_sprint" as FinaleType, 150, RACE_V4_TUNING.bonusSeconds);
  assert.deepEqual(
    awards.map((a) => [a.rider_id, a.seconds, a.reason]),
    [["r1", 10, "finish"], ["r2", 6, "finish"], ["r3", 4, "finish"]],
  );
  assert.ok(awards.every((a) => a.km === 150));
});

test("computeFinishBonusAwards: tom liste for ITT (solo_tt) uanset rangering", () => {
  const order = ["r1", "r2", "r3"];
  const awards = computeFinishBonusAwards(order, "solo_tt" as FinaleType, 40, RACE_V4_TUNING.bonusSeconds);
  assert.deepEqual(awards, []);
});

test("computeFinishBonusAwards: faerre end 3 ryttere -> kun de tilgaengelige faar bonus, ingen krasch", () => {
  const awards = computeFinishBonusAwards(["only"], "punch" as FinaleType, 100, RACE_V4_TUNING.bonusSeconds);
  assert.deepEqual(awards.map((a) => a.rider_id), ["only"]);
  assert.equal(awards[0].seconds, 10);
});

test("computeFinishBonusAwards: ALTID inden for [0, finishSeconds[0]]-baandet, fast-check (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 0, maxLength: 10 }),
      fc.constantFrom<FinaleType>("bunch_sprint", "reduced_sprint", "punch", "breakaway", "descent", "long_climb", "solo_tt"),
      (order, finaleType) => {
        const awards = computeFinishBonusAwards(order, finaleType, 0, RACE_V4_TUNING.bonusSeconds);
        for (const a of awards) {
          assert.ok(a.seconds >= 0 && a.seconds <= RACE_V4_TUNING.bonusSeconds.finishSeconds[0]);
        }
        if (finaleType === "solo_tt") assert.equal(awards.length, 0);
        assert.ok(awards.length <= 3);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── computeIntermediateSprintOrder / computeIntermediateSprintAwards ───────

test("computeIntermediateSprintOrder: hoejere spurt-relevante evner ranger foerst naar stoej=0 (retning)", () => {
  const entrants: Record<string, Entrant> = {
    strong: makeEntrant("strong", abilities({ sprint: 90, acceleration: 90, positioning: 90 })),
    weak: makeEntrant("weak", abilities({ sprint: 10, acceleration: 10, positioning: 10 })),
  };
  const order = computeIntermediateSprintOrder(
    ["weak", "strong"],
    entrants,
    boundRngFor("seed-a"),
    BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
    0,
  );
  assert.deepEqual(order, ["strong", "weak"]);
});

test("computeIntermediateSprintAwards: ALTID PRAECIS tuning.intermediateSeconds til top 3", () => {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities({ sprint: 80 })),
    b: makeEntrant("b", abilities({ sprint: 60 })),
    c: makeEntrant("c", abilities({ sprint: 40 })),
    d: makeEntrant("d", abilities({ sprint: 20 })),
  };
  const awards = computeIntermediateSprintAwards(
    ["a", "b", "c", "d"],
    entrants,
    boundRngFor("seed-b"),
    75,
    RACE_V4_TUNING.bonusSeconds,
    BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
    0,
  );
  assert.deepEqual(
    awards.map((a) => a.seconds),
    [...RACE_V4_TUNING.bonusSeconds.intermediateSeconds],
  );
  assert.ok(awards.every((a) => a.reason === "intermediate_sprint" && a.km === 75));
});

// ── clampAwardsToPerRiderCap (#2413: bounded ~10s/etape) ────────────────────

test("clampAwardsToPerRiderCap: totalen under loftet er uaendret", () => {
  const awards: BonusAward[] = [{ rider_id: "r1", seconds: 4, reason: "intermediate_sprint", km: 10 }];
  const clamped = clampAwardsToPerRiderCap(awards, 10);
  assert.deepEqual(clamped, awards);
});

test("clampAwardsToPerRiderCap: sum over loftet klemmes PROPORTIONALT (begge kilder reduceres), aldrig over loftet", () => {
  const awards: BonusAward[] = [
    { rider_id: "r1", seconds: 10, reason: "finish", km: 150 },
    { rider_id: "r1", seconds: 3, reason: "intermediate_sprint", km: 75 },
  ];
  const clamped = clampAwardsToPerRiderCap(awards, 10);
  const total = clamped.reduce((s, a) => s + a.seconds, 0);
  assert.ok(total <= 10 + 1e-6, `sum efter klem maa ALDRIG overstige loftet (fik ${total})`);
  assert.ok(total > 9.9, `klemningen skal udnytte loftet noenlunde fuldt ud, ikke over-reducere (fik ${total})`);
  // Proportionalt: BEGGE kilder reduceres (i modsaetning til at nulstille den ene vilkaarligt).
  const finishAward = clamped.find((a) => a.reason === "finish")!;
  const interAward = clamped.find((a) => a.reason === "intermediate_sprint")!;
  assert.ok(finishAward.seconds < 10 && finishAward.seconds > 0, "finish-bonussen skal reduceres, ikke nulstilles");
  assert.ok(interAward.seconds < 3 && interAward.seconds > 0, "spurt-bonussen skal reduceres, ikke nulstilles");
  assert.ok(Math.abs(finishAward.seconds / 10 - interAward.seconds / 3) < 0.01, "begge kilder skal skaleres med omtrent samme faktor (proportionalt, ikke vilkaarligt)");
});

test("clampAwardsToPerRiderCap: ALDRIG over loftet for nogen rytter, fast-check (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          rider_id: fc.constantFrom("r1", "r2", "r3"),
          seconds: fc.integer({ min: 0, max: 15 }),
        }),
        { minLength: 0, maxLength: 8 },
      ),
      (raw) => {
        const awards: BonusAward[] = raw.map((r, i) => ({ ...r, reason: "finish", km: i }));
        const cap = 10;
        const clamped = clampAwardsToPerRiderCap(awards, cap);
        const totals = new Map<string, number>();
        for (const a of clamped) totals.set(a.rider_id, (totals.get(a.rider_id) ?? 0) + a.seconds);
        for (const total of totals.values()) assert.ok(total <= cap + 1e-6, `total ${total} overstiger loftet ${cap}`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── awardsToTimelineEvents / applyAwardsToVirtualGc ─────────────────────────

test("awardsToTimelineEvents: aaben event-type 'bonus_seconds_awarded', fog-gate-venlige params", () => {
  const awards: BonusAward[] = [{ rider_id: "r1", seconds: 10, reason: "finish", km: 150 }];
  const events = awardsToTimelineEvents(awards);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "bonus_seconds_awarded");
  assert.deepEqual(events[0].params, { rider_id: "r1", seconds: 10, reason: "finish" });
});

test("applyAwardsToVirtualGc: traekker sekunder fra deficittet, andre ryttere uaendrede", () => {
  const virtualGc = { r1: 20, r2: 5 };
  const next = applyAwardsToVirtualGc(virtualGc, [{ rider_id: "r1", seconds: 10, reason: "finish", km: 150 }]);
  assert.equal(next.r1, 10);
  assert.equal(next.r2, 5);
  assert.notStrictEqual(next, virtualGc, "input skal ikke muteres");
});

// ── intermediateSprintHook (segment-hook-kontrakt) ──────────────────────────

const ROUTE_STUB_NO_SPRINT: RouteV2 = {
  distance_km: 150,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [],
};

function sprintWaypoint(km: number): Waypoint {
  return { kind: "sprint", index: 0, name: "Test Sprint", km };
}

function buildScenario(args: {
  groups: RaceGroup[];
  entrants: Record<string, Entrant>;
  riderStates: Record<string, RiderState>;
  waypoints: Waypoint[];
  segment: Segment;
  seed?: string;
}): { state: EngineState; ctx: SegmentHookContext } {
  const state: EngineState = { km: args.segment.from_km, groups: args.groups, riders: args.riderStates, virtual_gc: {} };
  const ctx: SegmentHookContext = {
    segment: args.segment,
    segmentIndex: 0,
    route: { ...ROUTE_STUB_NO_SPRINT, waypoints: args.waypoints },
    entrants: args.entrants,
    tuning: RACE_V4_TUNING,
    rngFor: boundRngFor(args.seed ?? "bonus-seed"),
  };
  return { state, ctx };
}

test("intermediateSprintHook: segment uden sprint-waypoint -> ingen events, state uaendret (samme reference)", () => {
  const entrants: Record<string, Entrant> = { a: makeEntrant("a", abilities()) };
  const riderStates: Record<string, RiderState> = { a: makeRiderState("a", "peloton-0") };
  const group: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 };
  const { state, ctx } = buildScenario({
    groups: [group],
    entrants,
    riderStates,
    waypoints: [],
    segment: { kind: "flat", from_km: 0, to_km: 10 },
  });
  const result = intermediateSprintHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state);
});

test("intermediateSprintHook: sprint-waypoint i segmentet -> top 3 af FRONTGRUPPEN faar bonus, bagvedliggende gruppe ignoreres", () => {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities({ sprint: 90, acceleration: 90, positioning: 90 })),
    b: makeEntrant("b", abilities({ sprint: 70, acceleration: 70, positioning: 70 })),
    c: makeEntrant("c", abilities({ sprint: 50, acceleration: 50, positioning: 50 })),
    back: makeEntrant("back", abilities({ sprint: 99, acceleration: 99, positioning: 99 })), // staerkest, men bagved
  };
  const riderStates: Record<string, RiderState> = {
    a: makeRiderState("a", "peloton-0"),
    b: makeRiderState("b", "peloton-0"),
    c: makeRiderState("c", "peloton-0"),
    back: makeRiderState("back", "chase-1"),
  };
  const frontGroup: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b", "c"], gap_seconds: 0, cohesion: 1 };
  const backGroup: RaceGroup = { id: "chase-1", kind: "chase", rider_ids: ["back"], gap_seconds: 30, cohesion: 1 };
  const { state, ctx } = buildScenario({
    groups: [frontGroup, backGroup],
    entrants,
    riderStates,
    waypoints: [sprintWaypoint(5)],
    segment: { kind: "flat", from_km: 0, to_km: 10 },
  });
  const result = intermediateSprintHook(state, ctx);
  assert.strictEqual(result.state, state, "hook aendrer aldrig gruppe/tid — kun bonus-events");
  const riderIds = result.events.map((e) => e.params.rider_id);
  assert.equal(riderIds.length, 3);
  assert.ok(!riderIds.includes("back"), "en staerkere rytter i en BAGVEDLIGGENDE gruppe maa ikke kunne tage den indlagte spurt");
  assert.deepEqual(new Set(riderIds), new Set(["a", "b", "c"]));
});

test("intermediateSprintHook: determinisme — samme seed+input giver byte-identisk resultat", () => {
  const entrants: Record<string, Entrant> = { a: makeEntrant("a", abilities()), b: makeEntrant("b", abilities()) };
  const riderStates: Record<string, RiderState> = { a: makeRiderState("a", "peloton-0"), b: makeRiderState("b", "peloton-0") };
  const group: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 };
  const scenarioA = buildScenario({
    groups: [group], entrants, riderStates, waypoints: [sprintWaypoint(5)],
    segment: { kind: "flat", from_km: 0, to_km: 10 }, seed: "det-seed",
  });
  const scenarioB = buildScenario({
    groups: [group], entrants, riderStates, waypoints: [sprintWaypoint(5)],
    segment: { kind: "flat", from_km: 0, to_km: 10 }, seed: "det-seed",
  });
  assert.deepEqual(intermediateSprintHook(scenarioA.state, scenarioA.ctx), intermediateSprintHook(scenarioB.state, scenarioB.ctx));
});
