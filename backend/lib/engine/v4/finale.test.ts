// backend/lib/engine/v4/finale.test.ts
// Race Engine v4 F2 (#4030): M4 kontrakt-tests + property-test for finale.ts.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4,
// mor-spec 2026-08-20-race-engine-v4-intra-stage-design.md §3.2/§4 M4.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  bunchCatchWindowSeconds,
  computeFinaleAbilityScore,
  finaleHook,
  isBunchCatchRoute,
} from "./finale.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { boundRngFor } from "./rng.ts";
import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { FINALE_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
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
  SegmentKind,
  StageInput,
} from "./types.ts";

// ── Faelles fixtures (samme moenster som groups.test.ts) ──────────────────────

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

function makeRiderState(riderId: string, groupId: string, args: Partial<RiderState> = {}): RiderState {
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
    ...args,
  };
}

const FINALE_SEGMENT: Segment = { kind: "flat", from_km: 149, to_km: 150 };

function makeCtx(args: {
  entrants: Record<string, Entrant>;
  finaleType?: FinaleType | null;
  profileType?: RouteV2["profile_type"];
  segment?: Segment;
  seed?: string;
}): SegmentHookContext {
  const segment = args.segment ?? FINALE_SEGMENT;
  const route: RouteV2 = {
    distance_km: 150,
    profile_type: args.profileType ?? "hilly",
    finale_type: args.finaleType ?? null,
    segments: [segment],
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [],
  };
  // #4949: ctx spejler segmentLoop.ts's noegling (segment-noeglet rngFor).
  return makeHookCtx({
    segment,
    segmentIndex: 0,
    route,
    entrants: args.entrants,
    tuning: RACE_V4_TUNING,
    seed: args.seed ?? "finale-test-seed",
  });
}

function buildState(groups: RaceGroup[], riders: Record<string, RiderState>): EngineState {
  return { km: 149, groups, riders, virtual_gc: Object.fromEntries(Object.keys(riders).map((id) => [id, 0])) };
}

// ── Kontrakt-test 1: forspring + reserve ⇒ sejr, medmindre indhentet ──────────

test("finaleHook: solo-forspring med W'-reserve overlever svag/traet jagtgruppe og vinder", () => {
  const soloAbilities = abilities({ tempo: 99, endurance: 99, durability: 99 });
  const chaseAbilities = abilities({ tempo: 1, endurance: 1, aggression: 1 });

  const entrants: Record<string, Entrant> = { solo1: makeEntrant("solo1", soloAbilities) };
  const chaseIds = ["c1", "c2", "c3"];
  for (const id of chaseIds) entrants[id] = makeEntrant(id, chaseAbilities);

  const riders: Record<string, RiderState> = {
    solo1: makeRiderState("solo1", "solo-lead", { wprime: 1, wprimeMax: 1 }), // fuld reserve
    ...Object.fromEntries(chaseIds.map((id) => [id, makeRiderState(id, "peloton-0", { wprime: 0.1, wprimeMax: 1 })])),
  };

  const groups: RaceGroup[] = [
    { id: "solo-lead", kind: "solo", rider_ids: ["solo1"], gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: chaseIds, gap_seconds: 30, cohesion: 1 },
  ];

  const state = buildState(groups, riders);
  const ctx = makeCtx({ entrants, finaleType: "punch", segment: { kind: "flat", from_km: 149, to_km: 150 } });

  const result = finaleHook(state, ctx);

  const winnerGroup = result.state.groups.find((g) => g.rider_ids.includes("solo1"))!;
  assert.equal(winnerGroup.gap_seconds, 0, "forspringsrytteren skal stadig staa forrest (gap 0)");
  assert.equal(winnerGroup.rider_ids.length, 1, "chasegruppen maa IKKE vaere smeltet ind i vinderens gruppe");

  const chaseGroup = result.state.groups.find((g) => chaseIds.every((id) => g.rider_ids.includes(id)));
  assert.ok(chaseGroup, "chasegruppen skal stadig eksistere som selvstaendig gruppe (ikke indhentet)");
  assert.ok(chaseGroup!.gap_seconds >= RACE_V4_TUNING.groups.mergeThresholdSeconds, "chasegruppens gap skal vaere over merge-taerskel (reelt tabt tid)");

  const sprintDecided = result.events.find((e) => e.type === "sprint_decided");
  assert.ok(sprintDecided, "sprint_decided skal emitteres");
  assert.equal(sprintDecided!.params.winner_rider_id, "solo1");

  const attackEvent = result.events.find((e) => e.type === "finale_attack");
  assert.ok(attackEvent, "finale_attack skal emitteres naar et forspring baeres helt i maal");
});

