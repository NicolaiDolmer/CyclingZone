// backend/lib/engine/v4/mechanics/breakawayCurve6912.ts
// #6912 (ADDITIVT og VALGFRIT, KUN s5_profiles_v3 + StageInput.breakaway_curve_6912, SLUKKET):
// forspringskurven for dagens udbrud.
//
// Undersoegelsen 3/11 (privat: balance-internals/6912/) viste at kurven er fejlen, ikke
// kun loftet: forspringet vokser lineaert op til loftet, ligger dér uden styring, og
// bagefter er det mest stigningerne der aeder det, uden at nogen jager. Paa flad fanges
// udbruddet midt paa etapen. Kontakten aendrer selve forloebet:
//
//   1. Vaekst: i stedet for lineaert op til loftet flader vaeksten ud mod det feltet
//      tolererer (toppen, en andel af loftet). Toppen naas tidligt, uden en haard kant.
//   2. Styring efter toppen: de interesserede hold sigter mod et forspring der falder
//      gradvist mod finalen. Maalet afhaenger af de resterende km og af det udbruddet
//      forventes at tabe paa finalestigningen (kun den; mellemstigningerne er terraen).
//   3. Jagende hold lukker selv: under styringen loeftes daempningen foer finalen
//      (mountainSelection.ts), og har de interesserede hold ryttere at jage med, lukker
//      de ned til maalet, ogsaa paa stigninger. De betaler arbejdet oven i deres jagt.
//   4. Kun flad/rullende-klassen (upperBoundProfiles): foer finalen henter den automatiske
//      jagt ikke under maalet (fangsten flyttes til finalen, hvor jagt-gulvet tager over).
//      Paa bjerg er der ingen overgraense: holdene lukker selv. En klassementsreaktion og
//      finalen er uden overgraense, og et holds jag-ordre virker altid (ordrens egen
//      lukning laegges oven paa graensen).
//
// Loftet (lad-gaa-loftet og P2's tolerance) er uaendret og staar som noedgraense.
// Kun profilerne i BREAKAWAY_CURVE_6912_TUNING.profileTypes. Rullende og kuperet er uroert.
//
// REN: ingen IO, ingen rng, ingen Date. Kontakten slukket = intet herfra kaldes, og alle
// revisioner er bit-identiske.

import type { ProfileType, RouteV2, StageInput } from "../types.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { BREAKAWAY_CURVE_6912_TUNING } from "../tuning.ts";
import { finalClimbStartIndex } from "./mountainSelection.ts";

type CurveTuning = typeof BREAKAWAY_CURVE_6912_TUNING;

/**
 * Ordre-parameteren broen saetter (kun med kontakten) paa et holds team_tactics-ordre,
 * naar manageren selv har gemt jag-stancen for etapen. En spillers jag-ordre virker altid;
 * kurven begraenser kun den automatiske jagt.
 */
export const MANAGER_CHASE_6912_PARAM = "manager_chase_6912";

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Kontakten: KUN s5_profiles_v3 (og senere) og kun naar kalderen eksplicit har sat
 * `breakaway_curve_6912`. Haandbyggede fixtures og alle aeldre revisioner: nej.
 */
export function breakawayCurve6912On(input: Pick<StageInput, "rules_revision" | "breakaway_curve_6912">): boolean {
  return input.breakaway_curve_6912 === true && isS5ProfilesV3OrLater(input.rules_revision);
}

/** Kurven gaelder paa denne profil (kontakten er allerede taendt). */
export function breakawayCurve6912Applies(on: boolean | undefined, profileType: ProfileType, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): boolean {
  return on === true && t.profileTypes.includes(profileType);
}

