// backend/lib/engine/v4/mechanics/dayForm6649.ts
// #6649 (KUN s5_profiles_v3, slukket): dagsform med en forklaring.
// Spec: docs/superpowers/specs/2026-10-26-6649-dagsform-design.md.
// Ejer 26/10: "den bedste vinder som i virkeligheden", dagsform pr. rytter og dag
// ud fra traethed, form, sygdom og vejr, aldrig ren tilfaeldighed, og altid
// forklaret bagefter i loebsloggen ("havde en daarlig dag" + hvorfor).
//
// Under s5_profiles_v3 ERSTATTER modulet den gamle dagsform (physiology.ts
// dayformComponent + jourSansComponent: ren seedet stoej). Formens og formtoppens
// faste led (formCpModifier/formPeakCpModifier) er uroerte. Resultatet ligger i
// RiderState.dayform, som segment-loopet, klatreselektionen, finalen og
// enkeltstarten allerede laeser, saa dagsformen virker hele etapen.
//
// Tre dele pr. rytter og dag (alle seedet pr. (etape-seed, rider_id), egen stream):
//   1. Dagens ben: et signeret udsving. Op-siden er den samme for alle; ned-siden
//      vokser med lav form, traethed og vejr. Spredningen kommer altsaa fra
//      rytterens tilstand, ikke kun fra en terning.
//   2. Den daarlige dag: en sjaelden, stor nedtur. Risikoen er summen af tre
//      kilder (form, traethed, vejr); den kilde hvis andel lodtraekningen ramte,
//      er aarsagen. Saa er hver daarlig dag forklaret af den ting der udloeste den.
//   3. Sygdom: sjaeldnere og stoerre end en daarlig dag; risikoen stiger med
//      ekstrem traethed (samme retning som conditionIllness.js uden for motoren).
//
// Fog-gate (#1791): eventet `bad_day` baerer kun rytter, aarsag og evt. vejrtype,
// aldrig tal, sandsynligheder eller komponenter.
//
// REN: ingen IO/Date/Math.random, intet input muteres. Tallene er startgaet og
// kalibreres mod det private baand (v3Gates.bestRiderWinShare, hard rule 17)
// med backend/scripts/dev/dayForm6649.mjs. De bor her, ikke i tuning.ts.

import type { Entrant, EngineTuning, RiderState, RouteV2, TimelineEvent } from "../types.ts";
import { deriveCp, formCpModifier, formPeakCpModifier, FORM_CP_TUNING } from "../physiology.ts";
import { gaussian, rngFor } from "../rng.ts";
import { makeEvent } from "../timeline.ts";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type BadDayReason = "form" | "fatigue" | "illness" | "weather";
export type BadDayWeather = "rain" | "wind" | "heat";