test("finaleHook: staerk/frisk jagtgruppe indhenter svagt/traet forspring (maalbar mekanik)", () => {
  const soloAbilities = abilities({ tempo: 1, endurance: 1, durability: 1 });
  const chaseAbilities = abilities({ tempo: 99, endurance: 99, aggression: 99 });

  const entrants: Record<string, Entrant> = { solo1: makeEntrant("solo1", soloAbilities) };
  const chaseIds = ["c1", "c2"];
  for (const id of chaseIds) entrants[id] = makeEntrant(id, chaseAbilities);

  const riders: Record<string, RiderState> = {
    solo1: makeRiderState("solo1", "solo-lead", { wprime: 0.1, wprimeMax: 1 }),
    ...Object.fromEntries(chaseIds.map((id) => [id, makeRiderState(id, "chase-1", { wprime: 1, wprimeMax: 1 })])),
  };

  const groups: RaceGroup[] = [
    { id: "solo-lead", kind: "solo", rider_ids: ["solo1"], gap_seconds: 0, cohesion: 1 },
    { id: "chase-1", kind: "chase", rider_ids: chaseIds, gap_seconds: 5, cohesion: 1 },
  ];

  const state = buildState(groups, riders);
  const ctx = makeCtx({ entrants, segment: { kind: "flat", from_km: 145, to_km: 150 } });

  const result = finaleHook(state, ctx);

  // Indhentning bevises ved at solo1 IKKE laengere er den ryttere man finder i
  // fronten (gap 0) — den friske/staerke jagtgruppe overhaler ham i placerings-
  // opgoeret, i stedet for at solo1 blot beholder et uroert "reelt" forspring.
  const frontGroup = result.state.groups.find((g) => g.gap_seconds === 0)!;
  assert.ok(frontGroup, "der skal vaere en frontgruppe med gap 0");
  assert.ok(!frontGroup.rider_ids.includes("solo1"), "solo1 skal vaere overhalet, ikke staa forrest efter indhentning");
  assert.ok(chaseIds.every((id) => frontGroup.rider_ids.includes(id)), "den staerke jagtgruppe skal ligge forrest efter indhentning");

  const allContenderIds = result.state.groups.flatMap((g) => g.rider_ids);
  assert.deepEqual(new Set(allContenderIds), new Set(["solo1", "c1", "c2"]), "alle tre ryttere skal indgaa i placerings-opgoeret");

  // Ingen gruppe maa bevare det oprindelige uroerte 5s-forspring — det er netop
  // det den maalbare mekanik lukkede.
  assert.ok(!result.state.groups.some((g) => g.gap_seconds === 5), "det oprindelige urørte forspring maa ikke overleve");
});

// ── Kontrakt-test 2: punch-evne rangkorrelerer med placering (finale_type punch) ─

test("finaleHook: placering foelger 1:1 den punch-vaegtede evne ved finale_type 'punch'", () => {
  const riderIds = Array.from({ length: 15 }, (_, i) => `p${i}`);
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (let i = 0; i < riderIds.length; i++) {
    const skill = 5 + i * 6; // unikke, stigende vaerdier 5..89
    entrants[riderIds[i]] = makeEntrant(
      riderIds[i],
      abilities({ punch: skill, acceleration: skill, climbing: skill, tactics: skill }),
    );
    // identisk reserve for alle -> reserve-bidraget kan ikke forstyrre korrelationen
    riders[riderIds[i]] = makeRiderState(riderIds[i], "peloton-0", { wprime: 0.6, wprimeMax: 1 });
  }

  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: riderIds, gap_seconds: 0, cohesion: 1 }];
  const state = buildState(groups, riders);
  const ctx = makeCtx({ entrants, finaleType: "punch" });

  const result = finaleHook(state, ctx);

  const orderedByGap = [...result.state.groups]
    .sort((a, b) => a.gap_seconds - b.gap_seconds)
    .flatMap((g) => g.rider_ids);
  const expectedOrder = [...riderIds].reverse(); // hoejeste skill (p14) foerst

  assert.deepEqual(orderedByGap, expectedOrder, "raekkefoelgen skal matche punch-evnen praecis (ingen ties i denne fixture)");
});

// ── Kontrakt-test 3: gruppe-tids-invarianten holdes (fuld segment-loop) ────────

