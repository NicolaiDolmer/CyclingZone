// backend/lib/engine/v4/mechanics/timeLimit.test.ts
// Kontrakt- + property-tests for M15 (tidsgraensen, #2582, ejer-beslutning 6/9).
// Reglen i klartekst: docs/RACE_ENGINE_RULES.md §2d.
//
// Testene laaser REGLEN, ikke tallene: en rytter inden for graensen maa ALDRIG
// rammes, en stor samlet ankomst reddes ALTID, en lille goer det aldrig,
// bjerg er ALTID mildere end fladt, og udfaldet afhaenger aldrig af hvem
// rytteren koerer for. De konkrete faktorer er startgaet og kalibreres.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyTimeLimit,
  groupByArrival,
  grupettoThresholdFor,
  timeLimitFactorFor,
  timeLimitSecondsFor,
  TIME_LIMIT_TUNING,
  OTL_STATUS,
  OUTSIDE_TIME_LIMIT_EVENT,
  GRUPETTO_SAVED_EVENT,
} from "./timeLimit.ts";
import { validateTimelineEvents } from "../timeline.ts";
import { simulateStageV4 } from "../index.ts";
import { FINALE_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, ProfileType, RouteV2, StageResult } from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

const ALL_PROFILE_TYPES: ProfileType[] = [
  "flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles",
  "gravel", "classic", "itt", "itt_hilly", "ttt",
];

/** Resultatliste med de givne sluttider, rank 1..N i tidsorden. */
function resultsFromTimes(times: number[], prefix = "r"): StageResult[] {
  return [...times]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ t, i }, rank) => ({
      rider_id: `${prefix}${String(i).padStart(3, "0")}`,
      rank: rank + 1,
      time_seconds: t,
      group_id: `g-${t}`,
      status: "finished" as const,
    }));
}

// ── (d) Graensen skalerer med etapetype ──────────────────────────────────────

test("M15 (d): graensen er strengt mildere paa bjerg end paa fladt, og hoejbjerg mildest af de tre", () => {
  const flat = timeLimitFactorFor("flat");
  const mountain = timeLimitFactorFor("mountain");
  const high = timeLimitFactorFor("high_mountain");
  assert.ok(flat < mountain, `flad (${flat}) skal vaere strammere end bjerg (${mountain})`);
  assert.ok(mountain < high, `bjerg (${mountain}) skal vaere strammere end hoejbjerg (${high})`);
  assert.ok(flat >= 0.05, "flad maa ikke ligge under UCI-baandets bund (5 %)");
  assert.ok(high <= 0.2, "hoejbjerg maa ikke ligge over UCI-baandets top (20 %)");
});

test("M15 (d): alle 11 etapetyper har en faktor, og enkeltstart/holdtidskoersel foelger UCI-praksis (over massestarts-baandet)", () => {
  for (const profileType of ALL_PROFILE_TYPES) {
    const factor = TIME_LIMIT_TUNING.factorByProfileType[profileType];
    assert.ok(Number.isFinite(factor), `${profileType} mangler en graense-faktor`);
    assert.ok(factor > 0 && factor < 1, `${profileType}'s faktor (${factor}) er uden for et meningsfuldt baand`);
  }
  for (const tt of ["itt", "itt_hilly", "ttt"] as ProfileType[]) {
    assert.ok(
      timeLimitFactorFor(tt) > timeLimitFactorFor("high_mountain"),
      `${tt} skal foelge UCI's mildere enkeltstart-praksis`,
    );
  }
});

test("M15 (d): ukendt/manglende profile_type falder tilbage paa fallbackFactor — motoren kaster aldrig", () => {
  assert.equal(timeLimitFactorFor(null), TIME_LIMIT_TUNING.fallbackFactor);
  assert.equal(timeLimitFactorFor(undefined), TIME_LIMIT_TUNING.fallbackFactor);
  assert.equal(timeLimitFactorFor("ukendt-type" as ProfileType), TIME_LIMIT_TUNING.fallbackFactor);
});

test("M15 (d): graensen er vindertid x (1 + faktor) og monoton i vindertiden", () => {
  fc.assert(
    fc.property(fc.double({ min: 1, max: 30000, noNaN: true }), (winner) => {
      const flat = timeLimitSecondsFor(winner, "flat");
      const mountain = timeLimitSecondsFor(winner, "mountain");
      return flat > winner && mountain > flat;
    }),
    { numRuns: 300, seed: 2582 },
  );
});