export const DAY_FORM_6649_TUNING = Object.freeze({
  // 1. Dagens ben (normaliseret CP).
  // En daarlig dag er hyppigere og stoerre end en super-dag: ned-siden er bredere
  // end op-siden. Ellers vinder udbryderne paa deres gode dage, ikke favoritterne
  // paa deres daarlige (maalt, balance-internals/6649). Udsvinget centreres, saa
  // en neutral rytter i gennemsnit hverken vinder eller taber.
  legsUpSd: 0.012, // op-sidens spredning
  legsSd: 0.034, // ned-sidens grund-spredning (kalibreret, balance-internals/6649)
  // Massespurten: dagsformen er udholdenhed og vejer mindre i en spurt end paa en
  // stigning eller i en enkeltstart. Finalens score laeser dagsformen ganget med denne.
  massFinishFinaleScale: 0.56,
  downFormMax: 0.6, // ned-siden vokser med lav form (fuldt ved formskalaens bund)
  downFatigueMax: 2.0, // ... med traethed (fuldt ved condition 0)
  downWeatherMax: 0.5, // ... og med haardt vejr for en rytter uden vejr-teknik
  fatigueFree: 0.25, // traethed (1 - condition) under denne taeller ikke
  // 2. Den daarlige dag.
  badDayFormP: 0.03, // risiko ved neutral form (samme anker som den gamle jour sans)
  badDayFormMultLow: 5 / 3, // ... ganget op ved lav form (form <= formLow)
  badDayFormMultHigh: 2 / 3, // ... og ned ved hoej form (form >= formHigh)
  formLow: 40,
  formHigh: 70,
  badDayFatigueP: 0.1, // ekstra risiko ved fuld traethed (lineaert fra fatigueFree)
  badDayWeatherP: 0.03, // ekstra risiko i det haardeste vejr uden vejr-teknik
  badDayMin: 0.05, // nedturens stoerrelse (normaliseret CP), uniform i [min, max]
  badDayMax: 0.1,
  // 3. Sygdom.
  illnessP: 0.002, // grund-risiko
  illnessFatigueP: 0.02, // ekstra ved fuld traethed (kvadratisk: kun den ekstreme traethed)
  illnessMin: 0.1,
  illnessMax: 0.16,
  // Vejr: regn og vind rammer efter rytterens vejr-teknik; hede = sol paa en lang, kuperet dag.
  rainStress: 1,
  windStress: 0.8, // ganget med rutens vind-eksponering
  heatStress: 0.5,
  heatMinKm: 150,
  heatMinClimbShare: 0.25,
  // Loebsloggen: hvem der naevnes. Kun dagens reelle kandidater, og kun en tydelig nedtur.
  eventCandidates: 10,
  eventThreshold: 0.06,
});

export type DayForm6649Tuning = typeof DAY_FORM_6649_TUNING;

export type DayForm6649 = {
  /** Signeret CP-led der erstatter den gamle dagsform+jour sans. */
  delta: number;
  /** Aarsag naar dagen var en tydelig nedtur, ellers null. */
  reason: BadDayReason | null;
  weather: BadDayWeather | null;
};

function fatigueOf(entrant: Pick<Entrant, "condition">): number {
  const c = Number(entrant.condition);
  return Number.isFinite(c) ? clamp(1 - c, 0, 1) : 0;
}

/** Risikoens form: samme sammensaetning som den samlede form i groups.ts (form + top, 0-100). */
function riskFormOf(entrant: Pick<Entrant, "form" | "form_peak_points">): number | null {
  const form = Number.isFinite(entrant.form) ? (entrant.form as number) : null;
  const peak = Number.isFinite(entrant.form_peak_points) && entrant.form_peak_points !== 0 ? (entrant.form_peak_points as number) : null;
  if (peak === null) return form;
  return clamp((form ?? FORM_CP_TUNING.neutralForm) + peak, 0, 100);
}

/** Formunderskud 0-1 (0 = neutral eller bedre, 1 = formskalaens bund). Ukendt form = 0. */
function formDeficit(form: number | null): number {
  if (form === null) return 0;
  const neutral = FORM_CP_TUNING.neutralForm;
  return clamp((neutral - form) / neutral, 0, 1);
}

function formMult(form: number | null, t: DayForm6649Tuning): number {
  if (form === null) return 1;
  const frac = (clamp(form, t.formLow, t.formHigh) - t.formLow) / (t.formHigh - t.formLow);
  return t.badDayFormMultLow + frac * (t.badDayFormMultHigh - t.badDayFormMultLow);
}

/** Vejr-teknik 0-1 (proxy som mechanics/weather.ts: nedkoersel + holdbarhed). */
function weatherTechnique01(entrant: Pick<Entrant, "abilities">): number {
  const d = clamp(Number(entrant.abilities?.descending) || 0, 0, 99);
  const u = clamp(Number(entrant.abilities?.durability) || 0, 0, 99);
  return (0.5 * d + 0.5 * u) / 99;
}