const SEGMENT_KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];
const FINALE_TYPES: (FinaleType | null)[] = [null, "bunch_sprint", "reduced_sprint", "punch", "breakaway", "descent", "long_climb", "solo_tt"];

function buildLastSegment(kind: SegmentKind, fromKm: number, toKm: number): Segment {
  switch (kind) {
    case "climb":
      return { kind, from_km: fromKm, to_km: toKm, category: "2", avg_gradient: 6, top_elevation_m: 900 };
    case "descent":
      return { kind, from_km: fromKm, to_km: toKm, technicality: 2 };
    case "cobbles":
      return { kind, from_km: fromKm, to_km: toKm, sector_name: "Test Sector", stars: 3 };
    default:
      return { kind, from_km: fromKm, to_km: toKm };
  }
}

function buildStartlist(count: number, matrix: Record<AbilityKey, number>[]): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `r${i}`,
    abilities: matrix[i],
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
}

const abilitiesArb: fc.Arbitrary<Record<AbilityKey, number>> = fc
  .array(fc.integer({ min: 0, max: 99 }), { minLength: ABILITY_KEYS.length, maxLength: ABILITY_KEYS.length })
  .map((values) => {
    const out = {} as Record<AbilityKey, number>;
    ABILITY_KEYS.forEach((key, i) => (out[key] = values[i]));
    return out;
  });

const stageInputArb: fc.Arbitrary<StageInput> = fc
  .tuple(
    fc.integer({ min: 4, max: 24 }),
    fc.constantFrom(...SEGMENT_KINDS),
    fc.integer({ min: 1, max: 15 }),
    fc.constantFrom(...FINALE_TYPES),
    fc.string({ minLength: 1, maxLength: 16 }),
  )
  .chain(([count, lastKind, lastLen, finaleType, seed]) =>
    fc.array(abilitiesArb, { minLength: count, maxLength: count }).map((matrix) => {
      const lastSegment = buildLastSegment(lastKind, 10, 10 + lastLen);
      const route: RouteV2 = {
        distance_km: 10 + lastLen,
        profile_type: "hilly",
        finale_type: finaleType,
        segments: [{ kind: "flat", from_km: 0, to_km: 10 }, lastSegment],
        weather: { kind: "sun", wind_exposure: 0.2 },
        waypoints: [],
      };
      const input: StageInput = {
        route,
        startlist: buildStartlist(count, matrix),
        orders: [],
        seed,
        tuning: RACE_V4_TUNING,
      };
      return input;
    }),
  );

test("finaleHook: gruppe-tids-invarianten holdes gennem hele segment-loopet (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const { state } = runSegmentLoop(input, {
        climbSelection: DEFAULT_MECHANIC_HOOKS.climbSelection,
        descent: DEFAULT_MECHANIC_HOOKS.descent,
        finale: finaleHook,
        breakaway: DEFAULT_MECHANIC_HOOKS.breakaway,
      });
      const timeByGroup = new Map<string, number>();
      for (const rider of Object.values(state.riders)) {
        const existing = timeByGroup.get(rider.group_id);
        if (existing === undefined) {
          timeByGroup.set(rider.group_id, rider.time_seconds);
        } else {
          assert.equal(rider.time_seconds, existing, `rider ${rider.rider_id} i gruppe ${rider.group_id} afviger fra gruppens tid`);
        }
      }
    }),
    { numRuns: 200 },
  );
});

test("finaleHook: determinisme - samme input giver byte-identisk hook-output", () => {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities({ punch: 70 })),
    b: makeEntrant("b", abilities({ punch: 40 })),
  };
  const riders: Record<string, RiderState> = {
    a: makeRiderState("a", "peloton-0", { wprime: 0.7, wprimeMax: 1 }),
    b: makeRiderState("b", "peloton-0", { wprime: 0.7, wprimeMax: 1 }),
  };
  const groups: RaceGroup[] = [{ id: "peloton-0", kind: "peloton", rider_ids: ["a", "b"], gap_seconds: 0, cohesion: 1 }];
  const state = buildState(groups, riders);
  const ctx = makeCtx({ entrants, finaleType: "punch" });

  const r1 = finaleHook(state, ctx);
  const r2 = finaleHook(state, ctx);
  assert.deepEqual(r1, r2);
});

// ── Property-test: monotoni i finale-score paa den testede evne (fast-check, 200 runs) ─