// ── (a) Ingen rytter inden for graensen faar OTL ──────────────────────────────

test("M15 (a): en rytter inden for graensen faar ALDRIG status otl (300 seeds, alle etapetyper)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 120 }),
      fc.double({ min: 600, max: 20000, noNaN: true }),
      fc.constantFrom(...ALL_PROFILE_TYPES),
      fc.double({ min: 0, max: 0.8, noNaN: true }),
      (fieldSize, winnerTime, profileType, spread) => {
        // Felt spredt jaevnt fra vindertiden op til vindertid x (1 + spread) —
        // spread kan ligge bade under og over graensen.
        const times = Array.from({ length: fieldSize }, (_, i) =>
          winnerTime * (1 + (spread * i) / Math.max(1, fieldSize - 1)),
        );
        const results = resultsFromTimes(times);
        const outcome = applyTimeLimit({ results, profileType, distanceKm: 180 });
        const limit = outcome.limitSeconds;
        for (const r of outcome.results) {
          if (r.time_seconds <= limit) {
            assert.notEqual(r.status, OTL_STATUS, `rytter paa ${r.time_seconds}s (graense ${limit}s) blev OTL`);
          }
        }
        // ... og alle OTL-ramte laa faktisk over graensen.
        for (const riderId of outcome.otlRiderIds) {
          const row = outcome.results.find((r) => r.rider_id === riderId)!;
          assert.ok(row.time_seconds > limit, `OTL-rytter ${riderId} laa inden for graensen`);
        }
        return true;
      },
    ),
    { numRuns: 300, seed: 2582 },
  );
});

test("M15 (a): et felt der alle kommer ind paa vindertiden giver hverken OTL eller events", () => {
  const results = resultsFromTimes(Array.from({ length: 180 }, () => 14400));
  const outcome = applyTimeLimit({ results, profileType: "flat", distanceKm: 200 });
  assert.equal(outcome.otlRiderIds.length, 0);
  assert.equal(outcome.rescuedRiderIds.length, 0);
  assert.equal(outcome.events.length, 0, "ingen ramte => ingen events (golden fixtures forbliver bit-identiske)");
  assert.deepEqual(outcome.results, results, "uroert felt => uroert resultatliste");
});

// ── (b) Grupetto-redningen ───────────────────────────────────────────────────

test("M15 (b): en stor samlet ankomst uden for graensen reddes SAMLET", () => {
  const fieldSize = 100;
  const winnerTime = 10000;
  const overLimitTime = winnerTime * 1.5; // langt uden for enhver faktor
  const grupettoSize = 30; // 30 % af feltet, over 20 %-taersklen
  const times = [
    ...Array.from({ length: fieldSize - grupettoSize }, () => winnerTime),
    ...Array.from({ length: grupettoSize }, () => overLimitTime),
  ];
  const outcome = applyTimeLimit({ results: resultsFromTimes(times), profileType: "mountain", distanceKm: 200 });

  assert.equal(outcome.otlRiderIds.length, 0, "hele grupettoen skal reddes");
  assert.equal(outcome.rescuedRiderIds.length, grupettoSize);
  assert.ok(outcome.results.every((r) => r.status === "finished"), "ingen maa faa otl naar grupettoen reddes");

  const saved = outcome.events.find((e) => e.type === GRUPETTO_SAVED_EVENT);
  assert.ok(saved, "der skal emitteres et grupetto_saved-event");
  assert.equal((saved!.params as { rider_count: number }).rider_count, grupettoSize);
  assert.equal(outcome.events.some((e) => e.type === OUTSIDE_TIME_LIMIT_EVENT), false);
});

test("M15 (b): en for lille samlet ankomst reddes IKKE — den faar otl", () => {
  const fieldSize = 100;
  const winnerTime = 10000;
  const smallGroupSize = 5; // under baade 20 %-andelen og det absolutte gulv
  const times = [
    ...Array.from({ length: fieldSize - smallGroupSize }, () => winnerTime),
    ...Array.from({ length: smallGroupSize }, () => winnerTime * 1.5),
  ];
  const outcome = applyTimeLimit({ results: resultsFromTimes(times), profileType: "mountain", distanceKm: 200 });

  assert.equal(outcome.rescuedRiderIds.length, 0);
  assert.equal(outcome.otlRiderIds.length, smallGroupSize);
  const otl = outcome.events.find((e) => e.type === OUTSIDE_TIME_LIMIT_EVENT);
  assert.ok(otl, "der skal emitteres et outside_time_limit-event");
  assert.equal((otl!.params as { rider_count: number }).rider_count, smallGroupSize);
});