function climbShare(route: Pick<RouteV2, "segments" | "distance_km">): number {
  const total = route.distance_km > 0 ? route.distance_km : 0;
  if (!total) return 0;
  const climb = (route.segments ?? []).filter((s) => s.kind === "climb").reduce((a, s) => a + Math.max(0, s.to_km - s.from_km), 0);
  return climb / total;
}

/** Dagens vejr som belastning (0-1 foer vejr-teknik) og den type loebsloggen naevner. */
export function weatherStress(route: Pick<RouteV2, "weather" | "segments" | "distance_km">, t: DayForm6649Tuning = DAY_FORM_6649_TUNING): { stress: number; kind: BadDayWeather | null } {
  const w = route.weather;
  if (w?.kind === "rain") return { stress: t.rainStress, kind: "rain" };
  if (w?.kind === "wind") return { stress: t.windStress * clamp(Number(w.wind_exposure) || 0, 0, 1), kind: "wind" };
  if (w?.kind === "sun" && route.distance_km >= t.heatMinKm && climbShare(route) >= t.heatMinClimbShare) return { stress: t.heatStress, kind: "heat" };
  return { stress: 0, kind: null };
}

/**
 * Én rytters dagsform. Deterministisk fra (seed, rider_id) og rytterens tilstand:
 * samme input giver altid samme dag, og en anden rytters tilmelding flytter ikke
 * hans udfald (per-rytter-stream, §2 invariant 1).
 */
export function dayForm6649For(
  entrant: Pick<Entrant, "rider_id" | "abilities" | "condition" | "form" | "form_peak_points">,
  route: Pick<RouteV2, "weather" | "segments" | "distance_km">,
  seed: string,
  t: DayForm6649Tuning = DAY_FORM_6649_TUNING,
): DayForm6649 {
  const fatigue = fatigueOf(entrant);
  const fatigue01 = clamp((fatigue - t.fatigueFree) / (1 - t.fatigueFree), 0, 1);
  const form = riskFormOf(entrant);
  const weather = weatherStress(route, t);
  const weather01 = clamp(weather.stress * (1 - weatherTechnique01(entrant)), 0, 1);

  const rng = rngFor(seed, "dayform6649", entrant.rider_id);
  // 1. Dagens ben.
  const z = gaussian(rng, 0, 1);
  const down = { form: t.downFormMax * formDeficit(form), fatigue: t.downFatigueMax * fatigue01, weather: t.downWeatherMax * weather01 };
  // Centreret om en neutral rytters forventning (E[max(z,0)] = E[-min(z,0)] = 1/sqrt(2 pi)).
  const center = (t.legsUpSd - t.legsSd) / Math.sqrt(2 * Math.PI);
  const legs = (z >= 0 ? z * t.legsUpSd : z * t.legsSd * (1 + down.form + down.fatigue + down.weather)) - center;
  // 2 + 3. Sygdom og den daarlige dag deler én lodtraekning: [sygdom | form | traethed | vejr | ingenting].
  const pIllness = t.illnessP + t.illnessFatigueP * fatigue01 * fatigue01;
  const pForm = t.badDayFormP * formMult(form, t);
  const pFatigue = t.badDayFatigueP * fatigue01;
  const pWeather = t.badDayWeatherP * weather01;
  const u = rng();
  const size = rng();
  let hit: BadDayReason | null = null;
  let hitSize = 0;
  if (u < pIllness) {
    hit = "illness";
    hitSize = t.illnessMin + size * (t.illnessMax - t.illnessMin);
  } else if (u < pIllness + pForm + pFatigue + pWeather) {
    const v = u - pIllness;
    hit = v < pForm ? "form" : v < pForm + pFatigue ? "fatigue" : "weather";
    hitSize = t.badDayMin + size * (t.badDayMax - t.badDayMin);
  }
  const delta = legs - hitSize;
  let reason: BadDayReason | null = hit;
  if (!reason && delta <= -t.eventThreshold) {
    // En tydelig nedtur uden lodtraekning: aarsagen er den kilde der gjorde ned-siden stoerst.
    reason = down.fatigue >= down.form && down.fatigue >= down.weather && down.fatigue > 0 ? "fatigue"
      : down.weather > down.form && down.weather > 0 ? "weather" : "form";
  }
  if (reason && delta > -t.eventThreshold) reason = null;
  return { delta, reason, weather: reason === "weather" ? weather.kind : null };
}

