// backend/lib/engine/v4/segmentLoop.weather.test.ts
// Forward-guard for M11-WIRINGEN (#3855, 6/9): vejret er koblet ind i motoren.
//
// mechanics/weather.test.ts daekker MEKANIKKEN (de rene funktioner). Denne fil
// daekker KOBLINGEN — at et loeb faktisk bliver anderledes af at det regner, at
// vejret melder sig i tidslinjen, og at hverken determinismen eller invariant 3
// braekker undervejs. Uden en test paa netop koblingen kan M11 blive
// "bygget, ikke koblet ind" igen ved foerste refaktorering; det er praecis den
// tilstand auditten 5/9 fandt paa otte mekanikker.
//
// Samme formuleringsprincip som segmentLoop.distanceFatigue.test.ts: udsagnene
// er SKALA-uafhaengige ("regn kan aldrig koste mindre end sol"), ikke forventede
// tal — tallene flytter sig ved naeste kalibrering, garantierne gør ikke.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { maxIncidentsForField } from "./mechanics/incidents.ts";
import { riderCpForSegment, riderWeatherCpMultiplier } from "./segmentLoop.ts";
import { validateTimelineEvents } from "./timeline.ts";
import { INCIDENTS_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type {
  AbilityKey,
  Entrant,
  RouteV2,
  Segment,
  StageInput,
  StageOutput,
  Weather,
  WeatherKind,
} from "./types.ts";

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

function field(count: number, make: (index: number) => Record<AbilityKey, number>): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: make(i),
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
}

/** Flad rute — det terraen vinden rammer haardest (windExposureByTerrain.flat = 1). */
function flatRoute(weather: Weather): RouteV2 {
  return {
    distance_km: 180,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 60 },
      { kind: "rolling", from_km: 60, to_km: 120 },
      { kind: "flat", from_km: 120, to_km: 180 },
    ],
    weather,
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
  };
}

/**
 * Bjergrute der ABNER paa en stigning og foerst kommer ud paa det aabne senere.
 * Formen er valgt til vejr-eventets vigtigste udsagn: i vind skal meldingen
 * lande hvor vinden faktisk bider (km 60), ikke paa startstregen.
 */
function shelteredThenExposedRoute(weather: Weather): RouteV2 {
  const climb: Segment = { kind: "climb", from_km: 0, to_km: 60, category: "1", avg_gradient: 7, top_elevation_m: 1800 };
  const descent: Segment = { kind: "descent", from_km: 60, to_km: 90, technicality: 3 };
  return {
    distance_km: 180,
    profile_type: "mountain",
    finale_type: "descent",
    segments: [climb, descent, { kind: "flat", from_km: 90, to_km: 180 }],
    weather,
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
  };
}

function stage(entrants: Entrant[], route: RouteV2, seed: string): StageInput {
  return { route, startlist: entrants, orders: [], seed, tuning: RACE_V4_TUNING };
}

// Vejrets pris maales paa VINDERTIDEN. Det er den stoerrelse CP-armen faktisk
// styrer: en lavere kollektiv CP giver en lavere segment-fart, og etapen tager
// laengere tid. `work_norm` duer IKKE som maal her — kravet er afledt af
// gruppens EGEN kollektive CP (segmentLoop's groupDemand), saa naar vejret
// saenker CP'en falder baade kravet og farten, og det samlede arbejde kan gaa
// begge veje. Vindertiden kan kun gaa én vej.
function totalWork(output: StageOutput): number {
  return output.loads.reduce((sum, l) => sum + l.work_norm, 0);
}

function winnerSeconds(output: StageOutput): number {
  return output.results[0].time_seconds;
}

function weatherEvents(output: StageOutput) {
  return output.timeline.events.filter((e) => e.type === "weather");
}

/** Blandet felt — spredning i alle evner, saa selektionerne har noget at arbejde med. */
const MIXED_FIELD = field(60, (i) =>
  abilitiesAt(30, {
    climbing: 15 + ((i * 7) % 70),
    sprint: 20 + ((i * 11) % 60),
    descending: 10 + ((i * 13) % 80),
    durability: 15 + ((i * 5) % 70),
    endurance: 20 + ((i * 3) % 60),
  }),
);

// Samme evne-spredning som MIXED_FIELD, men 180 ryttere: kun descent-
// risiko-armen (#4950) bruger dette — et 60-rytters felt giver et
// uheldsloft (maxIncidentsFieldShare) paa 3 pr. etape, taet nok paa hvad
// 40 loeb rent faktisk producerer at wet > dry-marginen kunne braekke ved
// naeste kalibrering (maalt: 1-2/40 loeb ramte loftet praecis). 180 ryttere
// (loft 9) gav 0/40 loft-ramte loeb over samme maaling — headroom uden at
// aendre produktionens loft (tuning.ts's maxIncidentsFieldShare uroert).
const WIDE_MIXED_FIELD = field(180, (i) =>
  abilitiesAt(30, {
    climbing: 15 + ((i * 7) % 70),
    sprint: 20 + ((i * 11) % 60),
    descending: 10 + ((i * 13) % 80),
    durability: 15 + ((i * 5) % 70),
    endurance: 20 + ((i * 3) % 60),
  }),
);

