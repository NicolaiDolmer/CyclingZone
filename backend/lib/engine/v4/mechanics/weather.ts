// backend/lib/engine/v4/mechanics/weather.ts
// Race Engine v4 F3 (#4030): M11 - vejr-laget.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M11 ("regn forstaerker T2-T3-/brosten-risiko og descent attack-risikoen,
// fundament for sidevind/vifter #2476") + §8 beslutning 13 ("vejr-teknik", ny
// stat, foedes skjult) + §3.1 (RouteV2.weather findes fra F1, buildWeather i
// routeSegments.js). Task-brief (F3-natboelge, spor M8+M11): "vejr-laget: regn
// forstaerker T2/T3- og brosten-risiko + descent attack-risiko. Ny stat
// 'vejr-teknik': KUN et hook-punkt/tuning-felt - INGEN DB-aendringer".
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random.
//
// SCOPE (bevidst afgraensning, task-brief): vejr er et RISIKO-MULTIPLIKATOR-LAG
// i F3 — det skaber IKKE selv splits/events. Sidevind-selektion (vifter) er
// eksplicit naevnt i mor-spec §3.2 som et FREMTIDIGT fundament ("sidevind/vejr"
// listet som separat splitaarsag ved siden af "brosten-kaos"), ikke denne fils
// scope. Dette modul leverer de RENE funktioner andre mekanikker (descent.ts,
// mechanics/cobbles.ts) ganger deres egen incidentRiskBase med.
//
// WIRING-BEHOV (orkestratoren, #4030 — denne worker maa IKKE roere descent.ts
// eller segmentLoop.ts, jf. hard-rule): descent.ts's `incidentProbability`
// tager i dag `tuning.descent` raat. For at faa regn til ogsaa at forstaerke
// T2/T3-/descent attack-risikoen (mor-spec M11) skal orkestratoren enten
// (a) patche `ctx.tuning.descent.incidentRiskBase` med
//     `weatherAdjustedRiskBase(RACE_V4_TUNING.descent.incidentRiskBase, route.weather, WEATHER_EXTRA_TUNING)`
//     FOER `descentHook` kaldes (fx i index.ts's LIVE_MECHANIC_HOOKS-opsaetning
//     ved at bygge en pr.-etape `tuning`-kopi med spread, ligesom harness'et
//     allerede overrider `tuning.selection` via spread), ELLER
// (b) tilfoeje et `weatherRiskMultiplier`-felt til `DescentTuning` (types.ts,
//     arkitekt-only) som `descent.ts`'s `incidentProbability` ganger ind.
// Denne fil eksponerer begge byggesten (`weatherRiskMultiplier`,
// `weatherAdjustedRiskBase`) saa orkestratoren kan vaelge frit.

import type { AbilityKey, Weather, WeatherKind } from "../types.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type WeatherRiskTuning = {
  rainIncidentRiskMultiplier: number;
  windIncidentRiskMultiplier: number;
  sunOvercastIncidentRiskMultiplier: number;
  weatherTechniqueDampeningPerPoint: number;
  weatherTechniqueProxyWeights: { descending: number; durability: number };
};

const MULTIPLIER_KEY_BY_WEATHER_KIND: Record<
  WeatherKind,
  keyof Pick<WeatherRiskTuning, "rainIncidentRiskMultiplier" | "windIncidentRiskMultiplier" | "sunOvercastIncidentRiskMultiplier">
> = {
  rain: "rainIncidentRiskMultiplier",
  wind: "windIncidentRiskMultiplier",
  sun: "sunOvercastIncidentRiskMultiplier",
  overcast: "sunOvercastIncidentRiskMultiplier",
};

/**
 * Raat vejr-risikomultiplikator (0-1-skala-uafhaengig, >= 1 altid) for en
 * given vejrtype. Vejr kan ALDRIG saenke risiko under baseline (1.0) — kun
 * vejr-teknik-daempningen (weatherTechniqueDampening nedenfor) kan traekke
 * den EFFEKTIVE risiko ned, aldrig raat under baseline-risikoen selv (som er
 * den forbrugende mekaniks eget incidentRiskBase-ansvar).
 */
export function weatherRiskMultiplier(weather: Pick<Weather, "kind">, tuning: WeatherRiskTuning): number {
  const key = MULTIPLIER_KEY_BY_WEATHER_KIND[weather.kind] ?? "sunOvercastIncidentRiskMultiplier";
  return Math.max(1, tuning[key]);
}

/**
 * Vejr-justeret risiko-BASIS: ganger en mekaniks egen `incidentRiskBase`
 * (fx tuning.descent.incidentRiskBase, COBBLES_EXTRA_TUNING.incidentRiskBase)
 * med vejr-multiplikatoren. Forbrugende mekanik laegger derefter sin egen
 * evne-daempning (descending/cobblestone) OVENPAA denne, saa daempningen
 * altid virker paa den FAKTISKE (vejr-forstaerkede) risiko — regn forstaerker
 * foerst, evne daemper derefter (mor-spec M11-raekkefoelgen).
 */
export function weatherAdjustedRiskBase(
  baseRiskProbability: number,
  weather: Pick<Weather, "kind">,
  tuning: WeatherRiskTuning,
): number {
  return clamp(baseRiskProbability * weatherRiskMultiplier(weather, tuning), 0, 1);
}

/**
 * Proxy for den endnu-ufoedte "vejr-teknik"-evne (0-99-skala, samme skala som
 * abilities.*): vaegtet gennemsnit af descending+durability (regn/kulde-
 * haandtering korrelerer med begge, ejer-valg 20/8 §4). Rent hook-punkt — F4
 * erstatter proxy'en med et rigtigt `abilities.weather_technique`-opslag naar
 * AbilityKey-unionen (types.ts, frosset, arkitekt-only) udvides. INGEN
 * Entrant/AbilityKey/DB-aendring i denne fil eller nogen anden F3-fil.
 */
export function weatherTechniqueProxy(
  abilities: Partial<Record<AbilityKey, number>>,
  weights: WeatherRiskTuning["weatherTechniqueProxyWeights"],
): number {
  const descending = clamp(Number(abilities.descending) || 0, 0, 99);
  const durability = clamp(Number(abilities.durability) || 0, 0, 99);
  return weights.descending * descending + weights.durability * durability;
}

/**
 * Daempning (subtraheres fra en risiko-sandsynlighed) fra vejr-teknik(-proxy).
 * Samme subtraktive moenster som descent.ts's `incidentRiskDescendingDampening`
 * — ALDRIG omvendt fortegn (clamp'et af den forbrugende mekaniks egen
 * `clamp(risk, 0, 1)`, samme moenster som descent.ts's `incidentProbability`).
 */
export function weatherTechniqueDampening(weatherTechnique: number, tuning: WeatherRiskTuning): number {
  return tuning.weatherTechniqueDampeningPerPoint * clamp(Number(weatherTechnique) || 0, 0, 99);
}
