// backend/lib/engine/v4/mechanics/cobbles.test.ts
// Kontrakt- + property-tests for M8 (brosten-sektorer med reel vaegt).
// SSOT: mor-spec §4 M8 + §3.1/§3.2, f2-core-design.md §7 (min. 4 properties,
// 200 runs, seeded).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { cobblesHook } from "./cobbles.ts";
import { COBBLES_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { boundRngFor } from "../rng.ts";
import type {
  AbilityKey,
  CobblesSegment,
  EngineState,
  Entrant,
  FlatSegment,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
} from "../types.ts";

// ── fixtures (spejler climbSelection.test.ts's moenster) ──────────────────

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

function cobblesSegment(overrides: Partial<CobblesSegment> = {}): CobblesSegment {
  return {
    kind: "cobbles",
    from_km: 100,
    to_km: 102.5,
    sector_name: "Test Sector",
    stars: 5,
    ...overrides,
  };
}

function routeFor(segments: Segment[], finaleType: RouteV2["finale_type"] = "bunch_sprint"): RouteV2 {
  return {
    distance_km: 200,
    profile_type: "cobbles",
    finale_type: finaleType,
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
    km: 100,
    groups: groups ?? [
      { id: "peloton-0", kind: "peloton", rider_ids: entrants.map((e) => e.rider_id), gap_seconds: 0, cohesion: 1 },
    ],
    riders,
    virtual_gc: Object.fromEntries(entrants.map((e) => [e.rider_id, 0])),
  };
}

function makeCtx(
  entrants: Entrant[],
  segment: Segment,
  opts: { seed?: string; segmentIndex?: number; finaleType?: RouteV2["finale_type"] } = {},
): SegmentHookContext {
  const entrantsById: Record<string, Entrant> = {};
  for (const e of entrants) entrantsById[e.rider_id] = e;
  return {
    segment,
    segmentIndex: opts.segmentIndex ?? 0,
    route: routeFor([segment], opts.finaleType ?? "bunch_sprint"),
    entrants: entrantsById,
    tuning: RACE_V4_TUNING,
    rngFor: boundRngFor(opts.seed ?? "cobbles-seed"),
  };
}

function splitRiderIdsFrom(state: EngineState): Set<string> {
  return new Set(state.groups.filter((g) => g.id !== "peloton-0").flatMap((g) => g.rider_ids));
}

function eventsOfType<T extends { type: string }>(events: T[], type: string): T[] {
  return events.filter((e) => e.type === type);
}

// ── kontrakt: segment-/star-gate ────────────────────────────────────────────

test("ikke-cobbles-segment: hooken er en ren no-op", () => {
  const entrants = [entrant("a"), entrant("b")];
  const state = makeState(entrants);
  const flatSegment: FlatSegment = { kind: "flat", from_km: 0, to_km: 5 };
  const result = cobblesHook(state, makeCtx(entrants, flatSegment));

  assert.equal(result.state, state, "state-referencen skal vaere uaendret (identitet, ingen kopi)");
  assert.deepEqual(result.events, []);
});

test("stars under minStarsForRealWeight: ingen split/event selv ved ekstrem evne-forskel", () => {
  const entrants = [entrant("weak", { cobblestone: 0 }), entrant("strong", { cobblestone: 99 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: (COBBLES_EXTRA_TUNING.minStarsForRealWeight - 1) as 1 | 2 | 3 | 4 | 5 });
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "gate-seed" }));

  assert.equal(result.events.length, 0, "under stjerne-taersklen er sektoren en kosmetisk passage");
  assert.equal(result.state.groups.length, 1);
});

test("solo-gruppe (< 2 ryttere) kan ikke splitte", () => {
  const entrants = [entrant("solo", { cobblestone: 90 })];
  const state = makeState(entrants);
  const segment = cobblesSegment();
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "no-risk-seed" }));

  assert.equal(eventsOfType(result.events, "peloton_splits").length, 0);
});

// ── kontrakt: selektion (sector-stars x cobblestone-evne) ──────────────────