test("M15 (b): to adskilte klumper doemmes hver for sig — den store reddes, den lille ryger ud", () => {
  const winnerTime = 10000;
  const times = [
    ...Array.from({ length: 60 }, () => winnerTime),
    ...Array.from({ length: 30 }, () => winnerTime * 1.4), // stor grupetto
    ...Array.from({ length: 4 }, () => winnerTime * 1.9), // efternoelere
  ];
  const outcome = applyTimeLimit({ results: resultsFromTimes(times), profileType: "mountain", distanceKm: 200 });
  assert.equal(outcome.rescuedRiderIds.length, 30);
  assert.equal(outcome.otlRiderIds.length, 4);
});

test("M15 (b): taersklen er max(andel af feltet, absolut gulv)", () => {
  assert.equal(grupettoThresholdFor(200), Math.ceil(200 * TIME_LIMIT_TUNING.grupettoFieldFraction));
  assert.equal(grupettoThresholdFor(10), TIME_LIMIT_TUNING.grupettoMinRiders, "smaa felter styres af gulvet");
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 6000 }), (fieldSize) => {
      const t = grupettoThresholdFor(fieldSize);
      return t >= TIME_LIMIT_TUNING.grupettoMinRiders && Number.isInteger(t);
    }),
    { numRuns: 300, seed: 2582 },
  );
});

test("M15 (b): groupByArrival kaeder paa sammenhaengsvinduet, ikke paa absolut afstand til foerste mand", () => {
  const entries = [
    { rider_id: "a", time_seconds: 100 },
    { rider_id: "b", time_seconds: 101 },
    { rider_id: "c", time_seconds: 102 },
    { rider_id: "d", time_seconds: 200 },
  ];
  const groups = groupByArrival(entries, 2);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((e) => e.rider_id), ["a", "b", "c"]);
  assert.deepEqual(groups[1].map((e) => e.rider_id), ["d"]);
});

// ── (c) AI og spillere behandles ens ─────────────────────────────────────────

test("M15 (c): udfaldet er uafhaengigt af hvem rytteren koerer for — samme tider, byttede hold, samme udfald", () => {
  // Modulet har ingen holdakse overhovedet (StageResult baerer intet team-/
  // ejer-felt), saa undtagelsen er strukturelt umulig. Testen viser det
  // OBSERVERBART: to koersler hvor "spiller"- og "AI"-etiketterne er byttet
  // giver identiske udfald pr. POSITION i feltet.
  const winnerTime = 10000;
  const times = [
    ...Array.from({ length: 90 }, () => winnerTime),
    ...Array.from({ length: 6 }, (_, i) => winnerTime * (1.5 + i * 0.05)),
  ];
  const playerFirst = applyTimeLimit({ results: resultsFromTimes(times, "player-"), profileType: "mountain", distanceKm: 200 });
  const aiFirst = applyTimeLimit({ results: resultsFromTimes(times, "ai-"), profileType: "mountain", distanceKm: 200 });

  assert.deepEqual(
    playerFirst.results.map((r) => r.status),
    aiFirst.results.map((r) => r.status),
    "status pr. position i feltet skal vaere identisk uanset etiket",
  );
  assert.equal(playerFirst.otlRiderIds.length, aiFirst.otlRiderIds.length);
  assert.equal(playerFirst.limitSeconds, aiFirst.limitSeconds);
});

test("M15 (c): property — enhver ombytning af rytter-ids aendrer kun NAVNENE, aldrig hvem der rammes", () => {
  fc.assert(
    fc.property(fc.integer({ min: 10, max: 60 }), fc.integer({ min: 1, max: 20 }), (finishers, stragglers) => {
      const winnerTime = 9000;
      const times = [
        ...Array.from({ length: finishers }, () => winnerTime),
        ...Array.from({ length: stragglers }, (_, i) => winnerTime * (1.6 + i * 0.01)),
      ];
      const a = applyTimeLimit({ results: resultsFromTimes(times, "p"), profileType: "hilly", distanceKm: 180 });
      const b = applyTimeLimit({ results: resultsFromTimes(times, "q"), profileType: "hilly", distanceKm: 180 });
      assert.deepEqual(a.results.map((r) => r.status), b.results.map((r) => r.status));
      return true;
    }),
    { numRuns: 300, seed: 2582 },
  );
});