/**
 * Krog i finale.ts: hvor meget af dagsformen finalens placerings-score laeser.
 * 1 udenfor en massespurt og under alle aeldre revisioner (x * 1 er eksakt: bit-identisk).
 */
export function dayForm6649FinaleScale(massFinishUnderV3: boolean, t: DayForm6649Tuning = DAY_FORM_6649_TUNING): number {
  return massFinishUnderV3 ? t.massFinishFinaleScale : 1;
}

/** Den nye RiderState.dayform: dagsformen + formens og formtoppens faste led (som groups.ts). */
export function dayform6649Value(entrant: Pick<Entrant, "form" | "form_peak_points">, day: DayForm6649): number {
  const form = Number.isFinite(entrant.form) ? (entrant.form as number) : null;
  const peak = Number.isFinite(entrant.form_peak_points) && entrant.form_peak_points !== 0 ? (entrant.form_peak_points as number) : null;
  return day.delta + (form === null ? 0 : formCpModifier(form)) + (peak === null ? 0 : formPeakCpModifier(peak));
}

/**
 * Kroge fra segment-loopet og enkeltstarten: erstat dagsformen i start-tilstanden.
 * `on` false = SAMME objekt (aeldre revisioner er bit-identiske).
 */
export function applyDayForm6649<T extends Pick<RiderState, "dayform">>(
  riders: Record<string, T>,
  startlist: readonly Entrant[],
  route: Pick<RouteV2, "weather" | "segments" | "distance_km">,
  seed: string,
  on: boolean,
): Record<string, T> {
  if (!on) return riders;
  const out: Record<string, T> = { ...riders };
  for (const entrant of startlist) {
    const rider = out[entrant.rider_id];
    if (!rider) continue;
    out[entrant.rider_id] = { ...rider, dayform: dayform6649Value(entrant, dayForm6649For(entrant, route, seed)) };
  }
  return out;
}

/** Rytterens evne paa dagens rute (CP vaegtet med segmenternes laengde), til at finde kandidaterne. */
export function routeCapacity(entrant: Pick<Entrant, "abilities">, route: Pick<RouteV2, "segments">, tuning: EngineTuning): number {
  let sum = 0;
  let km = 0;
  for (const s of route.segments ?? []) {
    const len = Math.max(0, s.to_km - s.from_km);
    sum += len * deriveCp(entrant.abilities, s.kind, tuning.physiology.cpWeights);
    km += len;
  }
  return km > 0 ? sum / km : 0;
}

/**
 * Loebsloggens `bad_day`-events, ved maal (bagefter, ikke undervejs): dagens
 * kandidater (de bedste paa ruten) der havde en tydelig nedtur, med aarsagen.
 */
export function dayForm6649Events(
  startlist: readonly Entrant[],
  route: Pick<RouteV2, "weather" | "segments" | "distance_km">,
  seed: string,
  tuning: EngineTuning,
  t: DayForm6649Tuning = DAY_FORM_6649_TUNING,
): TimelineEvent[] {
  const candidates = startlist
    .map((e) => ({ e, v: routeCapacity(e, route, tuning) }))
    .sort((a, b) => b.v - a.v || a.e.rider_id.localeCompare(b.e.rider_id))
    .slice(0, Math.max(0, t.eventCandidates));
  const events: TimelineEvent[] = [];
  for (const { e } of candidates) {
    const day = dayForm6649For(e, route, seed, t);
    if (!day.reason) continue;
    events.push(makeEvent(route.distance_km, "bad_day", { rider_id: e.rider_id, reason: day.reason, ...(day.weather ? { weather: day.weather } : {}) }));
  }
  return events;
}