test("stor cobblestone-evne-forskel + fuld-stjernet sektor: split med peloton_splits-event", () => {
  const entrants = [entrant("weak", { cobblestone: 0 }), entrant("strong", { cobblestone: 90 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "split-seed" }));

  const splits = eventsOfType(result.events, "peloton_splits");
  assert.equal(splits.length, 1);
  assert.equal(splits[0].params.cause, "cobbles_sector");
  assert.deepEqual(splits[0].params.rider_ids, ["weak"], "den svagere brosten-rytter skal splitte bagud");

  const source = result.state.groups.find((g) => g.id === "peloton-0")!;
  const split = result.state.groups.find((g) => g.id !== "peloton-0")!;
  assert.ok(source.rider_ids.includes("strong"));
  assert.ok(split.rider_ids.includes("weak"));
  assert.ok(split.gap_seconds > source.gap_seconds, "splittede ryttere falder bagud (positivt gap)");
});

test("ingen split naar alle ryttere har identisk cobblestone-evne", () => {
  const entrants = [entrant("a"), entrant("b"), entrant("c")];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "identical-seed" }));

  assert.equal(result.state.groups.length, 1);
  assert.equal(eventsOfType(result.events, "peloton_splits").length, 0);
});

// ── kontrakt: bounded "15-20% effekt" (mor-spec §3.1/§4 M8, task-brief) ────

test("split-gap er BOUNDED til effectFractionBounds af sektorens krydsningstid (ikke-punch-etape)", () => {
  const entrants = [entrant("weak", { cobblestone: 0 }), entrant("strong", { cobblestone: 99 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5, from_km: 100, to_km: 102.5 });
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "bound-seed", finaleType: "bunch_sprint" }));

  const split = result.state.groups.find((g) => g.id !== "peloton-0")!;
  const sectorSeconds = ((segment.to_km - segment.from_km) / RACE_V4_TUNING.terrain.baseSpeedKmh.cobbles) * 3600;
  const [fracLo, fracHi] = COBBLES_EXTRA_TUNING.effectFractionBounds;
  assert.ok(split.gap_seconds >= fracLo * sectorSeconds - 1e-6, `gap ${split.gap_seconds} under lo-bound`);
  assert.ok(split.gap_seconds <= fracHi * sectorSeconds + 1e-6, `gap ${split.gap_seconds} over hi-bound`);
});