// ── (e) Determinisme ─────────────────────────────────────────────────────────

test("M15 (e): samme input giver byte-identisk udfald (ingen rng i modulet)", () => {
  const times = [
    ...Array.from({ length: 50 }, () => 8000),
    ...Array.from({ length: 12 }, (_, i) => 8000 * (1.3 + i * 0.02)),
  ];
  const results = resultsFromTimes(times);
  const a = applyTimeLimit({ results, profileType: "high_mountain", distanceKm: 210 });
  const b = applyTimeLimit({ results, profileType: "high_mountain", distanceKm: 210 });
  assert.deepEqual(a, b);
  // ... og input-listen er ikke muteret.
  assert.ok(results.every((r) => r.status === "finished"), "applyTimeLimit maa ALDRIG mutere sin input-liste");
});

test("M15 (e): input-raekkefoelgen aendrer ikke hvem der rammes (kun sorteret paa (tid, rider_id))", () => {
  const times = [
    ...Array.from({ length: 40 }, () => 8000),
    ...Array.from({ length: 7 }, (_, i) => 8000 * (1.4 + i * 0.03)),
  ];
  const forward = resultsFromTimes(times);
  const reversed = [...forward].reverse();
  const a = applyTimeLimit({ results: forward, profileType: "mountain", distanceKm: 200 });
  const b = applyTimeLimit({ results: reversed, profileType: "mountain", distanceKm: 200 });
  assert.deepEqual(new Set(a.otlRiderIds), new Set(b.otlRiderIds));
  assert.equal(a.limitSeconds, b.limitSeconds);
});

// ── (f) Monotoni + laast feltstoerrelse ──────────────────────────────────────

test("M15 (f): OTL aendrer ALDRIG rank, tid, gruppe eller raekkefoelge — kun status", () => {
  fc.assert(
    fc.property(fc.integer({ min: 5, max: 80 }), fc.integer({ min: 0, max: 30 }), (finishers, stragglers) => {
      const winnerTime = 7200;
      const times = [
        ...Array.from({ length: finishers }, (_, i) => winnerTime + i),
        ...Array.from({ length: stragglers }, (_, i) => winnerTime * (1.5 + i * 0.02)),
      ];
      const before = resultsFromTimes(times);
      const after = applyTimeLimit({ results: before, profileType: "mountain", distanceKm: 200 }).results;
      assert.equal(after.length, before.length, "feltstoerrelsen er laast (§3 invariant 6)");
      for (let i = 0; i < before.length; i++) {
        assert.equal(after[i].rider_id, before[i].rider_id);
        assert.equal(after[i].rank, before[i].rank);
        assert.equal(after[i].time_seconds, before[i].time_seconds);
        assert.equal(after[i].group_id, before[i].group_id);
      }
      // Monotoni (§3 invariant 3): en langsommere rytter kan aldrig ende foran
      // en hurtigere efter at graensen er anvendt.
      for (let i = 1; i < after.length; i++) {
        assert.ok(after[i].time_seconds >= after[i - 1].time_seconds);
      }
      return true;
    }),
    { numRuns: 300, seed: 2582 },
  );
});

test("M15 (f): udgaaede (abandoned) roeres ikke og taeller ikke som vindertid", () => {
  const results: StageResult[] = [
    { rider_id: "a", rank: 1, time_seconds: 10000, group_id: "g1", status: "finished" },
    { rider_id: "b", rank: 2, time_seconds: 10000, group_id: "g1", status: "finished" },
    { rider_id: "c", rank: 3, time_seconds: 1, group_id: "g0", status: "abandoned" },
    { rider_id: "d", rank: 4, time_seconds: 25000, group_id: "g9", status: "finished" },
  ];
  const outcome = applyTimeLimit({ results, profileType: "flat", distanceKm: 180 });
  assert.equal(outcome.winnerTimeSeconds, 10000, "en udgaaet rytters tid maa aldrig blive maalestokken");
  assert.equal(outcome.results.find((r) => r.rider_id === "c")!.status, "abandoned");
  assert.equal(outcome.results.find((r) => r.rider_id === "d")!.status, OTL_STATUS);
});

