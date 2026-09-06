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
import { validateTimelineEvents } from "./timeline.ts";
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
        breakaway: DEFAULT_MECHANIC_HOOKS.breakaway,
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

// ═══════════════════════════════════════════════════════════════════════════
// #2944 — M10 (incidents) er KOBLET IND i simulateStageV4. Integrations-tests:
// (f) tidslinje-validatoren faelder ingen af trappens nye events
// (g) gruppe-tids-invarianten holder stadig for ryttere UDEN uheld
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Et stort, langt loeb der GARANTERET producerer uheld med den rigtige
 * (u-riggede) tuning: 120 ryttere x 400 km. Rigges IKKE — det er hele pointen
 * at maale den motor spilleren faar.
 */
function buildIncidentHeavyInput(seed: string, profileType: ProfileType = "flat"): StageInput {
  const startlist: Entrant[] = [];
  for (let i = 0; i < 120; i += 1) {
    const base = 20 + (i % 60);
    const abilityRecord = {} as Record<AbilityKey, number>;
    for (const key of ABILITY_KEYS) abilityRecord[key] = base;
    abilityRecord.sprint = 20 + ((i * 7) % 70);
    abilityRecord.climbing = 20 + ((i * 11) % 70);
    startlist.push({
      rider_id: `r${String(i).padStart(3, "0")}`,
      abilities: abilityRecord,
      role: ROLES[i % ROLES.length],
      effort: "normal",
      condition: 1,
    });
  }
  const route: RouteV2 = {
    distance_km: 400,
    profile_type: profileType,
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 120 },
      { kind: "rolling", from_km: 120, to_km: 240 },
      { kind: "descent", from_km: 240, to_km: 320, technicality: 2 },
      { kind: "flat", from_km: 320, to_km: 400 },
    ] as Segment[],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 400 }],
  };
  return { route, startlist, orders: [], seed, tuning: RACE_V4_TUNING };
}

test("#2944 (f): tidslinje-validatoren faelder ingen af trappens fire udfald (60 loeb)", () => {
  let incidentEvents = 0;
  const seenOutcomes = new Set<string>();
  for (let i = 0; i < 60; i += 1) {
    const input = buildIncidentHeavyInput(`timeline-validator-2944-${i}`, i % 2 === 0 ? "flat" : "mountain");
    const out = simulateStageV4(input);
    const violations = validateTimelineEvents(out.timeline.events, {
      distanceKm: input.route.distance_km,
      knownRiderIds: new Set(input.startlist.map((e) => e.rider_id)),
    });
    assert.deepEqual(violations, [], `seed ${i}: ${violations.map((v) => v.message).join("; ")}`);
    for (const ev of out.timeline.events) {
      if (ev.type !== "incident") continue;
      incidentEvents += 1;
      seenOutcomes.add(String(ev.params.outcome));
      // Fog-gate (invariant 5): kun sekunder og dage — aldrig andele/risici.
      const allowed = new Set(["rider_id", "kind", "outcome", "time_loss_seconds", "severity", "injury_days", "helper_assist"]);
      for (const key of Object.keys(ev.params)) {
        assert.ok(allowed.has(key), `incident-event laekker uventet noegle "${key}"`);
      }
    }
  }
  assert.ok(incidentEvents > 0, "60 lange loeb skal producere uheld (ellers er testen vakuoest sand)");
  assert.ok(seenOutcomes.has("time_loss"), `saa aldrig outcome 'time_loss' (saa: ${[...seenOutcomes].join(", ")})`);
});

