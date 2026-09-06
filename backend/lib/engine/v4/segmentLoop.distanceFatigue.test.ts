// backend/lib/engine/v4/segmentLoop.distanceFatigue.test.ts
// Forward-guard for M7-WIRINGEN (#4885, 6/9): distance-slid + dag-til-dag-slid
// er koblet ind i segment-loopets CP-udregning.
//
// mechanics/distanceFatigue.test.ts daekker MEKANIKKEN (rene funktioner).
// Denne fil daekker KOBLINGEN — at motoren faktisk kalder den, og at den ikke
// braekker nogen af motorens haarde garantier undervejs. Uden en test paa
// koblingen kan mekanikken blive "bygget, ikke koblet ind" igen ved den foerste
// refaktorering, praecis den tilstand auditten 5/9 fandt paa otte mekanikker.
//
// Samme formuleringsprincip som fieldIntegrity.test.ts/segmentLoop.load.test.ts:
// invarianterne er SKALA-uafhaengige udsagn ("laengere kan aldrig give mindre
// slid", "hoejere endurance kan aldrig give daarligere tid"), ikke forventede
// tal — de tal der er gyldige i dag flytter sig ved naeste kalibrering.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { riderCpForSegment } from "./segmentLoop.ts";
import { deriveCp } from "./physiology.ts";
import { applyDistanceFatigueToCp } from "./mechanics/distanceFatigue.ts";
import { RACE_V4_TUNING, DISTANCE_FATIGUE_EXTRA_TUNING } from "./tuning.ts";
import { validateTimelineEvents } from "./timeline.ts";
import type { AbilityKey, Entrant, RouteV2, Segment, StageInput, StageOutput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function clamp99(n: number): number {
  return Math.max(0, Math.min(99, n));
}

function abilitiesAt(level: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = clamp99(level);
  for (const [key, value] of Object.entries(overrides)) out[key as AbilityKey] = clamp99(value as number);
  return out;
}

function climbSegment(fromKm: number, toKm: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category: "1", avg_gradient: 7, top_elevation_m: 1800 };
}

/**
 * Bjergrute med KONSTANT form (segmenternes andele) og skalerbar laengde —
 * saa distancen er den eneste variabel mellem to kald.
 */
function scaledMountainRoute(distanceKm: number): RouteV2 {
  const share = (a: number, b: number): [number, number] => [
    Math.round((a / 100) * distanceKm * 1000) / 1000,
    Math.round((b / 100) * distanceKm * 1000) / 1000,
  ];
  const [flatFrom, flatTo] = share(0, 70);
  const [climbFrom, climbTo] = share(70, 100);
  return {
    distance_km: distanceKm,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: flatFrom, to_km: flatTo },
      climbSegment(climbFrom, climbTo),
    ],
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm, summit_finish: true }],
  };
}

/** Felt hvor ryttere KUN adskiller sig paa den evne/det felt testen varierer. */
function field(
  count: number,
  make: (index: number) => { abilities: Record<AbilityKey, number>; condition: number },
): Entrant[] {
  return Array.from({ length: count }, (_, i) => {
    const { abilities, condition } = make(i);
    return {
      rider_id: `r${String(i).padStart(3, "0")}`,
      abilities,
      role: "free_role" as const,
      effort: "normal" as const,
      condition,
    };
  });
}

function stage(entrants: Entrant[], route: RouteV2, seed: string): StageInput {
  return { route, startlist: entrants, orders: [], seed, tuning: RACE_V4_TUNING };
}

function timeOf(output: StageOutput, riderId: string): number {
  const row = output.results.find((r) => r.rider_id === riderId);
  assert.ok(row, `rytter ${riderId} mangler i resultatet`);
  return row!.time_seconds;
}

