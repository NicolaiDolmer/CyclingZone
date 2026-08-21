// backend/lib/engine/v4/index.test.ts
// Property-tests for kerne-kontrakten (designdoc §2 invariant 1/4 + byggeplan
// §8 Fase A-krav: determinisme, gruppe-tid, km-daekning). fast-check, 200 runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { simulateStageV4 } from "./index.ts";
import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { makeGroupId, splitGroup } from "./groups.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type {
  AbilityKey,
  Entrant,
  FinaleType,
  MechanicHooks,
  ProfileType,
  RouteV2,
  Segment,
  SegmentKind,
  StageInput,
  WeatherKind,
} from "./types.ts";

// ── Arbitraries ────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

const ROLES: Entrant["role"][] = ["captain", "sprint_captain", "helper", "hunter", "free_role"];

function zipAbilities(values: number[]): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  ABILITY_KEYS.forEach((key, i) => {
    out[key] = values[i];
  });
  return out;
}

const abilitiesArb: fc.Arbitrary<Record<AbilityKey, number>> = fc
  .array(fc.integer({ min: 0, max: 99 }), { minLength: ABILITY_KEYS.length, maxLength: ABILITY_KEYS.length })
  .map(zipAbilities);

function buildStartlist(count: number, matrix: Record<AbilityKey, number>[]): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `r${i}`,
    abilities: matrix[i],
    role: ROLES[i % ROLES.length],
    effort: "normal" as const,
    condition: 1,
  }));
}

const startlistArb: fc.Arbitrary<Entrant[]> = fc.integer({ min: 6, max: 20 }).chain((count) =>
  fc.array(abilitiesArb, { minLength: count, maxLength: count }).map((matrix) => buildStartlist(count, matrix)),
);

const SEGMENT_KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];
const segmentKindArb = fc.constantFrom(...SEGMENT_KINDS);

const PROFILE_TYPES: ProfileType[] = ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "classic"];
const profileTypeArb = fc.constantFrom(...PROFILE_TYPES);

const FINALE_TYPES: (FinaleType | null)[] = [
  null, "bunch_sprint", "reduced_sprint", "punch", "breakaway", "descent", "long_climb",
];
const finaleTypeArb = fc.constantFrom(...FINALE_TYPES);

const WEATHER_KINDS: WeatherKind[] = ["sun", "overcast", "rain", "wind"];
const weatherKindArb = fc.constantFrom(...WEATHER_KINDS);

function buildSegment(kind: SegmentKind, fromKm: number, toKm: number, index: number): Segment {
  switch (kind) {
    case "climb":
      return {
        kind, from_km: fromKm, to_km: toKm,
        category: (["HC", "1", "2", "3", "4"] as const)[index % 5],
        avg_gradient: 4 + (index % 6),
        top_elevation_m: 500 + index * 50,
      };
    case "descent":
      return { kind, from_km: fromKm, to_km: toKm, technicality: ((index % 3) + 1) as 1 | 2 | 3 };
    case "cobbles":
      return { kind, from_km: fromKm, to_km: toKm, sector_name: `Sector ${index}`, stars: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5 };
    default:
      return { kind, from_km: fromKm, to_km: toKm };
  }
}

// Deleret afrunding af segment-graenser (samme moenster som routeSegments.js's
// roundBoundaries): garanterer [0,distance_km]-daekning uden huller/overlap.
function roundBoundaries(segments: Segment[], distanceKm: number): Segment[] {
  if (segments.length === 0) return segments;
  segments[0].from_km = 0;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const to = isLast ? distanceKm : Math.round(segments[i].to_km * 10) / 10;
    segments[i].to_km = to;
    if (!isLast) segments[i + 1].from_km = to;
  }
  return segments.filter((s) => s.to_km > s.from_km);
}

function buildRoute(
  kinds: SegmentKind[],
  lengths: number[],
  profileType: ProfileType,
  finaleType: FinaleType | null,
  weatherKind: WeatherKind,
): RouteV2 {
  let cursor = 0;
  const raw: Segment[] = kinds.map((kind, i) => {
    const from = cursor;
    const to = cursor + lengths[i];
    cursor = to;
    return buildSegment(kind, from, to, i);
  });
  const distanceKm = Math.max(1, Math.round(cursor * 10) / 10);
  const segments = roundBoundaries(raw, distanceKm);
  return {
    distance_km: distanceKm,
    profile_type: profileType,
    finale_type: finaleType,
    segments,
    weather: { kind: weatherKind, wind_exposure: 0.2 },
    waypoints: [],
  };
}