const PUNCH_DEMAND = RACE_V4_TUNING.finale.demandVectorByFinaleType.punch!;
const DEMAND_KEYS = Object.keys(PUNCH_DEMAND) as AbilityKey[];

test("computeFinaleAbilityScore: monotont ikke-faldende i enhver enkelt evne i demandVector (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...DEMAND_KEYS),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      (key, baseValue, delta) => {
        const lower = baseValue;
        const higher = Math.min(99, baseValue + delta);
        const baseAbilities = abilities();
        const abilitiesLow = { ...baseAbilities, [key]: lower };
        const abilitiesHigh = { ...baseAbilities, [key]: higher };

        const scoreLow = computeFinaleAbilityScore(abilitiesLow, 0.5, PUNCH_DEMAND, 0.15);
        const scoreHigh = computeFinaleAbilityScore(abilitiesHigh, 0.5, PUNCH_DEMAND, 0.15);

        assert.ok(scoreHigh >= scoreLow - 1e-9, `score faldt da ${key} steg fra ${lower} til ${higher}: ${scoreLow} -> ${scoreHigh}`);
      },
    ),
    { numRuns: 200 },
  );
});

// ── #4914: feltets antals-fordel i massefinalen ──────────────────────────────

test("bunchCatchWindowSeconds: 0 uden antals-fordel, fuldt vindue ved referenceforholdet, monotont derimellem", () => {
  assert.equal(bunchCatchWindowSeconds(10, 10, 120, 2), 0, "lige store grupper => ingen antals-fordel");
  assert.equal(bunchCatchWindowSeconds(5, 10, 120, 2), 0, "faerre jagende end flygtende => ingen antals-fordel");
  assert.equal(bunchCatchWindowSeconds(20, 10, 120, 2), 120, "referenceforholdet giver det fulde vindue");
  assert.equal(bunchCatchWindowSeconds(200, 10, 120, 2), 120, "vinduet er clampet — vokser aldrig ud over loftet");
  assert.equal(bunchCatchWindowSeconds(0, 10, 120, 2), 0);
  assert.equal(bunchCatchWindowSeconds(10, 0, 120, 2), 0);

  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 400 }),
      fc.integer({ min: 1, max: 400 }),
      fc.integer({ min: 1, max: 200 }),
      (chaseLow, extra, defenders) => {
        const lower = bunchCatchWindowSeconds(chaseLow, defenders, 120, 2);
        const higher = bunchCatchWindowSeconds(chaseLow + extra, defenders, 120, 2);
        // Flere jagende maa ALDRIG give et mindre vindue (styrke-neutralitet:
        // leddet giver feltet dets antal, det traekker aldrig fra fronten).
        assert.ok(higher >= lower - 1e-9);
      },
    ),
    { numRuns: 200 },
  );
});

test("isBunchCatchRoute: kun massefinale paa flad/rullende profil", () => {
  assert.equal(isBunchCatchRoute({ finale_type: "bunch_sprint", profile_type: "flat" }), true);
  assert.equal(isBunchCatchRoute({ finale_type: "reduced_sprint", profile_type: "rolling" }), true);
  assert.equal(isBunchCatchRoute({ finale_type: null, profile_type: "flat" }), true, "uklassificeret flad rute falder tilbage paa profilen");
  assert.equal(isBunchCatchRoute({ finale_type: "reduced_sprint", profile_type: "hilly" }), false, "kuperet massespurt er selektiv");
  assert.equal(isBunchCatchRoute({ finale_type: "reduced_sprint", profile_type: "cobbles" }), false, "brosten er selektiv");
  assert.equal(isBunchCatchRoute({ finale_type: "long_climb", profile_type: "high_mountain" }), false);
  assert.equal(isBunchCatchRoute({ finale_type: "breakaway", profile_type: "flat" }), false, "flad udbrudsfinale er ikke et samlet feltopgoer");
});

/**
 * Fixture til antals-testene: et lille, STAERKT udbrud i front og en stor,
 * SVAG peloton bagude. Jagt-formlen alene lukker intet hul her (chasePower <
 * leadDefend => netClosingPower clampet til 0) — kun antals-vinduet kan.
 */