test("punch-finale-etape faar en STOERRE (eller lig) effekt-bound end en almindelig etape (samme felt/seed/sektor)", () => {
  const entrants = [entrant("weak", { cobblestone: 0 }), entrant("strong", { cobblestone: 99 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5, from_km: 100, to_km: 102.5 });

  const normalResult = cobblesHook(state, makeCtx(entrants, segment, { seed: "punch-cmp-seed", finaleType: "bunch_sprint" }));
  const punchResult = cobblesHook(state, makeCtx(entrants, segment, { seed: "punch-cmp-seed", finaleType: "punch" }));

  const normalSplit = normalResult.state.groups.find((g) => g.id !== "peloton-0")!;
  const punchSplit = punchResult.state.groups.find((g) => g.id !== "peloton-0")!;
  assert.ok(
    punchSplit.gap_seconds >= normalSplit.gap_seconds - 1e-6,
    `punch-etape gav MINDRE effekt (${punchSplit.gap_seconds}) end normal-etape (${normalSplit.gap_seconds})`,
  );
});

test("fast-check — split-gap ALTID inden for [fracLo,fracHi]-baandet for tilfaeldige felter/sektorer (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      fc.constantFrom(3 as const, 4 as const, 5 as const),
      fc.double({ min: 0.5, max: 6, noNaN: true }),
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.constantFrom<RouteV2["finale_type"]>("bunch_sprint", "punch", "breakaway", null),
      (cobbA, cobbB, stars, lengthKm, seed, finaleType) => {
        fc.pre(cobbA !== cobbB);
        const entrants = [entrant("a", { cobblestone: cobbA }), entrant("b", { cobblestone: cobbB })];
        const state = makeState(entrants);
        const segment = cobblesSegment({ stars, from_km: 100, to_km: 100 + lengthKm });
        const result = cobblesHook(state, makeCtx(entrants, segment, { seed, finaleType: finaleType ?? undefined }));

        const split = result.state.groups.find((g) => g.id !== "peloton-0");
        if (!split) return; // intet split udloest for dette tilfaeldige felt — intet at bounde
        const sectorSeconds = (lengthKm / RACE_V4_TUNING.terrain.baseSpeedKmh.cobbles) * 3600;
        const [fracLo, fracHi] = COBBLES_EXTRA_TUNING.effectFractionBounds;
        const multiplier = finaleType === "punch" ? COBBLES_EXTRA_TUNING.punchFinaleMultiplier : 1;
        const lo = fracLo * multiplier * sectorSeconds;
        const hi = fracHi * multiplier * sectorSeconds;
        assert.ok(split.gap_seconds >= lo - 1e-6, `gap ${split.gap_seconds} under lo-bound ${lo}`);
        assert.ok(split.gap_seconds <= hi + 1e-6, `gap ${split.gap_seconds} over hi-bound ${hi}`);
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── kontrakt: monotoni-garanti (hardt krav, mor-spec §3.2) ─────────────────

test("monotoni-garanti: en staerkere cobblestone-rytter splitter aldrig mens en svagere forbliver (fast-check, 200 runs)", () => {
  const fieldArb = fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 2, maxLength: 8 });

  fc.assert(
    fc.property(
      fieldArb,
      fc.constantFrom(3 as const, 4 as const, 5 as const),
      fc.double({ min: 0.5, max: 6, noNaN: true }),
      fc.string({ minLength: 1, maxLength: 12 }),
      (cobblestoneValues, stars, lengthKm, seed) => {
        const entrants = cobblestoneValues.map((c, i) => entrant(`r${i}`, { cobblestone: c }));
        const state = makeState(entrants);
        const segment = cobblesSegment({ stars, from_km: 100, to_km: 100 + lengthKm });
        const result = cobblesHook(state, makeCtx(entrants, segment, { seed }));
        const split = splitRiderIdsFrom(result.state);

        for (let i = 0; i < cobblestoneValues.length; i++) {
          for (let j = 0; j < cobblestoneValues.length; j++) {
            if (i === j) continue;
            if (cobblestoneValues[i] <= cobblestoneValues[j]) continue;
            const strongerSplit = split.has(`r${i}`);
            const weakerSplit = split.has(`r${j}`);
            assert.ok(
              !(strongerSplit && !weakerSplit),
              `r${i} (cobblestone=${cobblestoneValues[i]}) splittede mens r${j} (cobblestone=${cobblestoneValues[j]}) forblev`,
            );
          }
        }
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

// ── kontrakt: vejr-forstaerket styrt-risiko (M11-forbrug) ──────────────────

test("regn giver ALDRIG faerre incidents end sol over mange uafhaengige seeds (samme felt, samme minStars-sektor)", () => {
  const entrants = Array.from({ length: 20 }, (_, i) => entrant(`r${i}`, { cobblestone: 30 }));
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });

  let sunIncidents = 0;
  let rainIncidents = 0;
  for (let i = 0; i < 100; i += 1) {
    const seed = `weather-risk-seed-${i}`;
    const sunCtx = makeCtx(entrants, segment, { seed });
    sunCtx.route = { ...sunCtx.route, weather: { kind: "sun", wind_exposure: 0 } };
    const rainCtx = makeCtx(entrants, segment, { seed });
    rainCtx.route = { ...rainCtx.route, weather: { kind: "rain", wind_exposure: 0 } };

    sunIncidents += eventsOfType(cobblesHook(state, sunCtx).events, "incident").length;
    rainIncidents += eventsOfType(cobblesHook(state, rainCtx).events, "incident").length;
  }
  assert.ok(rainIncidents >= sunIncidents, `regn (${rainIncidents}) gav faerre incidents end sol (${sunIncidents}) over 100 seeds`);
  assert.ok(rainIncidents > sunIncidents, "regn skal give MAALBART flere incidents over 100 uafhaengige seeds (samme felt)");
});

test("incident-events paavirker IKKE gruppe-tilhoersforhold eller tid (ren information, F2/F3-afgraensning)", () => {
  const entrants = [entrant("a", { cobblestone: 10 }), entrant("b", { cobblestone: 10 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const ctx = makeCtx(entrants, segment, { seed: "incident-no-effect-seed" });
  ctx.route = { ...ctx.route, weather: { kind: "rain", wind_exposure: 0 } };

  const result = cobblesHook(state, ctx);
  assert.equal(result.state.groups.length, 1, "ingen split naar cobblestone-evnerne er identiske, uanset incidents");
  for (const g of result.state.groups) assert.equal(g.gap_seconds, 0);
});

// ── kontrakt: fog-gate + determinisme ──────────────────────────────────────

test("fog-gate-sanity: peloton_splits-params indeholder ingen raa score-/stoej-noegler", () => {
  const FORBIDDEN_PARAM_KEYS = new Set(["score", "noise", "deficit", "basescore", "fraction"]);
  const entrants = [entrant("weak", { cobblestone: 5 }), entrant("strong", { cobblestone: 95 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const result = cobblesHook(state, makeCtx(entrants, segment, { seed: "fog-gate-seed" }));

  assert.ok(eventsOfType(result.events, "peloton_splits").length > 0, "test-fixturen skal reelt producere mindst ét split");
  for (const event of result.events) {
    for (const key of Object.keys(event.params)) {
      assert.ok(!FORBIDDEN_PARAM_KEYS.has(key.toLowerCase()), `event ${event.type} laekker raa noegle: ${key}`);
    }
  }
});

test("determinisme: samme (state, ctx) -> byte-identisk output ved gentagne kald, input muteres aldrig", () => {
  const entrants = [entrant("a", { cobblestone: 20 }), entrant("b", { cobblestone: 85 }), entrant("c", { cobblestone: 60 })];
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const ctx = makeCtx(entrants, segment, { seed: "determinism-seed" });

  const first = cobblesHook(state, ctx);
  const second = cobblesHook(state, ctx);

  assert.deepEqual(first, second);
  assert.deepEqual(state.groups, [
    { id: "peloton-0", kind: "peloton", rider_ids: ["a", "b", "c"], gap_seconds: 0, cohesion: 1 },
  ], "input-state maa aldrig muteres");
});

test("per-rytter-hash: en ekstra, uafhaengig gruppe paavirker ikke andre gruppers split-udfald", () => {
  const seed = "isolation-seed";
  const entrantsA = [entrant("weak", { cobblestone: 0 }), entrant("strong", { cobblestone: 90 })];
  const stateA = makeState(entrantsA);
  const segment = cobblesSegment({ stars: 5 });
  const resultA = cobblesHook(stateA, makeCtx(entrantsA, segment, { seed }));

  const extraEntrants: Entrant[] = [...entrantsA, entrant("extra1", { cobblestone: 10 }), entrant("extra2", { cobblestone: 80 })];
  const stateB = makeState(
    extraEntrants,
    {},
    [
      { id: "peloton-0", kind: "peloton", rider_ids: ["weak", "strong"], gap_seconds: 0, cohesion: 1 },
      { id: "chase-9", kind: "chase", rider_ids: ["extra1", "extra2"], gap_seconds: 30, cohesion: 1 },
    ],
  );
  const resultB = cobblesHook(stateB, makeCtx(extraEntrants, segment, { seed }));

  const splitA = resultA.state.groups.find((g) => g.id !== "peloton-0")!;
  const splitB = resultB.state.groups.find((g) => g.rider_ids.includes("weak") && !g.rider_ids.includes("strong"))!;
  assert.equal(splitA.gap_seconds, splitB.gap_seconds, "det ekstra feltet maa ikke flytte split-gruppens gap");
});