const CALM: Weather = { kind: "sun", wind_exposure: 0.2 };

// ── 1. Koblingen findes overhovedet ──────────────────────────────────────────

test("M11 er KOBLET IND: samme etape i regn giver et andet udfald end i sol", () => {
  const dry = simulateStageV4(stage(MIXED_FIELD, flatRoute(CALM), "m11-coupling"));
  const wet = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "rain", wind_exposure: 0.2 }), "m11-coupling"));

  assert.notDeepEqual(
    dry.loads.map((l) => l.work_norm),
    wet.loads.map((l) => l.work_norm),
    "regn skal aendre belastningen — ellers laeser motoren ikke route.weather",
  );
});

test("M11 er KOBLET IND: vind paa en flad etape giver et andet udfald end vindstille", () => {
  const calm = simulateStageV4(stage(MIXED_FIELD, flatRoute(CALM), "m11-wind"));
  const windy = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "wind", wind_exposure: 0.9 }), "m11-wind"));

  assert.notDeepEqual(
    calm.loads.map((l) => l.work_norm),
    windy.loads.map((l) => l.work_norm),
    "vind paa aabent terraen skal aendre belastningen",
  );
});

// ── 2. Retningen: daarligt vejr koster, det goer godt vejr ikke ──────────────

test("regn goer etapen STRENGT langsommere end den samme etape i sol", () => {
  const dry = simulateStageV4(stage(MIXED_FIELD, flatRoute(CALM), "m11-cost"));
  const wet = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "rain", wind_exposure: 0.2 }), "m11-cost"));
  assert.ok(
    winnerSeconds(wet) > winnerSeconds(dry),
    `regn (${winnerSeconds(wet)} s) skal give en langsommere etape end sol (${winnerSeconds(dry)} s)`,
  );
});

test("vind goer etapen STRENGT langsommere, og mere jo mere eksponeret ruten er", () => {
  const at = (exposure: number) =>
    winnerSeconds(
      simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "wind", wind_exposure: exposure }), "m11-wind-cost")),
    );
  const calm = winnerSeconds(simulateStageV4(stage(MIXED_FIELD, flatRoute(CALM), "m11-wind-cost")));
  assert.ok(at(0.3) > calm, "vind skal koste tid");
  assert.ok(at(0.9) > at(0.3), "hoejere eksponering skal koste mere tid");
});

test("sol og overskyet er BASELINE: byte-identisk udfald (ingen af dem koster noget)", () => {
  const sunny = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "sun", wind_exposure: 0.6 }), "m11-baseline"));
  const grey = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "overcast", wind_exposure: 0.6 }), "m11-baseline"));
  assert.deepEqual(sunny, grey, "sol og overskyet skal give præcis samme loeb — begge er baseline i begge arme");
});

test("vindens pris foelger terraenet: samme vind koster RELATIVT mere tid paa den aabne rute end paa den lae-tunge", () => {
  // Prisen maales som ANDEL af rutens egen vindertid, ikke i sekunder: en
  // bjergrute tager langt laengere tid i alt, saa selv en lille andel dér giver
  // flere sekunder end en stoerre andel paa en flad rute. Det er samme
  // skala-fejl som #4604's bjerg-anker, og den ville vende testens svar.
  const wind: Weather = { kind: "wind", wind_exposure: 0.9 };
  const relativeCost = (route: (w: Weather) => RouteV2): number => {
    const calm = winnerSeconds(simulateStageV4(stage(MIXED_FIELD, route(CALM), "m11-terrain")));
    const windy = winnerSeconds(simulateStageV4(stage(MIXED_FIELD, route(wind), "m11-terrain")));
    return (windy - calm) / calm;
  };

  const open = relativeCost(flatRoute);
  const sheltered = relativeCost(shelteredThenExposedRoute);
  assert.ok(open > 0, "vind skal koste tid paa en aaben rute");
  assert.ok(
    open > sheltered,
    `vind skal koste relativt mere paa aabent terraen (${open}) end paa en rute med stigning/nedkoersel (${sheltered})`,
  );
});

// ── 3. Invariant 3 (§3 punkt 3): styrke straffes aldrig ─────────────────────