/** Toppen: den andel af loftet feltet tolererer paa profilen. Aldrig over loftet, aldrig under hovedstarten. */
export function curvePeakSeconds(input: { ceilingSeconds: number; profileType: ProfileType; initialGapSeconds: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const ceiling = Math.max(0, input.ceilingSeconds);
  const share = clamp(t.peakShareOfCeilingByProfile[input.profileType] ?? 1, 0, 1);
  return Math.min(ceiling, Math.max(input.initialGapSeconds, ceiling * share));
}

/** Kurvens laengdeskala (km): toppen divideret med vaeksten, ganget med knaet. */
function curveScaleKm(peakSeconds: number, secondsPerKm: number, t: CurveTuning): number {
  return secondsPerKm > 0 && peakSeconds > 0 ? (t.growthKnee * peakSeconds) / secondsPerKm : 0;
}

/**
 * Km hvor kurven naar toppen (topShare af toppen, pr. profil hvis den er sat) fra
 * hovedstarten ved dannelsen. STATELESS som letGoSplitKm: afledt af distancen alene.
 * Dannelses-km uden vaekst.
 */
export function curveTopKm(input: { formationKm: number; peakSeconds: number; secondsPerKm: number; initialGapSeconds: number; profileType?: ProfileType }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const scale = curveScaleKm(input.peakSeconds, input.secondsPerKm, t);
  const room = input.peakSeconds - input.initialGapSeconds;
  const topShare = (input.profileType !== undefined ? t.topShareByProfile[input.profileType] : undefined) ?? t.topShare;
  const rest = (1 - clamp(topShare, 0, 0.999)) * input.peakSeconds;
  if (!(scale > 0) || !(room > rest)) return input.formationKm;
  return input.formationKm + scale * Math.log(room / rest);
}

/** Som letGoSplitKm, men lad-gaa-fasen slutter ved kurvens top. */
export function curveLetGoSplitKm(input: { formationKm: number; peakSeconds: number; fromKm: number; toKm: number; secondsPerKm: number; initialGapSeconds: number; profileType?: ProfileType }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): { letGoKm: number; chaseKm: number } {
  const start = Math.max(input.fromKm, input.formationKm);
  const span = Math.max(0, input.toKm - start);
  const letGoKm = clamp(curveTopKm(input, t) - start, 0, span);
  return { letGoKm, chaseKm: span - letGoKm };
}

/**
 * Vaeksten paa `km` lad-gaa-km fra forspringet `separationSeconds`: hullet naermer sig
 * toppen og flader ud (samme haeldning ved hovedstarten som knaet giver, aldrig over
 * toppen). Et hul over toppen vokser ikke, og krympes aldrig af vaeksten selv.
 */
export function curveGrowthSeconds(input: { separationSeconds: number; peakSeconds: number; secondsPerKm: number; km: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const room = input.peakSeconds - Math.max(0, input.separationSeconds);
  const scale = curveScaleKm(input.peakSeconds, input.secondsPerKm, t);
  if (!(room > 0) || !(input.km > 0) || !(scale > 0)) return 0;
  return room * (1 - Math.exp(-input.km / scale));
}

/**
 * Det udbruddet forventes at tabe paa finalestigningen fra `fromKm` til maal: stignings-km
 * (den del af finalestigningens segmenter der ligger efter `fromKm`) gange gennemsnits-
 * stigningen. Mellemstigningerne taeller ikke: de er terraen, ikke noget holdene doserer
 * forspringet efter (ellers ville maalet ligge paa toppen det meste af en bjergetape).
 */
export function remainingClimbLossSeconds(route: Pick<RouteV2, "segments">, fromKm: number, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const start = finalClimbStartIndex(route.segments);
  if (start < 0) return 0;
  let units = 0;
  for (const s of route.segments.slice(start)) {
    if (s.kind !== "climb") continue;
    const km = Math.max(0, s.to_km - Math.max(s.from_km, fromKm));
    units += km * Math.max(0, s.avg_gradient);
  }
  return units * t.climbLossSecondsPerGradientKm;
}

/**
 * Forspringet de interesserede hold sigter mod ved `km`: fra toppen falder det gradvist
 * mod finalens maal (resterende km), og det udbruddet forventes at tabe paa den resterende
 * finalestigning laegges oveni. Aldrig over toppen.
 */
export function curveTargetSeconds(input: { route: Pick<RouteV2, "distance_km" | "segments" | "profile_type">; km: number; topKm: number; peakSeconds: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const finish = Math.min(input.peakSeconds, Math.max(0, t.finishTargetSecondsByProfile[input.route.profile_type] ?? 0));
  // Maalet er naaet `catchKmBeforeFinish` foer stregen (flad: fangsten i finalen, ikke paa stregen).
  const end = Math.max(input.topKm, input.route.distance_km - Math.max(0, t.catchKmBeforeFinishByProfile[input.route.profile_type] ?? 0));
  const afterTop = end - input.topKm;
  const share = afterTop > 0 ? clamp((end - input.km) / afterTop, 0, 1) : 0;
  const decline = Math.pow(share, Math.max(0.05, t.declineShape));
  const climbs = remainingClimbLossSeconds(input.route, input.km, t);
  return Math.min(input.peakSeconds, finish + climbs + (input.peakSeconds - finish) * decline);
}

/** Har profilen styringens overgraense (flad/rullende-klassen)? Paa bjerg lukker holdene selv. */
export function curveUpperBoundApplies(profileType: ProfileType, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): boolean {
  return t.upperBoundProfiles.includes(profileType);
}

/** Skalaen daempningen af jagten foer finalestigningen loeftes til under styringen; null = ikke paa profilen. */
export function curvePreFinalLift(profileType: ProfileType, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number | null {
  return t.liftedPreFinalChaseClosingScaleByProfile[profileType] ?? null;
}

/**
 * Segmentets lukning under styringen. `existing` er jagtens lukning uden styringen.
 *   - Nedre graense: har de interesserede hold ryttere at jage med, lukker de ned mod
 *     maalet (hoejst `capSeconds` paa segmentet), ogsaa paa en stigning.
 *   - Oevre graense (kun `upperBounded`): den automatiske jagt henter ikke under maalet.
 *     `orderSeconds` er den del af `existing` som hold med jag-ordre selv lukker; den
 *     laegges oven paa graensen, saa en jag-ordre altid kan lukke hurtigere end kurven.
 * `extra` = den del de jagende hold selv bar ud over `existing` (de betaler arbejdet).
 */
export function curveControlledClosing(input: { existingSeconds: number; grownSeconds: number; targetSeconds: number; capSeconds: number; hasChasers: boolean; upperBounded: boolean; orderSeconds?: number }): { closing: number; extra: number } {
  const existing = Math.max(0, input.existingSeconds);
  const needed = Math.max(0, input.grownSeconds - Math.max(0, input.targetSeconds));
  const lower = input.hasChasers ? Math.min(needed, Math.max(0, input.capSeconds)) : 0;
  const upper = input.upperBounded ? needed + Math.max(0, input.orderSeconds ?? 0) : Infinity;
  const closing = Math.min(upper, Math.max(lower, existing));
  return { closing, extra: Math.max(0, closing - existing) };
}

/**
 * Jagt-gulvets vindue: de jagende hold lukker selv ned mod maalet, oven i gulvet og hoejst
 * `capSeconds`. 0 uden ryttere at jage med, uden vindue, eller naar gulvet alene naar maalet.
 */
export function curveFloorExtraSeconds(input: { beforeFloorSeconds: number; floorClosingSeconds: number; targetSeconds: number; floorKm: number; hasChasers: boolean }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  if (!input.hasChasers || !(input.floorKm > 0)) return 0;
  return Math.min(curveClosingCapSeconds(input.floorKm, t), Math.max(0, input.beforeFloorSeconds - input.floorClosingSeconds - input.targetSeconds));
}

/**
 * Vaeksten paa kurven i endagsloebets skala: endagsloftet skalerer baade toppen og
 * vaeksten (`oneDayScale`), og resultatet regnes tilbage til etapeskalaen, som kalderen
 * ganger med igen. `oneDayScale` = 1 er etapeloebet.
 */
export function curveScaledGrowthSeconds(input: { separationSeconds: number; peakSeconds: number; secondsPerKm: number; km: number; oneDayScale: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  if (!(input.oneDayScale > 0)) return 0;
  return curveGrowthSeconds({ separationSeconds: input.separationSeconds, peakSeconds: input.peakSeconds * input.oneDayScale, secondsPerKm: input.secondsPerKm * input.oneDayScale, km: input.km }, t) / input.oneDayScale;
}

/**
 * Hvornaar kurven gaelder for et udbrud: dagens udbrud (ikke et nedkoerselsangreb), ikke
 * farligt (GC-bremsen og snoren ejer et farligt udbrud), profilen er med, og mindst et
 * hold har jagt-interesse.
 */
export function curveAppliesToBreak(input: { origin: string | undefined; dangerous: boolean; profileApplies: boolean; interestedTeams: number }): boolean {
  return input.origin === "breakaway" && !input.dangerous && input.profileApplies && input.interestedTeams > 0;
}

/** Styringen er aktiv: kurven har en top, og det er ikke klassementskontrollen (P6) med reaktioner. */
export function curveControlActive(input: { peakSeconds: number; p6Control: boolean; reacting: boolean }): boolean {
  return input.peakSeconds > 0 && !(input.p6Control && input.reacting);
}

/**
 * De jagende holds arbejde for en lukning med intensiteten `intensity` paa `km` km, pr.
 * rytter skaleret med indsatsen (`workOf`) og med andelen `km / bookedKm` (prisen betales
 * over planens bogfoerte km).
 */
export function curveChaseWork(input: { chasers: ReadonlyMap<string, readonly string[]>; workOf: (riderId: string) => number; intensity: number; km: number; bookedKm: number }): Map<string, number> {
  const share = input.bookedKm > input.km && input.bookedKm > 0 ? input.km / input.bookedKm : 1;
  const out = new Map<string, number>();
  for (const ids of input.chasers.values()) for (const id of ids) out.set(id, input.workOf(id) * input.intensity * share);
  return out;
}

/**
 * Kurvens arbejde laegges OVEN I planens arbejde (sum, ikke max): det er lukning ud over
 * den jagt planen allerede betaler for, og to bidrag i samme segment (jagt-km og gulvets
 * vindue) betales begge.
 */
export function addWork(base: ReadonlyMap<string, number>, extra: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of [...new Set([...base.keys(), ...extra.keys()])].sort((x, y) => x.localeCompare(y))) {
    out.set(id, (base.get(id) ?? 0) + (extra.get(id) ?? 0));
  }
  return out;
}

/** Hoejeste lukning de jagende hold kan baere paa `km` styrings-km. */
export function curveClosingCapSeconds(km: number, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  return Math.max(0, km) * t.maxControlClosingSecondsPerKm;
}
