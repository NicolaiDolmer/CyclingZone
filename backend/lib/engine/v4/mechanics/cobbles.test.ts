// backend/lib/engine/v4/mechanics/cobbles.test.ts
// Kontrakt- + property-tests for M8 (brosten-sektorer med reel vaegt).
// SSOT: mor-spec §4 M8 + §3.1/§3.2, f2-core-design.md §7 (min. 4 properties,
// 200 runs, seeded).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { cobbledFinaleDemandVector, cobblesHook, splitTiers } from "./cobbles.ts";
import { COBBLES_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { boundRngFor, segmentRngFor } from "../rng.ts";
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
  const segmentIndex = opts.segmentIndex ?? 0;
  const stageRng = boundRngFor(opts.seed ?? "cobbles-seed");
  return {
    segment,
    segmentIndex,
    route: routeFor([segment], opts.finaleType ?? "bunch_sprint"),
    entrants: entrantsById,
    tuning: RACE_V4_TUNING,
    // #4886: riggen spejler produktionen — segmentLoop giver hooksene en
    // SEGMENT-noeglet stream, ikke etapens raa stream.
    rngFor: segmentRngFor(stageRng, segmentIndex),
    rngForStage: stageRng,
    orders: [],
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

// ── #4886: rng-stroemmen skal vaere SEGMENT-noeglet ──────────────────────────
//
// M8 kaldes pr. SEKTOR (3-6 paa brosten, 5-8 paa grus). Var streamen noeglet paa
// (seed, mekanik, rider_id) alene, ville hver rytter faa den SAMME lodtraekning
// paa hver eneste sektor: en rytter der styrter paa dagens foerste sektor ville
// styrte paa dem alle, og selektionen ville udpege praecis de samme ryttere hver
// gang. Noeglingen bor nu i kernen (segmentLoop -> rng.ts's segmentRngFor), og
// riggens makeCtx spejler den — testen fejler paa den gamle form.

test("#4886: to identiske sektorer paa FORSKELLIGE segment-index giver forskellige lodtraekninger", () => {
  // 40 ryttere med jaevn evne-spredning: nok stoej-traekninger til at to
  // uafhaengige stroemme naesten sikkert giver forskellige udfald.
  const entrants = Array.from({ length: 40 }, (_, i) => entrant(`r${String(i).padStart(2, "0")}`, { cobblestone: i * 2 }));
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });

  const first = cobblesHook(state, makeCtx(entrants, segment, { seed: "seg-key", segmentIndex: 1 }));
  const second = cobblesHook(state, makeCtx(entrants, segment, { seed: "seg-key", segmentIndex: 7 }));

  const idsOf = (r: typeof first) => [...splitRiderIdsFrom(r.state)].sort().join(",");
  assert.notEqual(
    idsOf(first),
    idsOf(second),
    "samme udvalgte ryttere paa to forskellige sektorer — rng-stroemmen er ikke segment-noeglet (#4886)",
  );
});

test("#4886: SAMME segment-index er stadig fuldt deterministisk", () => {
  const entrants = Array.from({ length: 40 }, (_, i) => entrant(`r${String(i).padStart(2, "0")}`, { cobblestone: i * 2 }));
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });

  const a = cobblesHook(state, makeCtx(entrants, segment, { seed: "seg-key", segmentIndex: 3 }));
  const b = cobblesHook(state, makeCtx(entrants, segment, { seed: "seg-key", segmentIndex: 3 }));
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.state.groups, b.state.groups);
});

// ── #6046: brostens-balancen (kun orders_gc_v1, kun brosten/grus) ──────────

function balancedCtx(
  entrants: Entrant[],
  segment: Segment,
  opts: { seed?: string; finaleType?: RouteV2["finale_type"]; profile?: RouteV2["profile_type"]; revision?: "legacy" | "orders_gc_v1" } = {},
): SegmentHookContext {
  const base = makeCtx(entrants, segment, { seed: opts.seed, finaleType: opts.finaleType });
  return {
    ...base,
    route: { ...base.route, profile_type: opts.profile ?? "cobbles" },
    rulesRevision: opts.revision ?? "orders_gc_v1",
  };
}

function spreadField(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => entrant(`r${String(i).padStart(2, "0")}`, { cobblestone: Math.round((i * 99) / (n - 1)) }));
}

test("#6046: legacy-revisionen er uaendret paa en brostensetape (ét split, som foer)", () => {
  const entrants = spreadField(30);
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const legacy = cobblesHook(state, balancedCtx(entrants, segment, { seed: "legacy-6046", revision: "legacy" }));
  const unset = cobblesHook(state, makeCtx(entrants, segment, { seed: "legacy-6046" }));
  assert.deepEqual(legacy, unset, "rulesRevision=legacy skal give praecis det gamle udfald");
  assert.ok(eventsOfType(legacy.events, "peloton_splits").length <= 1);
});