// Distancer paa hver sin side af rampen (tuning.ts's monumentThresholdKm/
// monumentRampKm). Laeses AF tuningen, ikke haardkodet — testen skal blive
// sand naar rampen kalibreres om.
const BELOW_RAMP_KM = Math.max(40, DISTANCE_FATIGUE_EXTRA_TUNING.monumentThresholdKm - 40);
const ABOVE_RAMP_KM =
  DISTANCE_FATIGUE_EXTRA_TUNING.monumentThresholdKm + DISTANCE_FATIGUE_EXTRA_TUNING.monumentRampKm;

// ── 1. Koblingen findes overhovedet ──────────────────────────────────────────

test("M7 er KOBLET IND: condition paavirker udfaldet (foer wiringen blev feltet ignoreret)", () => {
  const abilities = (i: number) => abilitiesAt(30, { endurance: 10 + (i % 40), sprint: 40 + (i % 20) });
  const fresh = field(40, (i) => ({ abilities: abilities(i), condition: 1 }));
  const worn = field(40, (i) => ({ abilities: abilities(i), condition: 0.2 }));
  const route = scaledMountainRoute(ABOVE_RAMP_KM);

  const a = simulateStageV4(stage(fresh, route, "m7-condition"));
  const b = simulateStageV4(stage(worn, route, "m7-condition"));

  assert.notDeepEqual(
    a.results.map((r) => r.time_seconds),
    b.results.map((r) => r.time_seconds),
    "et helt felt med lav condition skal give et andet udfald end et friskt felt — ellers laeser motoren ikke Entrant.condition",
  );
});

