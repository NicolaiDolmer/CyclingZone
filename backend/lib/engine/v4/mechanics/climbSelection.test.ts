// backend/lib/engine/v4/mechanics/climbSelection.test.ts
// Kontrakt- + property-tests for M2 (klatre-selektion), designdoc §4 punkt 3
// + monotoni-afsnittet, §7 (min. 4 properties, 200 runs, seeded).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { climbSelectionHook } from "./climbSelection.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { boundRngFor } from "../rng.ts";
import type {
  AbilityKey,
  ClimbSegment,
  EngineState,
  Entrant,
  FlatSegment,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
} from "../types.ts";

// ── fixtures ─────────────────────────────────────────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
    ...overrides,
  };
}

function entrant(riderId: string, overrides: Partial<Record<AbilityKey, number>> = {}): Entrant {
  return { rider_id: riderId, abilities: abilities(overrides), role: "free_role", effort: "normal", condition: 1 };
}

function makeRiderState(riderId: string, overrides: Partial<RiderState> = {}): RiderState {
  return {
    rider_id: riderId,
    group_id: "peloton-0",
    cp: 0.5,
    wprimeMax: 0.4,
    wprime: 0.4,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
    ...overrides,
  };
}

function climbSegment(overrides: Partial<ClimbSegment> = {}): ClimbSegment {
  return { kind: "climb", from_km: 50, to_km: 58, category: "1", avg_gradient: 7, top_elevation_m: 1200, ...overrides };
}

function routeFor(segments: Segment[]): RouteV2 {
  return {
    distance_km: 100,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments,
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [],
  };
}

function makeState(
  entrants: Entrant[],
  riderOverrides: Record<string, Partial<RiderState>> = {},
  groups?: RaceGroup[],
): EngineState {
  const riders: Record<string, RiderState> = {};
  for (const e of entrants) riders[e.rider_id] = makeRiderState(e.rider_id, riderOverrides[e.rider_id]);
  return {
    km: 50,
    groups: groups ?? [
      { id: "peloton-0", kind: "peloton", rider_ids: entrants.map((e) => e.rider_id), gap_seconds: 0, cohesion: 1 },
    ],
    riders,
    virtual_gc: Object.fromEntries(entrants.map((e) => [e.rider_id, 0])),
  };
}

function makeCtx(entrants: Entrant[], segment: Segment, seed = "climb-seed", segmentIndex = 0): SegmentHookContext {
  const entrantsById: Record<string, Entrant> = {};
  for (const e of entrants) entrantsById[e.rider_id] = e;
  return {
    segment,
    segmentIndex,
    route: routeFor([segment]),
    entrants: entrantsById,
    tuning: RACE_V4_TUNING,
    rngFor: boundRngFor(seed),
  };
}

function splitRiderIdsFrom(state: EngineState): Set<string> {
  return new Set(state.groups.filter((g) => g.id !== "peloton-0").flatMap((g) => g.rider_ids));
}

// ── kontrakt-tests ───────────────────────────────────────────────────────

test("selektion sker ved W'=0: rytter med wprime=0 splitter altid bagud", () => {
  const entrants = [entrant("a"), entrant("b"), entrant("c")];
  // Kort/moderat segment: deficit-vejen alene ville ikke udloese split for
  // ryttere med identisk klatre-evne — kun wprime=0 skal drive selektionen her.
  const segment = climbSegment({ avg_gradient: 4, from_km: 0, to_km: 2 });
  const state = makeState(entrants, { c: { wprime: 0 } });
  const ctx = makeCtx(entrants, segment);

  const result = climbSelectionHook(state, ctx);

  const source = result.state.groups.find((g) => g.id === "peloton-0")!;
  const split = result.state.groups.find((g) => g.id !== "peloton-0");
  assert.ok(split, "der skal opstaa en ny gruppe");
  assert.ok(split!.rider_ids.includes("c"), "rytteren med wprime=0 skal vaere splittet bagud");
  assert.ok(!split!.rider_ids.includes("a") && !split!.rider_ids.includes("b"), "kun c skal splitte");
  assert.ok(!source.rider_ids.includes("c"));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "peloton_splits");
  assert.equal(result.events[0].params.cause, "wprime_depleted");
  assert.equal(result.events[0].params.source_group_id, "peloton-0");
  assert.deepEqual(result.events[0].params.rider_ids, ["c"]);
});