// ── (g) Tidslinje-validatoren ────────────────────────────────────────────────

test("M15 (g): begge events passerer tidslinje-validatoren (km-range, kendte ryttere, fog-gate)", () => {
  const winnerTime = 10000;
  const times = [
    ...Array.from({ length: 60 }, () => winnerTime),
    ...Array.from({ length: 25 }, () => winnerTime * 1.4), // reddet grupetto
    ...Array.from({ length: 3 }, (_, i) => winnerTime * (1.9 + i * 0.05)), // OTL
  ];
  const results = resultsFromTimes(times);
  const distanceKm = 205.5;
  const outcome = applyTimeLimit({ results, profileType: "mountain", distanceKm });
  assert.equal(outcome.events.length, 2, "baade grupetto_saved og outside_time_limit skal emitteres");

  const violations = validateTimelineEvents(outcome.events, {
    distanceKm,
    knownRiderIds: new Set(results.map((r) => r.rider_id)),
  });
  assert.deepEqual(violations, [], `validatoren skal vaere groen: ${JSON.stringify(violations)}`);
});

test("M15 (g): events laekker hverken procent, faktor eller sekundgraense (ejer-beslutning punkt 4)", () => {
  const winnerTime = 10000;
  const times = [
    ...Array.from({ length: 60 }, () => winnerTime),
    ...Array.from({ length: 25 }, () => winnerTime * 1.4),
    ...Array.from({ length: 3 }, () => winnerTime * 1.9),
  ];
  const outcome = applyTimeLimit({ results: resultsFromTimes(times), profileType: "mountain", distanceKm: 200 });
  const forbidden = ["limit", "limit_seconds", "factor", "pct", "percent", "andel", "threshold", "cutoff", "seconds"];
  for (const event of outcome.events) {
    for (const key of Object.keys(event.params)) {
      assert.ok(
        !forbidden.some((f) => key.toLowerCase().includes(f)),
        `event ${event.type} laekker "${key}" — graensen maa ALDRIG naa spilleren`,
      );
    }
    const serialized = JSON.stringify(event.params);
    assert.ok(!serialized.includes(String(outcome.limitSeconds)), "sekundgraensen maa ikke staa i params");
  }
});

// ── Forward-guard: vinduet maa aldrig falde tilbage til merge-taersklen ──────

test("M15 forward-guard: ankomst-vinduet er STOERRE end det mindst mulige finale-tier-skridt", () => {
  // finale.ts bygger hvert placerings-tier med et skridt paa mindst
  // mergeThresholdSeconds + placementGapMarginSeconds. Falder ankomst-vinduet
  // ned paa eller under det, kan to tiers per konstruktion ALDRIG kaedes til én
  // grupetto — og en grupetto der ankommer i to klumper bliver massakreret.
  const minTierStep = RACE_V4_TUNING.groups.mergeThresholdSeconds + FINALE_EXTRA_TUNING.placementGapMarginSeconds;
  assert.ok(
    TIME_LIMIT_TUNING.grupettoCohesionWindowSeconds > minTierStep,
    `ankomst-vinduet (${TIME_LIMIT_TUNING.grupettoCohesionWindowSeconds}s) skal overstige mindste tier-skridt (${minTierStep}s)`,
  );
});

test("M15 forward-guard: en grupetto der ankommer i TO klumper reddes stadig samlet", () => {
  // Regressionen fra maalingen 6/9: 18 + 12 ryttere, 104 s mellem klumperne,
  // taerskel 24 — med et 2-sekunders vindue blev begge doemt som for smaa.
  const winnerTime = 26000;
  const overLimitTime = 35800; // klart uden for bjerg-graensen
  const times = [
    ...Array.from({ length: 90 }, () => winnerTime),
    ...Array.from({ length: 18 }, () => overLimitTime),
    ...Array.from({ length: 12 }, () => overLimitTime + 104),
  ];
  const results = resultsFromTimes(times);
  const wide = applyTimeLimit({ results, profileType: "mountain", distanceKm: 200 });
  assert.equal(wide.otlRiderIds.length, 0, "de to klumper er ÉN ankomst og skal reddes samlet");
  assert.equal(wide.rescuedRiderIds.length, 30);

  const narrow = applyTimeLimit({ results, profileType: "mountain", distanceKm: 200, cohesionWindowSeconds: 2 });
  assert.equal(narrow.rescuedRiderIds.length, 0, "negativ-kontrol: et merge-taerskel-vindue laaser redningen ude");
  assert.equal(narrow.otlRiderIds.length, 30);
});

