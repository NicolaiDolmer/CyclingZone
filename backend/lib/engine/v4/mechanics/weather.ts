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
// SCOPE. Vejret har to arme, og BEGGE er koblet ind (#3855-wiring 6/9):
//   RISIKO  — `weatherAdjustedRiskBase` ganges paa den forbrugende mekaniks
//             egen `incidentRiskBase`. Forbrugere: mechanics/cobbles.ts
//             (brosten-/grus-passagen) og mechanics/descent.ts (descent
//             attack-risikoen). Det var modulets oprindelige hele indhold.
//   BELASTNING — `weatherCpMultiplier` ganges paa rytterens CP i
//             segmentLoop.ts's `riderCpForSegment`, samme sted og samme form
//             som M7's distance-slid. Uden den arm er vejret usynligt i et
//             resultat: det ville kun flytte uheldstal, aldrig hvem der er
//             med over toppen. Se belastnings-blokken laengere nede i denne
//             fil for HVORFOR den rammer CP og ikke kraftkravet — det er en
//             maalt konklusion, ikke et designvalg taget paa forhaand.
//
// Vejret skaber stadig IKKE selv splits eller grupper. Sidevind-selektion
// (vifter) er eksplicit naevnt i mor-spec §3.2 som et FREMTIDIGT fundament
// ("sidevind/vejr" listet som separat splitaarsag ved siden af "brosten-kaos")
// og er fortsat uden for denne fils scope (#2476). Belastnings-armen skaerper
// kun de selektioner der allerede findes (M2/M8/M4) ved at toemme W' hurtigere.
//
// INVARIANT 3 (styrke straffes aldrig) er baaret af KONSTRUKTIONEN, ikke af
// kalibrering: begge arme er monotont IKKE-STIGENDE i evne (hoejere
// vejr-teknik-proxy => aldrig hoejere risiko og aldrig hoejere kraftkrav), og
// begge er gulvet ved "ingen vejr" (multiplikator >= 1), saa vejret hverken
// kan give en svag rytter en fordel eller en staerk rytter en straf.

import type { AbilityKey, SegmentKind, Weather, WeatherKind } from "../types.ts";

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

// ── Belastnings-armen (#3855, M11-wiring 6/9) ────────────────────────────────
//
// HVORFOR VEJRET RAMMER CP OG IKKE KRAVET. Foerste udgave af denne arm gangede
// vejret paa rytterens KRAFTKRAV i segment-loopets fysiologi-tick. Maalt over
// 12 loeb pr. vejrtype flyttede det arbejdet 4-7 % — og INTET andet: samme
// antal grupper, samme splits, samme hale-spredning. Aarsagen er strukturel,
// ikke kalibrering: paa en flad tilkoersel ligger kravet allerede godt under
// CP, saa 5 % mere krav rykker ingen over CP-taersklen, og W' bliver fyldt op
// alligevel. climbSelection.ts's `energyDeficit01` ser derfor praecis samme
// felt naar bjerget kommer, uanset om det har regnet i 100 km.
//
// Vejret rammer i stedet CP'en — samme sted og samme form som M7's
// distance-slid (`applyDistanceFatigueToCp`), den mekanik der beviseligt
// virker. Det giver de to effekter vejret skal have:
//   1. HELE feltet koerer langsommere i daarligt vejr (kollektiv-CP'en falder,
//      og segment-farten er afledt af den). Det er den realisme et vejr-lag
//      er der for.
//   2. Dem der er DAARLIGE til vejret taber CP hurtigere end gruppens
//      kollektive CP falder, saa deres krav/CP-forhold forvaerres, W' toemmes,
//      og de ryger i selektionerne. Det er dér differentieringen bor — ikke i
//      et loft alle rammer lige haardt.

export type WeatherCpTuning = {
  rainCpPenalty: number;
  windCpPenaltyMax: number;
  windExposureByTerrain: Record<SegmentKind, number>;
  weatherTechniqueCpReliefFraction: number;
};

/**
 * Vejrets RAA CP-straf for et segment, foer evne-daempning: den andel af sin
 * baeredygtige troeskel en rytter UDEN vejr-teknik mister. Altid >= 0.
 *
 * To bidrag, og kun ét ad gangen (vejret har én `kind`):
 *   regn — rammer hele etapen uanset terraen (vaadt underlag, kulde,
 *          opbremsninger). Terraen-uafhaengig med vilje: en vaad stigning
 *          koster lige saa meget som en vaad flade.
 *   vind — rammer kun i det omfang etapen er EKSPONERET: `wind_exposure`
 *          (rutens eget felt fra routeSegments.buildWeather) gange terraenets
 *          eksponering. En stigning ligger i lae af sig selv; en flad, aaben
 *          straekning gør ikke.
 * sol/overskyet giver praecis 0 — de to vejrtyper er baseline i BEGGE arme
 * (samme valg som `sunOvercastIncidentRiskMultiplier: 1.0`), saa en etape i
 * sol er byte-identisk med en etape uden vejr-lag overhovedet.
 */
export function weatherCpPenalty(
  weather: Pick<Weather, "kind" | "wind_exposure">,
  segmentKind: SegmentKind,
  tuning: WeatherCpTuning,
): number {
  if (weather.kind === "rain") return Math.max(0, tuning.rainCpPenalty);
  if (weather.kind === "wind") {
    const exposure = clamp(Number(weather.wind_exposure) || 0, 0, 1);
    const terrain = clamp(Number(tuning.windExposureByTerrain[segmentKind]) || 0, 0, 1);
    return Math.max(0, tuning.windCpPenaltyMax * exposure * terrain);
  }
  return 0;
}

/**
 * Vejr-multiplikator paa én rytters CP for ét segment. ALTID i (0, 1]: vejret
 * kan saenke en rytters baeredygtige troeskel, aldrig haeve den — samme gulv
 * som `weatherRiskMultiplier`s loft, og af samme grund (ellers kunne en
 * tuning-fejl forvandle daarligt vejr til en gave).
 *
 * Vejr-teknikken giver LINDRING, ikke immunitet: ved fuld teknik (99) staar
 * `weatherTechniqueCpReliefFraction` tilbage som den andel af straffen der
 * fjernes — resten betaler alle. Det er §9 punkt 3's "aldrig gratis"-linje
 * anvendt paa vejret: "vejr-teknik" skal vaere maerkbar, ikke et frikort.
 *
 * Monotont IKKE-FALDENDE i `weatherTechnique` og loftet ved 1 => invariant 3
 * er uberoert per konstruktion, praecis som i M7: baseCp er stigende i evne,
 * multiplikatoren er ikke-faldende i evne, og produktet af to ikke-faldende
 * positive funktioner er ikke-faldende. To rytteres indbyrdes CP-orden kan
 * derfor ikke vendes af vejret — heller ikke ved en fejlkalibrering.
 */
export function weatherCpMultiplier(
  weather: Pick<Weather, "kind" | "wind_exposure">,
  segmentKind: SegmentKind,
  weatherTechnique: number,
  tuning: WeatherCpTuning,
): number {
  const penalty = weatherCpPenalty(weather, segmentKind, tuning);
  if (penalty <= 0) return 1;
  const relief = clamp(tuning.weatherTechniqueCpReliefFraction, 0, 1);
  const technique01 = clamp(Number(weatherTechnique) || 0, 0, 99) / 99;
  const effective = penalty * (1 - relief * technique01);
  return clamp(1 - effective, 0, 1);
}
