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
//      forventes at tabe paa de resterende stigninger.
//   3. Jagende hold lukker selv: under styringen loeftes daempningen foer finalen
//      (mountainSelection.ts), og har de interesserede hold ryttere at jage med, lukker
//      de ned til maalet, ogsaa paa stigninger. De betaler arbejdet.
//   4. Foer finalen henter feltet ikke under maalet (flad: fangsten flyttes til finalen,
//      hvor jagt-gulvet tager over). En klassementsreaktion og finalen er uden overgraense.
//
// Loftet (lad-gaa-loftet og P2's tolerance) er uaendret og staar som noedgraense.
// Kun profilerne i BREAKAWAY_CURVE_6912_TUNING.profileTypes. Rullende og kuperet er uroert.
//
// REN: ingen IO, ingen rng, ingen Date. Kontakten slukket = intet herfra kaldes, og alle
// revisioner er bit-identiske.

import type { ProfileType, RouteV2, StageInput } from "../types.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import { BREAKAWAY_CURVE_6912_TUNING } from "../tuning.ts";

type CurveTuning = typeof BREAKAWAY_CURVE_6912_TUNING;

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
 * Km hvor kurven naar toppen (topShare af toppen) fra hovedstarten ved dannelsen.
 * STATELESS som letGoSplitKm: afledt af distancen alene. Dannelses-km uden vaekst.
 */
export function curveTopKm(input: { formationKm: number; peakSeconds: number; secondsPerKm: number; initialGapSeconds: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const scale = curveScaleKm(input.peakSeconds, input.secondsPerKm, t);
  const room = input.peakSeconds - input.initialGapSeconds;
  const rest = (1 - clamp(t.topShare, 0, 0.999)) * input.peakSeconds;
  if (!(scale > 0) || !(room > rest)) return input.formationKm;
  return input.formationKm + scale * Math.log(room / rest);
}

/** Som letGoSplitKm, men lad-gaa-fasen slutter ved kurvens top. */
export function curveLetGoSplitKm(input: { formationKm: number; peakSeconds: number; fromKm: number; toKm: number; secondsPerKm: number; initialGapSeconds: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): { letGoKm: number; chaseKm: number } {
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
 * Det udbruddet forventes at tabe paa stigningerne fra `fromKm` til maal: stignings-km
 * (den del af hver stigning der ligger efter `fromKm`) gange gennemsnitsstigningen.
 */
export function remainingClimbLossSeconds(route: Pick<RouteV2, "segments">, fromKm: number, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  let units = 0;
  for (const s of route.segments) {
    if (s.kind !== "climb") continue;
    const km = Math.max(0, s.to_km - Math.max(s.from_km, fromKm));
    units += km * Math.max(0, s.avg_gradient);
  }
  return units * t.climbLossSecondsPerGradientKm;
}

/**
 * Forspringet de interesserede hold sigter mod ved `km`: fra toppen falder det gradvist
 * mod finalens maal (resterende km), og det udbruddet forventes at tabe paa de resterende
 * stigninger laegges oveni. Aldrig over toppen.
 */
export function curveTargetSeconds(input: { route: Pick<RouteV2, "distance_km" | "segments" | "profile_type">; km: number; topKm: number; peakSeconds: number }, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  const distance = input.route.distance_km;
  const finish = Math.min(input.peakSeconds, Math.max(0, t.finishTargetSecondsByProfile[input.route.profile_type] ?? 0));
  const afterTop = distance - input.topKm;
  const share = afterTop > 0 ? clamp((distance - input.km) / afterTop, 0, 1) : 0;
  const decline = Math.pow(share, Math.max(0.05, t.declineShape));
  const climbs = remainingClimbLossSeconds(input.route, input.km, t);
  return Math.min(input.peakSeconds, finish + climbs + (input.peakSeconds - finish) * decline);
}

/**
 * Segmentets lukning under styringen. `existing` er jagtens lukning uden styringen.
 *   - Nedre graense: har de interesserede hold ryttere at jage med, lukker de ned mod
 *     maalet (hoejst `capSeconds` paa segmentet), ogsaa paa en stigning.
 *   - Oevre graense: foer finalen og uden klassementsreaktion henter feltet ikke under maalet.
 * `extra` = den del de jagende hold selv bar ud over `existing` (de betaler arbejdet).
 */
export function curveControlledClosing(input: { existingSeconds: number; grownSeconds: number; targetSeconds: number; capSeconds: number; hasChasers: boolean; upperBounded: boolean }): { closing: number; extra: number } {
  const existing = Math.max(0, input.existingSeconds);
  const needed = Math.max(0, input.grownSeconds - Math.max(0, input.targetSeconds));
  const lower = input.hasChasers ? Math.min(needed, Math.max(0, input.capSeconds)) : 0;
  const upper = input.upperBounded ? needed : Infinity;
  const closing = Math.min(upper, Math.max(lower, existing));
  return { closing, extra: Math.max(0, closing - existing) };
}

/** Hoejeste lukning de jagende hold kan baere paa `km` styrings-km. */
export function curveClosingCapSeconds(km: number, t: CurveTuning = BREAKAWAY_CURVE_6912_TUNING): number {
  return Math.max(0, km) * t.maxControlClosingSecondsPerKm;
}