test("#2944 (g): gruppe-tids-invarianten holder for ryttere UDEN uheld, med uheld slaaet til (60 loeb)", () => {
  let checkedStages = 0;
  let stagesWithIncidents = 0;
  for (let i = 0; i < 60; i += 1) {
    const input = buildIncidentHeavyInput(`group-invariant-2944-${i}`, i % 2 === 0 ? "flat" : "mountain");
    const out = simulateStageV4(input);
    checkedStages += 1;
    const victims = new Set((out.incidents ?? []).map((inc) => inc.rider_id));
    if (victims.size > 0) stagesWithIncidents += 1;

    // Uheld er EKSOGENE: de kan flytte et offer ud af sin gruppe. Men for
    // alle andre skal gruppe-tids-princippet (invariant 2) staa uroert — et
    // uheld maa aldrig give to uskadte ryttere i SAMME gruppe forskellig tid,
    // og dermed heller ikke lade en svagere rytter faa en bedre tid end en
    // staerkere i samme gruppe.
    const timeByGroup = new Map<string, number>();
    for (const r of out.results) {
      if (victims.has(r.rider_id)) continue;
      const existing = timeByGroup.get(r.group_id);
      if (existing === undefined) timeByGroup.set(r.group_id, r.time_seconds);
      else {
        assert.equal(
          r.time_seconds,
          existing,
          `seed ${i}: uskadt rytter ${r.rider_id} afviger fra sin gruppes (${r.group_id}) tid`,
        );
      }
    }

    // Invariant 6 (laast feltstoerrelse) skal ogsaa holde MED udgaaelser:
    // en udgaaet rytter forsvinder ikke fra resultatet, han faar en status.
    assert.equal(out.results.length, input.startlist.length, `seed ${i}: feltstoerrelsen aendrede sig`);
    assert.deepEqual(
      out.results.map((r) => r.rank),
      out.results.map((_, idx) => idx + 1),
      `seed ${i}: placeringer er ikke en komplet permutation 1..N`,
    );

    // En udgaaet rytter kan aldrig staa foran en der gennemfoerte.
    let seenAbandoned = false;
    for (const r of out.results) {
      if (r.status === "abandoned") seenAbandoned = true;
      else assert.ok(!seenAbandoned, `seed ${i}: ${r.rider_id} gennemfoerte men staar EFTER en udgaaet`);
    }
  }
  assert.equal(checkedStages, 60);
  assert.ok(stagesWithIncidents > 0, "testen skal have set uheld (ellers maaler den ingenting)");
});

test("#2944: skadedage og udgaaelse baeres videre i StageResult + StageOutput.incidents", () => {
  // Scanner til der findes et loeb med mindst ét skade-givende uheld, saa
  // spejlingen result.injury_days <-> incidents[] faktisk testes paa data.
  let checked = 0;
  for (let i = 0; i < 200 && checked < 3; i += 1) {
    const input = buildIncidentHeavyInput(`injury-mirror-2944-${i}`, "mountain");
    const out = simulateStageV4(input);
    const injured = (out.incidents ?? []).filter((inc) => inc.injury_days != null);
    if (injured.length === 0) continue;
    checked += 1;

    for (const inc of injured) {
      assert.equal(inc.kind, "crash", "kun et STYRT kan skade en rytter (#4520)");
      const row = out.results.find((r) => r.rider_id === inc.rider_id)!;
      assert.ok(
        (row.injury_days ?? 0) >= inc.injury_days!,
        `${inc.rider_id}: StageResult.injury_days (${row.injury_days}) skal spejle protokollen (${inc.injury_days})`,
      );
    }
    for (const inc of out.incidents ?? []) {
      if (inc.kind !== "mechanical") continue;
      assert.equal(inc.injury_days, null);
      assert.notEqual(inc.outcome, "abandoned");
      const row = out.results.find((r) => r.rider_id === inc.rider_id)!;
      // Et mekanisk uheld alene maa aldrig give en rytter status 'abandoned'.
      const alsoCrashed = (out.incidents ?? []).some(
        (o) => o.rider_id === inc.rider_id && o.outcome === "abandoned",
      );
      if (!alsoCrashed) assert.equal(row.status, "finished");
    }
    // Protokollen er sorteret paa (km, rider_id) — stabil for aftagere.
    const sorted = [...(out.incidents ?? [])].sort((a, b) => a.km - b.km || a.rider_id.localeCompare(b.rider_id));
    assert.deepEqual(out.incidents, sorted);
  }
  assert.ok(checked > 0, "fandt aldrig et loeb med skade-givende uheld — testen maaler ingenting");
});