test("#6046: klassiker-profilen er uroert under orders_gc_v1", () => {
  const entrants = spreadField(30);
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const classic = cobblesHook(state, balancedCtx(entrants, segment, { seed: "classic-6046", profile: "classic" }));
  const legacy = cobblesHook(state, balancedCtx(entrants, segment, { seed: "classic-6046", profile: "classic", revision: "legacy" }));
  assert.deepEqual(classic, legacy);
});

test("#6046: under orders_gc_v1 deles de afhaengte i flere lag, og tidstabet vokser med underskuddet", () => {
  const entrants = spreadField(30);
  const state = makeState(entrants);
  const segment = cobblesSegment({ stars: 5 });
  const result = cobblesHook(state, balancedCtx(entrants, segment, { seed: "tiers-6046" }));
  const splits = eventsOfType(result.events, "peloton_splits");
  assert.ok(splits.length >= 2 && splits.length <= COBBLES_EXTRA_TUNING.maxSplitTiers, `forventede 2..max lag, fik ${splits.length}`);
  const sectorSeconds = ((segment.to_km - segment.from_km) / RACE_V4_TUNING.terrain.baseSpeedKmh.cobbles) * 3600;
  const [lo, hi] = COBBLES_EXTRA_TUNING.tieredEffectFractionBounds;
  for (const g of result.state.groups.filter((x) => x.id !== "peloton-0")) {
    assert.ok(g.gap_seconds >= lo * sectorSeconds - 1e-6 && g.gap_seconds <= hi * sectorSeconds + 1e-6, `gap ${g.gap_seconds} uden for baandet`);
  }
});

test("#6046: monotoni under orders_gc_v1 — en staerkere rytter ender aldrig bag en svagere fra samme gruppe (fast-check, 200 runs)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 2, maxLength: 24 }),
      fc.constantFrom(3 as const, 4 as const, 5 as const),
      fc.double({ min: 0.5, max: 6, noNaN: true }),
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.constantFrom<RouteV2["profile_type"]>("cobbles", "gravel"),
      (values, stars, lengthKm, seed, profile) => {
        const entrants = values.map((c, i) => entrant(`r${i}`, { cobblestone: c }));
        const state = makeState(entrants);
        const segment = cobblesSegment({ stars, from_km: 100, to_km: 100 + lengthKm });
        const result = cobblesHook(state, balancedCtx(entrants, segment, { seed, profile }));
        const gapOf = new Map(result.state.groups.flatMap((g) => g.rider_ids.map((id) => [id, g.gap_seconds] as const)));
        for (let i = 0; i < values.length; i++) {
          for (let j = 0; j < values.length; j++) {
            if (values[i] <= values[j]) continue;
            assert.ok(gapOf.get(`r${i}`)! <= gapOf.get(`r${j}`)! + 1e-9, `r${i} (${values[i]}) endte bag r${j} (${values[j]})`);
          }
        }
      },
    ),
    { numRuns: 200, seed: 6046 },
  );
});

test("#6046: splitTiers er monotont i scoren og daekker alle udvalgte praecis én gang", () => {
  const selections = [0.9, 0.2, 0.5, 0.31, 0.7, 0.2].map((baseScore, i) => ({ riderId: `r${i}`, baseScore }));
  const ids = selections.map((s) => s.riderId);
  const tiers = splitTiers(selections, ids, 3);
  assert.deepEqual(tiers.flat().sort(), [...ids].sort());
  const scoreOf = new Map(selections.map((s) => [s.riderId, s.baseScore]));
  for (let t = 1; t < tiers.length; t++) {
    assert.ok(Math.max(...tiers[t - 1].map((id) => scoreOf.get(id)!)) <= Math.min(...tiers[t].map((id) => scoreOf.get(id)!)));
  }
  assert.deepEqual(splitTiers(selections, ids, 1), [[...ids].sort()]);
});

test("#6046: cobbledFinaleDemandVector blander brostensevnen ind kun paa brosten/grus under orders_gc_v1", () => {
  const vector = { sprint: 0.5, acceleration: 0.2, positioning: 0.2, flat: 0.1 };
  const segment = cobblesSegment();
  const active = cobbledFinaleDemandVector(vector, balancedCtx([], segment));
  const share = COBBLES_EXTRA_TUNING.finaleCobblestoneShare;
  const sum = Object.values(active).reduce((s, w) => s + (w ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "vaegtsummen er uaendret");
  assert.ok(Math.abs((active.cobblestone ?? 0) - share) < 1e-9);
  assert.ok(Object.values(active).every((w) => (w ?? 0) >= 0));
  assert.equal(cobbledFinaleDemandVector(vector, balancedCtx([], segment, { revision: "legacy" })), vector);
  assert.equal(cobbledFinaleDemandVector(vector, balancedCtx([], segment, { profile: "classic" })), vector);
  assert.equal(cobbledFinaleDemandVector(vector, balancedCtx([], segment, { profile: "flat" })), vector);
});