// ── End-to-end: mekanikken er WIRET, ikke kun bygget ────────────────────────

test("M15 e2e: simulateStageV4 saetter status otl og emitterer eventet paa maalstregen", () => {
  // v4's egen default-tuning komprimerer feltet saa haardt at graensen aldrig
  // bider (maalt 6/9: maks spredning 6,1 % paa bjerg mod en 15 %-graense — se
  // PR-body og RACE_ENGINE_RULES.md §7). For at bevise at KALDSSTEDET virker,
  // koeres etapen med et hoejere `strengthSpeedGain` — motorens EGEN
  // tuning-flade, ikke en test-specifik bagdoer — saa feltet spreder sig som i
  // virkeligheden.
  const abilities = (level: number): Record<AbilityKey, number> => {
    const out = {} as Record<AbilityKey, number>;
    for (const key of ABILITY_KEYS) out[key] = level;
    return out;
  };
  const startlist: Entrant[] = Array.from({ length: 120 }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: abilities(i < 90 ? 90 : 5),
    role: "free_role",
    effort: "normal",
    condition: 1,
  }));
  const route: RouteV2 = {
    distance_km: 200,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: 0, to_km: 60 },
      { kind: "climb", from_km: 60, to_km: 100, category: "HC", avg_gradient: 9, top_elevation_m: 2200 },
      { kind: "descent", from_km: 100, to_km: 130, technicality: 2 },
      { kind: "climb", from_km: 130, to_km: 200, category: "HC", avg_gradient: 9, top_elevation_m: 2400 },
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [],
  };
  const tuning = {
    ...RACE_V4_TUNING,
    terrain: { ...RACE_V4_TUNING.terrain, strengthSpeedGain: 0.5, speedMultiplierBounds: [0.35, 1.3] as const },
  };
  const output = simulateStageV4({ route, startlist, orders: [], seed: "m15-e2e", tuning });

  const otl = output.results.filter((r) => r.status === "otl");
  const rescued = output.timeline.events.find((e) => e.type === GRUPETTO_SAVED_EVENT);
  assert.ok(otl.length > 0 || rescued, "mekanikken skal vaere WIRET: enten otl-status eller en grupetto-redning");

  // Feltstoerrelsen (§3 invariant 6) og rank-permutationen er uroerte.
  assert.equal(output.results.length, startlist.length);
  const ranks = output.results.map((r) => r.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, Array.from({ length: startlist.length }, (_, i) => i + 1));

  // Tidslinjen er stadig km-monoton og fri for fog-gated noegler.
  const violations = validateTimelineEvents(output.timeline.events, {
    distanceKm: route.distance_km,
    knownRiderIds: new Set(startlist.map((e) => e.rider_id)),
  });
  assert.deepEqual(violations, [], `tidslinje-brud: ${JSON.stringify(violations)}`);
});

test("M15 e2e: default-tuning lader golden-fixture-lignende etaper vaere fuldstaendig uroert", () => {
  // Ingen ramte => ingen events => ingen aendring i output. Det er det der
  // holder de fire golden fixtures bit-identiske.
  const abilities = (level: number): Record<AbilityKey, number> => {
    const out = {} as Record<AbilityKey, number>;
    for (const key of ABILITY_KEYS) out[key] = level;
    return out;
  };
  const startlist: Entrant[] = Array.from({ length: 60 }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: abilities(30 + (i % 20)),
    role: "free_role",
    effort: "normal",
    condition: 1,
  }));
  const route: RouteV2 = {
    distance_km: 180,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 90 },
      { kind: "flat", from_km: 90, to_km: 180 },
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [],
  };
  const output = simulateStageV4({ route, startlist, orders: [], seed: "m15-inert", tuning: RACE_V4_TUNING });
  assert.ok(output.results.every((r) => r.status === "finished"));
  assert.equal(output.timeline.events.some((e) => e.type === OUTSIDE_TIME_LIMIT_EVENT), false);
  assert.equal(output.timeline.events.some((e) => e.type === GRUPETTO_SAVED_EVENT), false);
});