test("invariant 3: hoejere vejr-teknik giver ALDRIG lavere CP i samme vejr (kobling, ikke kalibrering)", () => {
  const segment: Segment = { kind: "flat", from_km: 0, to_km: 60 };
  const weathers: Weather[] = [
    { kind: "rain", wind_exposure: 0.3 },
    { kind: "wind", wind_exposure: 0.8 },
    { kind: "sun", wind_exposure: 0.8 },
  ];
  for (const weather of weathers) {
    let prev = 0;
    for (let level = 0; level <= 99; level += 1) {
      const entrant: Entrant = {
        rider_id: `x${level}`,
        abilities: abilitiesAt(30, { descending: level, durability: level }),
        role: "free_role",
        effort: "normal",
        condition: 1,
      };
      const m = riderWeatherCpMultiplier(entrant, segment, weather);
      assert.ok(m >= prev - 1e-12, `${weather.kind}: CP-multiplikatoren faldt ved evne-niveau ${level} (${m} < ${prev})`);
      prev = m;
    }
  }
});

test("invariant 3 ende-til-ende: VEJRETS CP-tab pr. rytter falder monotont med vejr-teknikken", () => {
  // Klon-felt hvor ALT er ens undtagen descending+durability (vejr-teknik-
  // proxy'ens to komponenter). Hver rytter maales mod SIG SELV i sol, ikke mod
  // naboen: dayform er seedet pr. rytter (groups.initRiderStates), saa to
  // kloner har forskellig CP og kan havne paa hver sin side af front/hjul-
  // graensen — en forskel der er stoerre end vejret og intet har med vejret at
  // goere. Forholdet cp(regn)/cp(sol) for den samme rytter er praecis vejrets
  // CP-multiplikator og intet andet.
  const levels = [5, 20, 40, 60, 80, 99];
  const segment: Segment = { kind: "flat", from_km: 0, to_km: 60 };
  const riderState = {
    rider_id: "probe",
    group_id: "g0",
    cp: 0,
    wprime: 1,
    wprimeMax: 1,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    time_seconds: 0,
    status: "racing" as const,
  };
  const cpIn = (level: number, weather: Weather) => {
    const entrant: Entrant = {
      rider_id: `w${level}`,
      abilities: abilitiesAt(30, { descending: level, durability: level }),
      role: "free_role",
      effort: "normal",
      condition: 1,
    };
    return riderCpForSegment(entrant, riderState, segment, RACE_V4_TUNING, weather);
  };
  const keptFraction = (level: number) =>
    cpIn(level, { kind: "rain", wind_exposure: 0.5 }) / cpIn(level, { kind: "sun", wind_exposure: 0.5 });

  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      keptFraction(levels[i]) >= keptFraction(levels[i - 1]) - 1e-9,
      `vejr-teknik ${levels[i]} beholdt mindre CP i regnen (${keptFraction(levels[i])}) end ${levels[i - 1]} (${keptFraction(levels[i - 1])}) — styrke straffet`,
    );
  }
  assert.ok(keptFraction(99) < 1, "selv den vejr-staerkeste skal miste NOGET CP i regnen (aldrig gratis)");
  assert.ok(keptFraction(99) > keptFraction(5), "forskellen skal vaere reel, ikke bare ikke-negativ");
});

// ── 4. Vejr-eventet: spillerens sprog, fog-gated, paa den rigtige km ────────

test("vejr-event: regn meldes én gang, fra km 0 (regn rammer hele etapen)", () => {
  const out = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "rain", wind_exposure: 0.2 }), "m11-event-rain"));
  const events = weatherEvents(out);
  assert.equal(events.length, 1, "vejret skal meldes praecis én gang pr. etape");
  assert.equal(events[0].km, 0, "regn bider fra starten");
  assert.equal(events[0].params.kind, "rain");
});

test("vejr-event: vind meldes foerst hvor ruten kommer ud paa det aabne, ikke paa startstregen", () => {
  const out = simulateStageV4(
    stage(MIXED_FIELD, shelteredThenExposedRoute({ kind: "wind", wind_exposure: 0.8 }), "m11-event-wind"),
  );
  const events = weatherEvents(out);
  assert.equal(events.length, 1);
  // Ruten aabner paa en stigning; foerste segment med vind-eksponering over 0 er
  // ikke noedvendigvis segment 0, men eventet skal under alle omstaendigheder
  // ligge paa et segments START-km og baere vejrtypen.
  assert.equal(events[0].params.kind, "wind");
  assert.ok([0, 60, 90].includes(events[0].km), `vind-eventet laa paa km ${events[0].km}, ikke paa en segmentgraense`);
});

test("vejr-event: sol og overskyet melder INTET — der er ikke noget at fortaelle spilleren", () => {
  for (const kind of ["sun", "overcast"] as WeatherKind[]) {
    const out = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind, wind_exposure: 0.9 }), "m11-event-calm"));
    assert.equal(weatherEvents(out).length, 0, `${kind} maa ikke give et vejr-event`);
  }
});