test("M7 er KOBLET IND: segment-CP'en er slidt, og sliddet er ALDRIG mindre laengere inde i etapen", () => {
  // Direkte paa koblingspunktet. En ende-til-ende-test kan ikke skelne "M7 er
  // koblet fra" fra "M7 er koblet til og flyttede ingenting paa netop denne
  // rute" — det kan denne.
  const entrant = field(1, () => ({ abilities: abilitiesAt(30, { endurance: 20 }), condition: 0.7 }))[0];
  const riderState = {
    rider_id: entrant.rider_id,
    group_id: "g0",
    cp: 0,
    wprimeMax: 1,
    wprime: 1,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    time_seconds: 0,
    status: "racing" as const,
  };
  const at = (fromKm: number) =>
    riderCpForSegment(entrant, riderState, climbSegment(fromKm, fromKm + 10), RACE_V4_TUNING);

  const baseCp = deriveCp(entrant.abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  const expectedAtStart = applyDistanceFatigueToCp(baseCp, {
    kmSoFar: 0,
    enduranceAbility: entrant.abilities.endurance,
    condition: entrant.condition,
  });
  assert.equal(at(0), expectedAtStart, "loopet skal bruge PRAECIS mekanikkens vaerdi, ikke en egen udgave af den");
  assert.ok(at(0) < baseCp, "condition < 1 skal koste CP allerede ved km 0 (dag-til-dag-sliddet)");

  const kms = [0, BELOW_RAMP_KM, ABOVE_RAMP_KM, ABOVE_RAMP_KM + 60];
  for (let i = 1; i < kms.length; i++) {
    assert.ok(
      at(kms[i]) <= at(kms[i - 1]),
      `CP ved km ${kms[i]} (${at(kms[i])}) maa aldrig vaere hoejere end ved km ${kms[i - 1]} (${at(kms[i - 1])})`,
    );
  }
  assert.ok(
    at(ABOVE_RAMP_KM) < at(BELOW_RAMP_KM),
    "distance-sliddet skal vaere STRENGT stoerre paa den anden side af rampen — ellers er rampen kalibreret uden for kalenderen",
  );
});

// ── 2. Invariant 3: styrke straffes aldrig ───────────────────────────────────
// Det haarde krav (RACE_ENGINE_RULES §3, ejer 4/8). Sliddet ER en straf — det
// maa aldrig kunne ramme den staerke haardere end den svage.

test("invariant 3 under M7: hoejere endurance giver ALDRIG daarligere tid, alt andet lige", () => {
  // Feltet er ryttere der KUN adskiller sig paa endurance. Der er ingen anden
  // dimension der kan forklare en ombytning, saa en enkelt inversion faelder.
  const levels = [5, 11, 30, 60, 99];
  const entrants = field(levels.length, (i) => ({
    abilities: abilitiesAt(30, { endurance: levels[i] }),
    condition: 1,
  }));
  const output = simulateStageV4(stage(entrants, scaledMountainRoute(ABOVE_RAMP_KM), "m7-invariant3"));

  for (let i = 1; i < levels.length; i++) {
    const stronger = timeOf(output, `r${String(i).padStart(3, "0")}`);
    const weaker = timeOf(output, `r${String(i - 1).padStart(3, "0")}`);
    assert.ok(
      stronger <= weaker,
      `endurance ${levels[i]} (${stronger}s) maa aldrig vaere langsommere end endurance ${levels[i - 1]} (${weaker}s)`,
    );
  }
});

test("invariant 3 under M7: hoejere condition giver ALDRIG daarligere tid, alt andet lige", () => {
  const conditions = [0, 0.25, 0.5, 0.75, 1];
  const entrants = field(conditions.length, (i) => ({
    abilities: abilitiesAt(30),
    condition: conditions[i],
  }));
  const output = simulateStageV4(stage(entrants, scaledMountainRoute(ABOVE_RAMP_KM), "m7-condition-monotoni"));

  for (let i = 1; i < conditions.length; i++) {
    const fresher = timeOf(output, `r${String(i).padStart(3, "0")}`);
    const worn = timeOf(output, `r${String(i - 1).padStart(3, "0")}`);
    assert.ok(
      fresher <= worn,
      `condition ${conditions[i]} (${fresher}s) maa aldrig vaere langsommere end condition ${conditions[i - 1]} (${worn}s)`,
    );
  }
});

// ── 3. Determinisme + tidslinje ──────────────────────────────────────────────

test("M7 bryder ikke determinismen: samme seed giver byte-identisk output", () => {
  const entrants = field(30, (i) => ({
    abilities: abilitiesAt(30, { endurance: 5 + (i % 60) }),
    condition: 0.4 + (i % 7) / 10,
  }));
  const input = stage(entrants, scaledMountainRoute(ABOVE_RAMP_KM + 40), "m7-determinisme");

  assert.deepEqual(simulateStageV4(input), simulateStageV4(input));
});

test("M7 emitterer intet og laekker intet: tidslinje-validatoren er groen paa en monument-distance", () => {
  const entrants = field(60, (i) => ({
    abilities: abilitiesAt(30, { endurance: 5 + (i % 60), sprint: 30 + (i % 40) }),
    condition: 0.5 + (i % 6) / 10,
  }));
  const route = scaledMountainRoute(ABOVE_RAMP_KM + 40);
  const output = simulateStageV4(stage(entrants, route, "m7-timeline"));

  const violations = validateTimelineEvents(output.timeline.events, {
    distanceKm: route.distance_km,
    knownRiderIds: new Set(entrants.map((e) => e.rider_id)),
  });
  assert.deepEqual(violations, [], `tidslinje-brud: ${JSON.stringify(violations)}`);
});

// ── 4. Feltet er stadig laast (invariant 6) ──────────────────────────────────

test("M7 taber ingen ryttere: feltstoerrelsen er uaendret paa en monument-distance", () => {
  const entrants = field(80, (i) => ({
    abilities: abilitiesAt(11, { endurance: 5 + (i % 60) }),
    condition: 0.3 + (i % 8) / 10,
  }));
  const output = simulateStageV4(stage(entrants, scaledMountainRoute(ABOVE_RAMP_KM + 40), "m7-feltstoerrelse"));

  assert.equal(output.results.length, entrants.length);
  assert.equal(new Set(output.results.map((r) => r.rider_id)).size, entrants.length);
  assert.deepEqual(
    [...output.results.map((r) => r.rank)].sort((a, b) => a - b),
    entrants.map((_, i) => i + 1),
  );
});