// ── M8 er KOBLET IND, ikke bare bygget (#3855, ejer-beslutning 6/9) ──────────
//
// "Bygget" og "koblet ind" er to kolonner (RACE_ENGINE_RULES §9): cobbles.ts
// havde 100 % groenne tests og NUL kaldssteder indtil denne PR. Testen maaler
// derfor det eneste der beviser koblingen — at simulateStageV4 (den rigtige
// LIVE_MECHANIC_HOOKS-sti, ikke et injiceret test-hook) producerer M8's egne
// events paa en rute med en reel-vaegt brostens-sektor.

function cobblesStageInput(seed: string): StageInput {
  const cobblesAbilities = (cobblestone: number): Record<AbilityKey, number> => {
    const out = {} as Record<AbilityKey, number>;
    for (const key of ABILITY_KEYS) out[key] = 50;
    out.cobblestone = cobblestone;
    return out;
  };
  const startlist: Entrant[] = Array.from({ length: 24 }, (_, i) => ({
    rider_id: `c${String(i).padStart(2, "0")}`,
    // Bred spredning i brostensevnen: selektionen har noget at arbejde med.
    abilities: cobblesAbilities(i * 4),
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
  const route: RouteV2 = {
    distance_km: 160,
    profile_type: "cobbles",
    finale_type: "reduced_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 70 },
      { kind: "cobbles", from_km: 70, to_km: 73, sector_name: "Sektor Alfa", stars: 5 },
      { kind: "flat", from_km: 73, to_km: 152 },
      { kind: "cobbles", from_km: 152, to_km: 155, sector_name: "Sektor Omega", stars: 5 },
      { kind: "flat", from_km: 155, to_km: 160 },
    ] as Segment[],
    weather: { kind: "overcast", wind_exposure: 0.3 },
    waypoints: [{ kind: "finish", index: 0, name: "Finish", km: 160 }],
  };
  return { route, startlist, orders: [], seed, tuning: RACE_V4_TUNING };
}

test("M8 er koblet ind: simulateStageV4 emitterer cobbles_sector-events paa en brostens-rute", () => {
  const out = simulateStageV4(cobblesStageInput("m8-wiring-1"));
  const m8Events = out.timeline.events.filter((e) => e.params?.cause === "cobbles_sector");
  assert.ok(m8Events.length > 0, "ingen cobbles_sector-events — M8 kaldes ikke af motoren");
  assert.ok(
    m8Events.some((e) => e.type === "peloton_splits"),
    "M8 udloeser aldrig et split — hooket kaldes, men sektoren har ingen effekt",
  );
});

test("M8-wiring bryder ikke feltstoerrelsen (invariant 6) og er deterministisk", () => {
  const input = cobblesStageInput("m8-wiring-2");
  const a = simulateStageV4(input);
  const b = simulateStageV4(input);
  assert.deepEqual(a, b, "samme input gav ikke byte-identisk output");
  assert.equal(a.results.length, input.startlist.length);
  assert.deepEqual(
    a.results.map((r) => r.rank),
    Array.from({ length: input.startlist.length }, (_, i) => i + 1),
  );
});

test("M8-wiring: en flad rute uden cobbles-segmenter er upaavirket (ingen M8-events)", () => {
  const input = cobblesStageInput("m8-wiring-3");
  const flat: StageInput = {
    ...input,
    route: {
      ...input.route,
      profile_type: "flat",
      segments: [{ kind: "flat", from_km: 0, to_km: 160 }] as Segment[],
    },
  };
  const out = simulateStageV4(flat);
  assert.equal(out.timeline.events.filter((e) => e.params?.cause === "cobbles_sector").length, 0);
});