function buildBreakVsPelotonState(gapSeconds: number) {
  const breakIds = ["b1", "b2", "b3"];
  const pelotonIds = Array.from({ length: 30 }, (_, i) => `p${i}`);
  const entrants: Record<string, Entrant> = {};
  for (const id of breakIds) entrants[id] = makeEntrant(id, abilities({ tempo: 99, endurance: 99, durability: 99, sprint: 99 }));
  for (const id of pelotonIds) entrants[id] = makeEntrant(id, abilities({ tempo: 1, endurance: 1, aggression: 1, sprint: 1 }));

  const riders: Record<string, RiderState> = {
    ...Object.fromEntries(breakIds.map((id) => [id, makeRiderState(id, "breakaway-0", { wprime: 1, wprimeMax: 1 })])),
    ...Object.fromEntries(pelotonIds.map((id) => [id, makeRiderState(id, "peloton-0", { wprime: 0.1, wprimeMax: 1 })])),
  };

  const groups: RaceGroup[] = [
    { id: "breakaway-0", kind: "breakaway", rider_ids: breakIds, gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: pelotonIds, gap_seconds: gapSeconds, cohesion: 1 },
  ];
  return { entrants, riders, groups, breakIds, pelotonIds };
}

test("finaleHook (#4914): feltet henter et lille udbrud inden for antals-vinduet paa en flad massefinale", () => {
  const gap = FINALE_EXTRA_TUNING.bunchCatchMaxSeconds / 2;
  const { entrants, riders, groups, breakIds, pelotonIds } = buildBreakVsPelotonState(gap);

  const result = finaleHook(buildState(groups, riders), makeCtx({
    entrants,
    finaleType: "bunch_sprint",
    profileType: "flat",
    segment: { kind: "flat", from_km: 149, to_km: 150 },
  }));

  assert.equal(result.state.groups.length, 1, "hele feltet skal ankomme som ÉN klump");
  const bunch = result.state.groups[0];
  assert.equal(bunch.gap_seconds, 0);
  assert.equal(bunch.rider_ids.length, breakIds.length + pelotonIds.length, "ingen rytter maa falde ud af opgoerelsen");
});

test("finaleHook (#4914): samme felt paa en SELEKTIV finale beholder udbruddets forspring", () => {
  const gap = FINALE_EXTRA_TUNING.bunchCatchMaxSeconds / 2;
  const { entrants, riders, groups, breakIds } = buildBreakVsPelotonState(gap);

  const result = finaleHook(buildState(groups, riders), makeCtx({
    entrants,
    finaleType: "punch",
    profileType: "hilly",
    segment: { kind: "flat", from_km: 149, to_km: 150 },
  }));

  const winnerGroup = result.state.groups.find((g) => g.rider_ids.some((id) => breakIds.includes(id)))!;
  assert.ok(winnerGroup.rider_ids.every((id) => breakIds.includes(id)), "peloton'en maa IKKE smelte ind paa en selektiv finale");
  const chase = result.state.groups.find((g) => g.rider_ids.includes("p0"))!;
  assert.ok(chase.gap_seconds > RACE_V4_TUNING.groups.mergeThresholdSeconds, "peloton'en taber reel tid");
});

test("finaleHook (#4914): et stort nok forspring koerer stadig hjem paa fladt (styrke straffes ikke)", () => {
  const gap = FINALE_EXTRA_TUNING.bunchCatchMaxSeconds * 2;
  const { entrants, riders, groups, breakIds } = buildBreakVsPelotonState(gap);

  const result = finaleHook(buildState(groups, riders), makeCtx({
    entrants,
    finaleType: "bunch_sprint",
    profileType: "flat",
    segment: { kind: "flat", from_km: 149, to_km: 150 },
  }));

  const winnerGroup = result.state.groups.find((g) => g.rider_ids.some((id) => breakIds.includes(id)))!;
  assert.ok(winnerGroup.rider_ids.every((id) => breakIds.includes(id)), "udbruddet skal vinde naar hullet er stoerre end vinduet");
  const sprintDecided = result.events.find((e) => e.type === "sprint_decided")!;
  assert.ok(breakIds.includes(String(sprintDecided.params.winner_rider_id)));
});

test("computeFinaleAbilityScore: monotont ikke-faldende i W'-reserve", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (r1, r2) => {
      const [lower, higher] = r1 <= r2 ? [r1, r2] : [r2, r1];
      const ab = abilities();
      const scoreLow = computeFinaleAbilityScore(ab, lower, PUNCH_DEMAND, 0.15);
      const scoreHigh = computeFinaleAbilityScore(ab, higher, PUNCH_DEMAND, 0.15);
      assert.ok(scoreHigh >= scoreLow - 1e-9);
    }),
    { numRuns: 200 },
  );
});