test("stærkere klatrer aldrig droppet før svagere ved samme energi (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 3, max: 12, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      fc.string({ minLength: 1, maxLength: 10 }),
      (climbA, climbB, energyFrac, gradient, length, seed) => {
        fc.pre(climbA !== climbB);
        const weakId = climbA < climbB ? "a" : "b";
        const strongId = climbA < climbB ? "b" : "a";

        const entrants = [entrant("a", { climbing: climbA }), entrant("b", { climbing: climbB })];
        const wprimeMax = 0.4;
        const wprime = wprimeMax * energyFrac;
        const state = makeState(entrants, {
          a: { wprimeMax, wprime },
          b: { wprimeMax, wprime },
        });
        const segment = climbSegment({ avg_gradient: gradient, from_km: 0, to_km: length });
        const ctx = makeCtx(entrants, segment, seed);

        const result = climbSelectionHook(state, ctx);
        const split = splitRiderIdsFrom(result.state);

        assert.ok(
          !(split.has(strongId) && !split.has(weakId)),
          `${strongId} (staerkest, climb=${Math.max(climbA, climbB)}) splittede mens ${weakId} (svagest) forblev, samme energifraktion=${energyFrac}`,
        );
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("gradient-monotoni: stejlere/laengere segment giver samme eller mere selektion (samme felt/seed)", () => {
  // a: svag klatrer (skal splitte paa BEGGE); d: moderat klatrer (skal kun
  // splitte paa det stejle segment); b/c: gruppens referenceklatrere (splitter aldrig).
  const entrants = [
    entrant("a", { climbing: 10 }),
    entrant("b", { climbing: 90 }),
    entrant("c", { climbing: 90 }),
    entrant("d", { climbing: 70 }),
  ];
  const state = makeState(entrants);

  const mild = climbSegment({ avg_gradient: 3, from_km: 0, to_km: 4 });
  const steep = climbSegment({ avg_gradient: 15, from_km: 0, to_km: 8 });

  const mildResult = climbSelectionHook(state, makeCtx(entrants, mild));
  const steepResult = climbSelectionHook(state, makeCtx(entrants, steep));

  const mildSplit = splitRiderIdsFrom(mildResult.state);
  const steepSplit = splitRiderIdsFrom(steepResult.state);

  for (const id of mildSplit) {
    assert.ok(steepSplit.has(id), `${id} splittede paa det milde segment men ikke paa det stejle`);
  }
  assert.ok(steepSplit.has("d"), "d (moderat klatrer) skal splitte paa det stejle/lange segment");
  assert.ok(!mildSplit.has("d"), "d skal IKKE splitte paa det milde/korte segment");
  assert.ok(!steepSplit.has("b") && !steepSplit.has("c"), "referenceklatrerne splitter aldrig fra sig selv");
});

test("ingen split naar alle ryttere er identiske (intet deficit, fuld energi)", () => {
  const entrants = [entrant("a"), entrant("b"), entrant("c")];
  const state = makeState(entrants);
  const segment = climbSegment({ avg_gradient: 6, from_km: 0, to_km: 5 });

  const result = climbSelectionHook(state, makeCtx(entrants, segment));

  assert.equal(result.state.groups.length, 1);
  assert.equal(result.events.length, 0);
});

test("ikke-climb-segment: hooken er en ren no-op", () => {
  const entrants = [entrant("a"), entrant("b")];
  const state = makeState(entrants);
  const flatSegment: FlatSegment = { kind: "flat", from_km: 0, to_km: 5 };
  const ctx = makeCtx(entrants, flatSegment);

  const result = climbSelectionHook(state, ctx);

  assert.equal(result.state, state, "state-referencen skal vaere uaendret (identitet, ingen kopi)");
  assert.deepEqual(result.events, []);
});

test("fog-gate-sanity: peloton_splits-params indeholder ingen raa fysiologi-noegler", () => {
  const FORBIDDEN_PARAM_KEYS = new Set(["cp", "wprime", "wprimemax", "dayform", "jour_sans", "components", "score", "noise", "deficit"]);
  const entrants = [entrant("a", { climbing: 5 }), entrant("b", { climbing: 95 }), entrant("c", { climbing: 95 })];
  const state = makeState(entrants);
  const segment = climbSegment({ avg_gradient: 10, from_km: 0, to_km: 12 });

  const result = climbSelectionHook(state, makeCtx(entrants, segment));

  assert.ok(result.events.length > 0, "test-fixturen skal reelt producere mindst ét split");
  for (const event of result.events) {
    for (const key of Object.keys(event.params)) {
      assert.ok(!FORBIDDEN_PARAM_KEYS.has(key.toLowerCase()), `event ${event.type} laekker raa noegle: ${key}`);
    }
  }
});

test("determinisme: samme (state, ctx) -> byte-identisk output ved gentagne kald", () => {
  const entrants = [entrant("a", { climbing: 20 }), entrant("b", { climbing: 85 }), entrant("c", { climbing: 60 })];
  const state = makeState(entrants);
  const segment = climbSegment({ avg_gradient: 8, from_km: 0, to_km: 10 });
  const ctx = makeCtx(entrants, segment, "determinism-seed");

  const first = climbSelectionHook(state, ctx);
  const second = climbSelectionHook(state, ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(state.groups, [
    { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b", "c"], gap_seconds: 0, cohesion: 1 },
  ], "input-state maa aldrig muteres");
});

// ── property-test: monotoni-garantien over tilfaeldige felter ──────────────
// (§7: min. 4 properties, 200 runs, seeded — dette er kernens generelle
// monotoni-invariant paa vilkaarligt sammensatte felter, ikke kun to ryttere.)

test("monotoni-garanti over tilfaeldige felter (fast-check, 200 runs, seeded)", () => {
  const fieldArb = fc.array(
    fc.record({ climbing: fc.integer({ min: 0, max: 99 }), wprimeFrac: fc.double({ min: 0, max: 1, noNaN: true }) }),
    { minLength: 2, maxLength: 8 },
  );

  fc.assert(
    fc.property(
      fieldArb,
      fc.double({ min: 2, max: 15, noNaN: true }),
      fc.double({ min: 1, max: 20, noNaN: true }),
      fc.string({ minLength: 1, maxLength: 12 }),
      (field, gradient, length, seed) => {
        const entrants = field.map((f, i) => entrant(`r${i}`, { climbing: f.climbing }));
        const wprimeMax = 0.4;
        const overrides: Record<string, Partial<RiderState>> = {};
        field.forEach((f, i) => {
          overrides[`r${i}`] = { wprimeMax, wprime: wprimeMax * f.wprimeFrac };
        });
        const state = makeState(entrants, overrides);
        const segment = climbSegment({ avg_gradient: gradient, from_km: 0, to_km: length });

        const result = climbSelectionHook(state, makeCtx(entrants, segment, seed));
        const split = splitRiderIdsFrom(result.state);

        // For hvert par med IDENTISK energi-fraktion: en staerkere klatrer maa
        // aldrig vaere splittet mens en svagere (samme par) forbliver i gruppen.
        for (let i = 0; i < field.length; i++) {
          for (let j = 0; j < field.length; j++) {
            if (i === j) continue;
            if (field[i].wprimeFrac !== field[j].wprimeFrac) continue;
            if (field[i].climbing <= field[j].climbing) continue;
            const strongerSplit = split.has(`r${i}`);
            const weakerSplit = split.has(`r${j}`);
            assert.ok(
              !(strongerSplit && !weakerSplit),
              `r${i} (climb=${field[i].climbing}) splittede mens r${j} (climb=${field[j].climbing}) forblev, samme energi=${field[i].wprimeFrac}`,
            );
          }
        }
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});