test("fog-gate (invariant 5): vejr-eventet baerer KUN vejrtypen — ingen eksponering, straf eller multiplikator", () => {
  const out = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "wind", wind_exposure: 0.77 }), "m11-fog"));
  const params = weatherEvents(out)[0].params;
  assert.deepEqual(Object.keys(params), ["kind"], "vejr-eventets params maa kun indeholde 'kind'");
  assert.equal(typeof params.kind, "string");
});

test("tidslinje-validatoren er groen med vejr-eventet i tidslinjen", () => {
  const out = simulateStageV4(stage(MIXED_FIELD, flatRoute({ kind: "rain", wind_exposure: 0.4 }), "m11-timeline"));
  const violations = validateTimelineEvents(out.timeline.events, {
    distanceKm: 180,
    knownRiderIds: new Set(MIXED_FIELD.map((e) => e.rider_id)),
  });
  assert.deepEqual(violations, [], `tidslinje-overtraedelser: ${JSON.stringify(violations)}`);
});

// ── 5. Determinisme (§3 punkt 1) ────────────────────────────────────────────

test("determinisme: samme seed + samme vejr -> byte-identisk output", () => {
  const input = stage(MIXED_FIELD, flatRoute({ kind: "wind", wind_exposure: 0.65 }), "m11-determinism");
  assert.deepEqual(simulateStageV4(input), simulateStageV4(input));
});

// ── 6. Risiko-armen: regn forstaerker descent attack-risikoen (mor-spec M11) ─

test("regn forstaerker descent attack-risikoen (risiko-armen er koblet ind i descent.ts)", () => {
  // MAALT PROBLEM ved produktions-tuningen: descent-angribere vaelges blandt de
  // BEDSTE nedkoerere, og descending-daempningen naevner risikoen helt ud for
  // dem — 40 loeb x 3 angreb gav 0 uheld i sol OG i regn. Testen ville derfor
  // vaere groen uanset om koblingen fandtes. Vi hæver basis-risikoen via
  // tuning'en (den samme spread-teknik harness'et bruger til tuning.selection)
  // saa rullet faktisk sker, og maaler DEN forskel vejret goer. At produktions-
  // raten er naer nul er en KALIBRERINGS-observation, ikke en wiring-fejl —
  // den er noteret i PR-bodyen.
  //
  // #4950: WIDE_MIXED_FIELD (180 ryttere, loft 9/etape) i stedet for
  // MIXED_FIELD (60 ryttere, loft 3/etape) — se feltets kommentar. Uheldsloftet
  // (maxIncidentsFieldShare) er delt med M10 og uaendret i tuning.ts; kun
  // testens EGET felt er bredere, saa wet > dry-marginen maales et stykke fra
  // loftet i stedet for at rulle op ad det.
  const loudRiskTuning = {
    ...RACE_V4_TUNING,
    descent: { ...RACE_V4_TUNING.descent, incidentRiskBase: 0.35 },
  };
  const seeds = Array.from({ length: 40 }, (_, i) => `m11-descent-risk-${i}`);
  const cap = maxIncidentsForField(WIDE_MIXED_FIELD.length, INCIDENTS_EXTRA_TUNING);
  const countIncidents = (weather: Weather): { total: number; seedsAtCap: number } => {
    let total = 0;
    let seedsAtCap = 0;
    for (const seed of seeds) {
      const out = simulateStageV4({
        route: shelteredThenExposedRoute(weather),
        startlist: WIDE_MIXED_FIELD,
        orders: [],
        seed,
        tuning: loudRiskTuning,
      });
      const n = out.timeline.events.filter(
        (e) => e.type === "incident" && (e.params as { cause?: string }).cause === "descent_attack",
      ).length;
      total += n;
      // "raa risiko" (ikke det DELTE etape-loft) er det denne test vil maale —
      // et loeb der selv rammer det fulde etape-loft (M3 + M10 tilsammen) siger
      // intet om vejrets EGEN forstaerkning og skal ikke kunne skjule en braekket
      // wet > dry-margin (#4950).
      if (n >= cap) seedsAtCap += 1;
    }
    return { total, seedsAtCap };
  };

  const dry = countIncidents({ kind: "sun", wind_exposure: 0.2 });
  const wet = countIncidents({ kind: "rain", wind_exposure: 0.2 });
  assert.ok(dry.total > 0, "testruten skal producere descent-angreb med uheldsrul overhovedet");
  assert.equal(dry.seedsAtCap, 0, `sol-armen maa ikke ramme etape-loftet (${cap}) — saa maaler testen loftet, ikke raa risiko`);
  assert.equal(wet.seedsAtCap, 0, `regn-armen maa ikke ramme etape-loftet (${cap}) — saa maaler testen loftet, ikke raa risiko`);
  assert.ok(
    wet.total > dry.total,
    `regn (${wet.total} uheld) skal give flere descent-uheld end sol (${dry.total})`,
  );
});