const routeArb: fc.Arbitrary<RouteV2> = fc.integer({ min: 2, max: 6 }).chain((segCount) =>
  fc
    .tuple(
      fc.array(segmentKindArb, { minLength: segCount, maxLength: segCount }),
      fc.array(fc.integer({ min: 1, max: 15 }), { minLength: segCount, maxLength: segCount }),
      profileTypeArb,
      finaleTypeArb,
      weatherKindArb,
    )
    .map(([kinds, lengths, profileType, finaleType, weatherKind]) => buildRoute(kinds, lengths, profileType, finaleType, weatherKind)),
);

const seedArb = fc.string({ minLength: 1, maxLength: 16 });

const stageInputArb: fc.Arbitrary<StageInput> = fc.tuple(routeArb, startlistArb, seedArb).map(([route, startlist, seed]) => ({
  route,
  startlist,
  orders: [],
  seed,
  tuning: RACE_V4_TUNING,
}));

// ── §2 invariant 1: determinisme ────────────────────────────────────────────

test("determinisme: simulateStageV4(x) er deep-equal ved gentagne kald (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const a = simulateStageV4(input);
      const b = simulateStageV4(input);
      assert.deepEqual(a, b);
    }),
    { numRuns: 200 },
  );
});

// ── §2 invariant 4: km-daekning ──────────────────────────────────────────────

test("km-daekning: timeline-events har 0<=km<=distance_km og er monotont ordnet (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const out = simulateStageV4(input);
      let lastKm = -1;
      for (const event of out.timeline.events) {
        assert.ok(event.km >= 0 && event.km <= input.route.distance_km + 1e-6, `km=${event.km} uden for [0,${input.route.distance_km}]`);
        assert.ok(event.km >= lastKm - 1e-6, `km ikke monotont ordnet: ${event.km} efter ${lastKm}`);
        lastKm = event.km;
      }
    }),
    { numRuns: 200 },
  );
});

test("km-daekning: sidste gruppe-snapshot lander praecis paa distance_km (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const out = simulateStageV4(input);
      const last = out.groupSnapshots[out.groupSnapshots.length - 1];
      assert.ok(last, "skal have mindst ét snapshot naar der er segmenter");
      assert.ok(Math.abs(last.km - input.route.distance_km) < 1e-6);
    }),
    { numRuns: 200 },
  );
});

// ── mor-spec §3.2 / SS2 invariant 2: rent gruppe-princip ────────────────────
// Bruger en test-only climbSelection-hook der faktisk splitter grupper (F2's
// DEFAULT_MECHANIC_HOOKS er no-op og oever derfor aldrig split/merge-vejen i
// simulateStageV4 selv) — verificerer at groups.ts + segmentLoop.ts's tid-
// tildeling holder invarianten ogsaa naar der reelt opstaar flere grupper.

function makeTestSplitHook(): MechanicHooks["climbSelection"] {
  let seq = 0;
  return (state, _ctx) => {
    const group = state.groups.find((g) => g.rider_ids.length > 1);
    if (!group) return { state, events: [] };
    const half = Math.floor(group.rider_ids.length / 2);
    if (half === 0) return { state, events: [] };
    const dropped = [...group.rider_ids].sort().slice(0, half);
    seq += 1;
    const groups = splitGroup(state.groups, group.id, dropped, {
      id: makeGroupId("chase", seq),
      kind: "chase",
      gapSecondsDelta: 20,
    });
    return { state: { ...state, groups }, events: [] };
  };
}

test("gruppe-tid-invariant: alle ryttere i samme sluttgruppe har identisk tid, ogsaa efter splits (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const hooks: MechanicHooks = {
        climbSelection: makeTestSplitHook(),
        descent: DEFAULT_MECHANIC_HOOKS.descent,
        finale: DEFAULT_MECHANIC_HOOKS.finale,
      };
      const { state } = runSegmentLoop(input, hooks);
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

// ── §2 invariant 5 (fog-gate): sanity-check paa Fase A's egne event-params ──

const FORBIDDEN_PARAM_KEYS = new Set(["cp", "wprime", "wprimemax", "dayform", "jour_sans", "components"]);

test("fog-gate-sanity: Fase As event-params indeholder ingen raa fysiologi-noegler", () => {
  fc.assert(
    fc.property(stageInputArb, (input) => {
      const out = simulateStageV4(input);
      for (const event of out.timeline.events) {
        for (const key of Object.keys(event.params)) {
          assert.ok(!FORBIDDEN_PARAM_KEYS.has(key.toLowerCase()), `event ${event.type} laekker raa noegle: ${key}`);
        }
      }
    }),
    { numRuns: 100 },
  );
});
