// XP-modellen (#6110): én fælles prisliste, og potentialet afgør XP pr. dag.
//
// Spec: docs/superpowers/specs/2026-11-06-6110-xp-udvikling-design.md (§4, §11 trin 1).
//
// ═══ STATUS ══════════════════════════════════════════════════════════════════
// Rent modul. Brugere: 10-sæsoners-kørslen (scripts/dev/tenSeasonSim6110.mjs) og,
// fra trin 2, træningsmotoren (dailyTraining.js), men kun når kontakten
// development_xp_model er tændt for tick-datoen (developmentXpFlag.ts). Kontakten
// er slukket, så intet i spillet ændrer sig af denne fil.
//
// ═══ HVAD MODELLEN ER ════════════════════════════════════════════════════════
//   1. PRISEN: næste point koster XP efter evnens værdi og intet andet. Den er ens
//      for alle ryttere, typer, aldre og evner, stiger stejlt mod toppen af skalaen
//      og er endelig helt op til 99. Der er ingen mur og ingen prisbund (ejervalg 16/11).
//      Ejervalg 19/11 (kandidat B): talfilen kan give prisen en højere "top" end
//      skalaens, så prisen flader ud helt i toppen. Stadig ens for alle (E13/E14).
//      G3a (spec 2026-11-20 §3): talfilen kan i stedet give prisen formen "hvert point
//      en fast procent dyrere end det forrige" (`price.growth`). Én form ad gangen.
//   2. XP PR. DAG: potentialet står fast gennem karrieren og afgør, hvor meget
//      rytteren tjener. Forskellen mellem ryttere ligger i XP, aldrig i prisen.
//   3. ALDER: XP efter alder står i talfilen (`ageShare`). Ejervalg 19/11: ens hele
//      karrieren med et lille sikkerhedsnet sent, ens for fysiske og mentale evner.
//      Alder giver aldrig ekstra fart.
//   4. FOKUS: en træning giver mest i sessionens evner og lidt i resten.
//   5. TYPE: rolleklassen er en andel af XP, ikke et loft. Den er anlæg og følger
//      ikke med, når rytteren trænes om.
//   6. BJÆLKEN: gemmes som en andel af næste point. Når et point købes, regnes
//      overskuddet om til den nye pris, så ingen XP går tabt eller opstår.
//   7. DATOEN: ingen grænse pr. evne pr. dato under XP (G3a, spec 2026-11-20 §3; afløser
//      R16 fra 16/11). Prisen og afstanden til P bremser; flere point på én dato er
//      sjældne af sig selv. Gemt fremgang udbetales på rytterens første XP-dato.
//   9. AFSTANDEN TIL P (G3a): XP ganges med en faktor, der er stor langt fra rytterens
//      potentiale P og går mod nul tæt på det (xpDistanceFactor). P er et blødt mål:
//      stagnationen opstår af sig selv. Uden P eller uden talfilens `distance` er
//      faktoren 1, og XP er som før.
//  10. TRÆTHED (G3a): over talfilens tærskel giver en dag lidt mindre XP
//      (xpFatigueFactor). Udeladt i talfilen = ingen effekt.
//   8. KROPPENS ALDRING (ejervalg 19/11): talfilen kan bære sæsonskiftets aldring
//      (`aging`). Den bruges af sæsonskiftet (xpAgingConfig i riderProgression.js),
//      kun når XP-kontakten er tændt (riderProgressionEngine.js). Udeladt = dagens
//      AGING_V2_CONFIG, bit-identisk. Prisens top og aldringen er én pakke (kandidat B):
//      talfilen har begge eller ingen af dem. #8531: aldringen kan også stå i procent-
//      form (riderWear6110.js), og begge former kan kalibrere løbsbremsen; uden de
//      felter er bremsen dagens.
//
// ═══ TAL ═════════════════════════════════════════════════════════════════════
// Alle tal er PRIVATE (hard rule 17, balance-internals/6110/) og gives som `params`.
// Der er bevidst ingen standardværdier: uden gyldige params findes modellen ikke.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random. Dagsvariationen med den
// hemmelige nøgle (spec §5.2) ligger i developmentXpVariation.ts; dens felter
// valideres her, og kalderen (applyDailyTick) ganger den på dagens XP.

import { TRAINING_CONFIG, TRAINING_FOCUSES, programAbilityWeight } from "./training.js";
import { dayTypeForProgram, RECOVERY_INTENSITY } from "./trainingDayTypes.js";
import { abilityRoleClass } from "./riderProgression.js";
import { abilityMeta } from "./abilityRegistry.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";
import { TRAINING_RACE_DAY_CONFIG } from "./trainingRaceDayTick.js";
import { validateXpVariation, type XpVariation } from "./developmentXpVariation.ts";
import { isXpAgingPercentShape, validateXpAgingPercent, validateXpAgingBrake, XP_AGING_BRAKE_KEYS } from "./riderWear6110.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./weights/displayRecipes.js";

// Skalaens top. Evner går til 99; prisen regner mod 100, så 99 aldrig koster uendeligt.
const SCALE_TOP = 100;
const MAX_ABILITY = 99;
// Samme klip som dagens bjælke: en evne på 99 har intet næste point at bære XP hen til.
const TOP_BAR = 0.999;

export const XP_ROLE_CLASSES = Object.freeze(["signatur", "sekundaer", "haandvaerk", "andenRolle", "svaghed"] as const);
export type XpRoleClass = (typeof XP_ROLE_CLASSES)[number];
// En færdighedsdag træner højst til håndværks-raten (#3762), også for en signatur.
const SKILL_DAY_CLASS: XpRoleClass = "haandvaerk";

export interface XpCurvePoint {
  at: number;
  value: number;
}

export interface DevelopmentXpParams {
  // To former, aldrig begge: `exponent` (+ valgfri `top`, ejervalg 19/11: skalaens top i
  // prisen; højere end skalaen = prisen flader ud helt i toppen) eller `growth` (G3a:
  // hvert point en fast procent dyrere end det forrige). Ens for alle ryttere.
  price: { base: number; exponent?: number; top?: number; growth?: number };
  // XP på en hård dato i en signatur-fokusevne. Lineært mellem punkterne, fladt uden for
  // dem. Punkter frem for faste trin, så omregningen til 1-99 kun flytter tal, ikke kode.
  potentialXp: readonly XpCurvePoint[];
  // Andel af fuld XP efter alder. Lineært mellem punkterne, fladt uden for dem.
  ageShare: { physical: readonly XpCurvePoint[]; mental: readonly XpCurvePoint[] };
  // Andel af fokus-XP for evner uden for sessionen, på træningsdage og på løbsdage.
  offFocusShare: number;
  raceOffFocusShare: number;
  typeShare: Readonly<Record<XpRoleClass, number>>;
  // Dagsvariationen (§5.2). Udeladt = ingen variation. Nøglen ligger ikke på objektet
  // (developmentXpVariation.ts), så params kan skrives ud uden at afsløre den.
  variation?: XpVariation;
  // Afstanden til P (G3a). Udeladt = faktoren er 1 (XP som før, sikker standard).
  distance?: XpDistance;
  // Træthed over en tærskel giver lidt mindre XP (G3a). Udeladt = ingen effekt.
  fatigue?: XpFatigue;
  // Sæsonskiftets aldring under XP (ejervalg 19/11). Udeladt = dagens AGING_V2_CONFIG.
  aging?: XpAging;
}

// Afstandsfaktoren: `h` er afstanden, hvor faktoren er det halve (før `exponent`).
// `exponent` (valgfri) gør overgangen blødere eller skarpere. Tallene er private.
export interface XpDistance {
  h: number;
  exponent?: number;
}

// Træthed over `above` giver XP gange `share` (under 1, over 0). Tallene er private.
export interface XpFatigue {
  above: number;
  share: number;
}

// Løbsbremsen fra talfilens aldring (#8531, begge former). Hvert felt er valgfrit og
// erstatter kun samme felt i AGING_V2_CONFIG; udeladt = dagens bremse. Tallene er private.
export interface XpAgingBrake {
  brakeLoadDays?: number;
  hardTrainingDayWeight?: number;
}

// Kroppens aldring ved sæsonskiftet, når XP er tændt. To former, én ad gangen:
//   • trin (kandidat B): samme form som AGING_V2_CONFIG (riderProgression.js), plus et
//     valgfrit sent fald i de evner, der ellers aldrig falder.
//   • procent (G3a/model E, #8531): to kurver med andelen pr. sæson; reglerne står i
//     riderWear6110.validateXpAgingPercent, så de kun står ét sted.
export interface XpAgingSteps extends XpAgingBrake {
  plateauThroughAge: number;
  declineByYearsPastPlateau: readonly { maxYears: number; drop: number }[];
  // Teknik og mentale evner (alt uden for de fysiske + brosten) falder `drop` pr. sæson
  // fra `fromAge`, bremset af løb og hård træning som de fysiske. Udeladt = aldrig fald.
  late?: { fromAge: number; drop: number };
}

export interface XpAgingPercent extends XpAgingBrake {
  physical: readonly { at: number; value: number }[];
  mental: readonly { at: number; value: number }[];
}

export type XpAging = XpAgingSteps | XpAgingPercent;

// Dommer-fund F1 (19/11): en stavefejl (fx `price.Top`, `ageing`) må ikke give en gyldig
// talfil uden den del. Ukendte nøgler afviser hele talfilen (fail-safe).
function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

// Afstanden til P (G3a). Udeladt = undefined (faktor 1); sat, men ugyldig = null, så hele
// params afvises (fail-safe: XP kører aldrig med en halv afstandsregel).
function validDistance(raw: unknown): XpDistance | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!onlyKeys(r, ["h", "exponent"])) return null;
  // `h` er en afstand i ratingskalaen: over nul og inden for skalaen.
  if (!isNum(r.h) || !(r.h > 0 && r.h <= SCALE_TOP)) return null;
  if (r.exponent !== undefined && (!isNum(r.exponent) || !(r.exponent > 0 && r.exponent <= 10))) return null;
  return Object.freeze({ h: r.h, ...(r.exponent !== undefined ? { exponent: r.exponent as number } : {}) });
}

// Træthed (G3a). Udeladt = undefined (ingen effekt); sat, men ugyldig = null. Tærsklen er
// på træthedens skala (0-100), og andelen er "lidt mindre": over nul og under 1.
function validFatigue(raw: unknown): XpFatigue | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!onlyKeys(r, ["above", "share"])) return null;
  if (!isNum(r.above) || !(r.above >= 0 && r.above < 100)) return null;
  if (!isNum(r.share) || !(r.share > 0 && r.share < 1)) return null;
  return Object.freeze({ above: r.above, share: r.share });
}

// Sæsonskiftets aldring. Udeladt = undefined (dagens aldring); sat, men ugyldig = null,
// så hele params afvises (fail-safe: XP kører aldrig med en halv aldring).
function validAging(raw: unknown): XpAging | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return null;
  // #8531: procent-formen (kurver) valideres af sæsonskiftets egne regler, så en talfil
  // med aldring i procent ikke afvises her og når sæsonskiftet uændret.
  if (isXpAgingPercentShape(raw)) return validateXpAgingPercent(raw) ?? null;
  const a = raw as Record<string, unknown>;
  if (!onlyKeys(a, ["plateauThroughAge", "declineByYearsPastPlateau", "late", ...XP_AGING_BRAKE_KEYS])) return null;
  const brake = validateXpAgingBrake(a);
  if (!brake) return null;
  const plateau = a.plateauThroughAge;
  if (!isNum(plateau) || !Number.isInteger(plateau) || plateau < 20 || plateau > 40) return null;
  const steps = a.declineByYearsPastPlateau;
  if (!Array.isArray(steps) || steps.length < 1) return null;
  const out: { maxYears: number; drop: number }[] = [];
  for (const s of steps) {
    const step = s as Record<string, unknown> | null;
    if (!step || typeof step !== "object" || !onlyKeys(step, ["maxYears", "drop"])) return null;
    if (!isNum(step.maxYears) || !Number.isInteger(step.maxYears) || step.maxYears < 1) return null;
    if (!isNum(step.drop) || step.drop < 0 || step.drop > 5) return null;
    // Trinene står i stigende år, og faldet bliver aldrig mindre med alderen.
    const prev = out[out.length - 1];
    if (prev && (step.maxYears <= prev.maxYears || step.drop < prev.drop)) return null;
    out.push(Object.freeze({ maxYears: step.maxYears, drop: step.drop }));
  }
  // En aldring uden fald er ingen aldring: mindst ét trin skal tage noget.
  if (!out.some((st) => st.drop > 0)) return null;
  let late: { fromAge: number; drop: number } | undefined;
  if (a.late !== undefined) {
    const l = a.late as Record<string, unknown> | null;
    if (!l || typeof l !== "object" || !onlyKeys(l, ["fromAge", "drop"])) return null;
    if (!isNum(l.fromAge) || !Number.isInteger(l.fromAge) || l.fromAge <= plateau || l.fromAge > 50) return null;
    if (!isNum(l.drop) || !(l.drop > 0) || l.drop > 5) return null;
    late = Object.freeze({ fromAge: l.fromAge, drop: l.drop });
  }
  return Object.freeze({ plateauThroughAge: plateau, declineByYearsPastPlateau: Object.freeze(out), ...(late ? { late } : {}), ...brake });
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function validCurve(raw: unknown): XpCurvePoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points: XpCurvePoint[] = [];
  for (const p of raw as Array<Record<string, unknown> | null>) {
    if (!p || !isNum(p.at) || !isNum(p.value)) return null;
    if (points.length && !(p.at > points[points.length - 1].at)) return null;
    points.push({ at: p.at, value: p.value });
  }
  return points;
}

const freezeCurve = (points: XpCurvePoint[]): readonly XpCurvePoint[] =>
  Object.freeze(points.map((p) => Object.freeze(p)));

function curveValue(points: readonly XpCurvePoint[], x: number): number {
  if (x <= points[0].at) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    // Præcis på et punkt er tallet punktets eget, uden afrunding fra interpolationen.
    if (x === b.at) return b.value;
    if (x < b.at) {
      const a = points[i - 1];
      return a.value + ((b.value - a.value) * (x - a.at)) / (b.at - a.at);
    }
  }
  return points[points.length - 1].value;
}

function validAgeCurve(raw: unknown): XpCurvePoint[] | null {
  const points = validCurve(raw);
  if (!points) return null;
  // Alder er aldrig en turbo: kurven starter på fuld XP og stiger aldrig igen.
  if (points[0].value !== 1) return null;
  // Aldrig nul: en hel træningsdag giver altid XP (#7757, gate X5).
  if (!points.every((p, i) => p.value > 0 && p.value <= 1 && (i === 0 || p.value <= points[i - 1].value))) return null;
  return points;
}

/**
 * Validerer params. Returnerer en frossen kopi, eller null hvis noget mangler eller
 * er ugyldigt, så motoren falder tilbage til den gældende model (fail-safe).
 */
export function validateDevelopmentXpParams(raw: unknown): DevelopmentXpParams | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  // Ingen grænse pr. dato under XP (G3a): en talfil med datoreglens grænser (`datePlus2`)
  // er fra før valget og afvises hel, som prisbunden nedenfor, så motoren falder tilbage
  // til dagens model i stedet for at regne en halv model.
  if (!onlyKeys(p, ["price", "potentialXp", "ageShare", "offFocusShare", "raceOffFocusShare", "typeShare", "variation", "distance", "fatigue", "aging"])) return null;

  const price = p.price as Record<string, unknown> | null | undefined;
  if (!price || typeof price !== "object") return null;
  // `floor` står med, så en talfil fra før ejervalget 16/11 afvises af reglen nedenfor.
  if (!onlyKeys(price, ["base", "exponent", "top", "growth", "floor"])) return null;
  if (!isNum(price.base) || !(price.base > 0)) return null;
  // Ingen prisbund (ejervalg 16/11): en talfil med en bund er fra før valget og afvises
  // hel, så motoren falder tilbage til dagens model i stedet for at regne en halv model.
  if (price.floor !== undefined) return null;
  // G3a: prisen har præcis én form. `growth` er den faste procent pr. point, over nul og
  // højst en fordobling, og den står aldrig sammen med kandidat B's eksponent eller top.
  const growthForm = price.growth !== undefined;
  if (growthForm) {
    if (!isNum(price.growth) || !(price.growth > 0 && price.growth <= 1)) return null;
    if (price.exponent !== undefined || price.top !== undefined) return null;
  } else if (!isNum(price.exponent) || !(price.exponent > 0)) return null;
  // Toppen (ejervalg 19/11) er valgfri; sat skal den ligge over skalaens top, så 99 aldrig
  // bliver dyrere end i dag, og under et loft, så prisen ikke bliver flad.
  if (price.top !== undefined && (!isNum(price.top) || !(price.top > SCALE_TOP && price.top <= 10 * SCALE_TOP))) return null;

  const potentialXp = validCurve(p.potentialXp);
  if (!potentialXp || potentialXp.length < 2) return null;
  // Højere potentiale må aldrig give mindre XP, og ingen rytter tjener nul.
  if (!potentialXp.every((q, i) => q.value > 0 && (i === 0 || q.value >= potentialXp[i - 1].value))) return null;

  const age = p.ageShare as Record<string, unknown> | null | undefined;
  if (!age || typeof age !== "object" || !onlyKeys(age, ["physical", "mental"])) return null;
  const physical = validAgeCurve(age.physical);
  const mental = validAgeCurve(age.mental);
  if (!physical || !mental) return null;
  // Mentale evner vokser længere end fysiske: ved ingen alder må de få mindre.
  for (const { at } of [...physical, ...mental]) {
    if (curveValue(mental, at) < curveValue(physical, at)) return null;
  }

  // "Lidt i resten": over nul, og altid under fokus.
  if (!isNum(p.offFocusShare) || !(p.offFocusShare > 0 && p.offFocusShare < 1)) return null;
  if (!isNum(p.raceOffFocusShare) || !(p.raceOffFocusShare > 0 && p.raceOffFocusShare < 1)) return null;

  const type = p.typeShare as Record<string, unknown> | null | undefined;
  if (!type || typeof type !== "object" || !onlyKeys(type, XP_ROLE_CLASSES)) return null;
  const typeShare = {} as Record<XpRoleClass, number>;
  let previous = 1;
  for (const roleClass of XP_ROLE_CLASSES) {
    const share = type[roleClass];
    if (!isNum(share) || !(share > 0) || share > previous) return null;
    typeShare[roleClass] = share;
    previous = share;
  }
  // Enheden er en signatur-fokusevne, så signaturen er hele XP'en.
  if (typeShare.signatur !== 1) return null;

  // Sat, men ugyldig variation gør hele params ugyldige: XP må ikke køre uden den.
  const variation = validateXpVariation(p.variation);
  if (variation === null) return null;
  // Samme regel for afstanden og trætheden: sat, men ugyldig, gør hele params ugyldige.
  const distance = validDistance(p.distance);
  if (distance === null) return null;
  const fatigue = validFatigue(p.fatigue);
  if (fatigue === null) return null;
  const aging = validAging(p.aging);
  if (aging === null) return null;
  // Kandidat B er én pakke (dommer-fund F1): prisens top og aldringen følges ad. G3a's
  // pris (`growth`) har ingen top, så dér står aldringen frit.
  if (!growthForm && (price.top !== undefined) !== (aging !== undefined)) return null;

  return Object.freeze({
    price: Object.freeze(growthForm
      ? { base: price.base, growth: price.growth as number }
      : { base: price.base, exponent: price.exponent as number, ...(price.top !== undefined ? { top: price.top as number } : {}) }),
    potentialXp: freezeCurve(potentialXp),
    ageShare: Object.freeze({ physical: freezeCurve(physical), mental: freezeCurve(mental) }),
    offFocusShare: p.offFocusShare,
    raceOffFocusShare: p.raceOffFocusShare,
    typeShare: Object.freeze(typeShare),
    // Kun med, når den er sat, så params uden variation har samme form som før.
    ...(variation ? { variation } : {}),
    ...(distance ? { distance } : {}),
    ...(fatigue ? { fatigue } : {}),
    ...(aging ? { aging } : {}),
  });
}

/** XP for næste point. Afhænger kun af evnens værdi og er endelig helt op til 99. */
export function xpPriceForNextPoint(level: number, params: DevelopmentXpParams): number {
  const l = Math.min(MAX_ABILITY, Math.max(0, Number(level) || 0));
  const { base, growth, exponent, top } = params.price;
  // G3a: hvert point en fast procent dyrere end det forrige.
  if (isNum(growth)) return base * Math.pow(1 + growth, l);
  return base * Math.pow(1 - l / (top ?? SCALE_TOP), -(exponent as number));
}

/**
 * Rytterens rating for sin bedste ryttertype: den højeste rolle-rating af evnerne, samme
 * tal som bedste-rolle-reglen (riderBestRoleCache.bestRoleForAbilities; typerne afgør kun
 * navnet ved lighed, aldrig tallet). null når ingen rolle kan regnes.
 */
export function xpBestTypeRating(abilities: Record<string, unknown> | null | undefined): number | null {
  if (!abilities) return null;
  let best: number | null = null;
  for (const role of DISPLAY_RECIPE_KEYS as readonly string[]) {
    const rating = ratingForRole(abilities, role);
    if (isNum(rating) && (best === null || rating > best)) best = rating;
  }
  return best;
}

/**
 * Rytterens slid (spec 2026-11-20 §3): det, aldringen varigt har taget af hans top. Det
 * sænker målet, XP'en regner afstanden til. Læsefunktion, så sporet, der gemmer sliddet
 * (#8522), kun skal fylde feltet. Ukendt eller ugyldigt = intet slid.
 */
export function xpWearOf(rider: { wear?: unknown } | null | undefined): number {
  const wear = Number(rider?.wear);
  return Number.isFinite(wear) && wear > 0 ? wear : 0;
}

/**
 * Afstandsfaktoren (G3a): stor langt fra P, mod nul tæt på P, nul ved og over P (minus
 * slid). Uden P (`ceiling` uden for 1-99), uden rating eller uden talfilens `distance`
 * er faktoren 1, så XP er som før (sikker standard).
 */
export function xpDistanceFactor(
  { ceiling, rating, wear = 0 }: { ceiling: number | null | undefined; rating: number | null | undefined; wear?: number },
  params: DevelopmentXpParams,
): number {
  const rule = params.distance;
  if (!rule || !isNum(ceiling) || ceiling < 1 || ceiling > MAX_ABILITY || !isNum(rating)) return 1;
  const gap = Math.max(0, ceiling - (isNum(wear) && wear > 0 ? wear : 0) - rating);
  const share = gap / (gap + rule.h);
  return rule.exponent === undefined ? share : Math.pow(share, rule.exponent);
}

/** Træthedens andel af XP (G3a). Uden talfilens `fatigue` eller ukendt træthed = 1. */
export function xpFatigueFactor(fatigue: number | null | undefined, params: DevelopmentXpParams): number {
  const rule = params.fatigue;
  if (!rule || !isNum(fatigue)) return 1;
  return fatigue > rule.above ? rule.share : 1;
}

/** Andel af fuld XP efter alder. Ukendt alder er fuld XP, som en voksen, aldrig en turbo. */
export function xpAgeShare(age: number | null | undefined, params: DevelopmentXpParams, { mental = false } = {}): number {
  if (!isNum(age)) return 1;
  return curveValue(mental ? params.ageShare.mental : params.ageShare.physical, age);
}

/**
 * Rytterens XP på en hård dato i en signatur-fokusevne: potentiale gange alder.
 * Ukendt potentiale får bundens XP, så en fejl i data aldrig giver ekstra fart.
 */
export function xpPerDate(
  { potentiale, age, mental = false }: { potentiale: number | null | undefined; age: number | null | undefined; mental?: boolean },
  params: DevelopmentXpParams,
): number {
  const top = curveValue(params.potentialXp, isNum(potentiale) ? potentiale : params.potentialXp[0].at);
  return top * xpAgeShare(age, params, { mental });
}

/**
 * Sessionens andel af dagens XP for én evne. `intensityShare` er intensiteten som
 * andel af en hård dag, `weight` evnens vægt i sessionen (uændret fra kataloget), og
 * `offFocusShare` udeladt betyder, at evner uden for sessionen intet får.
 */
export function xpSessionShare(
  { inFocus, intensityShare, weight = 1, offFocusShare = 0 }: {
    inFocus: boolean; intensityShare: number; weight?: number; offFocusShare?: number;
  },
): number {
  if (!isNum(intensityShare) || !(intensityShare > 0)) return 0;
  const share = inFocus ? (isNum(weight) && weight > 0 ? weight : 0) : offFocusShare;
  return intensityShare * share;
}

/** Evnens andel efter rytterens type. Ukendt klasse er anden rolle, som i dag. */
export function xpTypeShare(
  roleClass: string | null | undefined, params: DevelopmentXpParams, { skillDay = false } = {},
): number {
  const known = XP_ROLE_CLASSES.includes(roleClass as XpRoleClass) ? (roleClass as XpRoleClass) : "andenRolle";
  const share = params.typeShare[known];
  return skillDay ? Math.min(share, params.typeShare[SKILL_DAY_CLASS]) : share;
}

/**
 * XP på én evne for ét tick. `dayMult` er resten af dagens led samlet af kalderen
 * (træner og facilitet, dagsvariation, intention, Træn nu). Ugyldigt led tæller som
 * neutralt, så korrupt input hverken giver nul eller ekstra fart. `ticksPerDate` er
 * tickets andel af datoen, så sæsonens længde ikke flytter udbyttet (#6711).
 */
export function abilityXpForTick(
  { riderXp, sessionShare, typeShare, dayMult = 1, ticksPerDate = 1 }: {
    riderXp: number; sessionShare: number; typeShare: number; dayMult?: number; ticksPerDate?: number;
  },
): number {
  const day = isNum(dayMult) && dayMult >= 0 ? dayMult : 1;
  const ticks = isNum(ticksPerDate) && ticksPerDate > 0 ? ticksPerDate : 1;
  const xp = (riderXp * sessionShare * typeShare * day) / ticks;
  return isNum(xp) && xp > 0 ? xp : 0;
}

/**
 * Lægger XP på bjælken og køber point. `bar` er andelen af næste point til den
 * nuværende pris, og den kan ligge over 1, når et tick har holdt et point tilbage (`maxPoints`).
 * Resten regnes om til prisen for det nye næste point. Fremdrift ud over `maxPoints`
 * står på bjælken til næste gang. Kun en evne på 99 mister XP: dér er intet at købe.
 */
export function buyPoints(
  { level, bar = 0, xp = 0, maxPoints = Infinity }: { level: number; bar?: number; xp?: number; maxPoints?: number },
  params: DevelopmentXpParams,
): { level: number; bar: number; points: number } {
  const start = Number(level);
  const startBar = isNum(bar) && bar > 0 ? bar : 0;
  if (!Number.isFinite(start)) return { level, bar: startBar, points: 0 };
  const limit = Number.isNaN(maxPoints) ? 0 : Math.max(0, maxPoints);
  let current = start;
  let points = 0;
  let wallet = startBar * xpPriceForNextPoint(current, params) + (isNum(xp) && xp > 0 ? xp : 0);
  while (points < limit && current < MAX_ABILITY) {
    const price = xpPriceForNextPoint(current, params);
    if (wallet < price) break;
    wallet -= price;
    current += 1;
    points += 1;
  }
  const nextBar = wallet / xpPriceForNextPoint(current, params);
  return { level: current, bar: current >= MAX_ABILITY ? Math.min(nextBar, TOP_BAR) : nextBar, points };
}

/** Det spilleren ser: "x af y XP til næste point". Afrunding hører til visningen. */
export function xpBarView(
  { level, bar = 0 }: { level: number; bar?: number }, params: DevelopmentXpParams,
): { xp: number; price: number } {
  const price = xpPriceForNextPoint(level, params);
  return { xp: (isNum(bar) && bar > 0 ? bar : 0) * price, price };
}

// ═══ MOTORENS TICK (#6110 trin 2) ════════════════════════════════════════════
// Bruges af dailyTraining.js (dailyAbilityDelta og applyDailyTick), kun når
// kontakten development_xp_model er tændt for tick-datoen (developmentXpFlag.ts).
// Samme fordeling som 10-sæsoners-kørslen (scripts/dev/tenSeasonSim6110.mjs), så
// det, kørslen måler, er det, motoren kører. Form og træthed er ikke led (S29), og
// alder er aldrig en turbo: ungdomsfaktoren og alderstabellen er ikke med.
// Dagsvariationen (§5.2) og Træn nu-bonussen (B16) ganges på i applyDailyTick, fordi
// de gælder hele rytterens dag, ikke én evne. Løbsdags-gulvet (ejer 7/11, gate X8)
// står her: en løbsdag giver i hver evne mindst det, en hård træningsdag med
// rytterens træner og facilitet ville give.

// Løbsdagens program (raceDayYield.js RACE_DAY_FOCUS). Gentaget her, fordi
// raceDayYield.js importerer dailyTraining.js; en test låser, at de er ens.
export const XP_RACE_DAY_FOCUS = "race_day";

const MENTAL_ABILITIES: ReadonlySet<string> = new Set(
  (VISIBLE_ABILITIES as readonly string[]).filter((a) => abilityMeta(a)?.category === "mental"),
);

export interface XpTickProgram {
  focus?: string | null;
  intensity?: string | null;
  focusAbilities?: readonly string[] | null;
  focusWeights?: Readonly<Record<string, number>> | null;
  offFocus?: boolean;
}

export interface XpAbilityDeltaInput {
  ability: string;
  age: number | null | undefined;
  potentiale: number | null | undefined;
  program: XpTickProgram | null | undefined;
  primaryType?: string | null;
  secondaryType?: string | null;
  staff?: unknown;
  facilityTier?: number | null;
  riderLevel?: string | null;
  /** Dagens intention på løbsdage (#6641); 1 på træningsdage. */
  academyRateMult?: number;
  trainingCfg?: { focusGrowthMult?: Record<string, number> };
  /** Sat = løbsdags-aksen (#4846): en dato har flere ticks, som deler datoens XP. */
  budgetDivisor?: number | null;
  /**
   * Løbsdagens tillæg for evnen (rolletillægget, #5950, som multiplikator på dagen).
   * Tillægget lægges oven på løbsdags-gulvet, så det er det samme, uanset om gulvet
   * løfter dagen. 1 = intet tillæg.
   */
  yieldMult?: number | null;
}

// Intensiteten, løbsdags-gulvet sammenlignes med.
const RACE_DAY_FLOOR_INTENSITY = "hard";

/**
 * XP på én evne for ét tick med programmet læst som en løbsdag (`raceDay`) eller en
 * træningsdag. Delt af selve dagen og af løbsdags-gulvet, så de to regnes ens.
 */
function programAbilityXp(
  {
    ability, age, potentiale, program, primaryType, secondaryType,
    staff, facilityTier, riderLevel, intention, trainingCfg, budgetDivisor,
  }: Required<Omit<XpAbilityDeltaInput, "program" | "academyRateMult" | "trainingCfg" | "yieldMult">> & {
    program: XpTickProgram; intention: number; trainingCfg: XpAbilityDeltaInput["trainingCfg"];
  },
  raceDay: boolean,
  params: DevelopmentXpParams,
): number {
  const grow = trainingCfg?.focusGrowthMult ?? {};
  const intensityShare = (grow[program.intensity as string] ?? 1) / grow.hard;
  const focusAbilities = program.focusAbilities ?? (TRAINING_FOCUSES as Record<string, readonly string[]>)[program.focus as string] ?? [];
  // En restitutionsdag giver kun XP i sessionens egen evne (#3762).
  const noOffFocus = program.intensity === RECOVERY_INTENSITY || program.offFocus === false;
  const offFocusShare = noOffFocus ? 0 : (raceDay ? params.raceOffFocusShare : params.offFocusShare);
  const sessionShare = xpSessionShare({
    inFocus: focusAbilities.includes(ability), intensityShare, weight: programAbilityWeight(program, ability), offFocusShare,
  });
  if (!(sessionShare > 0)) return 0;
  const typeShare = xpTypeShare(abilityRoleClass(primaryType, secondaryType, ability), params, {
    skillDay: dayTypeForProgram(program) === "skill",
  });
  // Træner og facilitet tæller kun på træningsdage (S13).
  const coach = raceDay ? 1 : facilityTrainingMultiplier({ facilityTier, staff })
    * staffTrainingBonus({ facilityTier, staff: (staff ?? null) as object | null, ability, riderLevel: riderLevel as string });
  const raceDayAxis = isNum(budgetDivisor) && budgetDivisor > 0;
  return abilityXpForTick({
    riderXp: xpPerDate({ potentiale, age, mental: MENTAL_ABILITIES.has(ability) }, params),
    sessionShare,
    typeShare,
    dayMult: coach * intention,
    // #6711: enheden er én dato; på løbsdags-aksen deler datoens løbsdage den.
    ticksPerDate: raceDayAxis ? TRAINING_RACE_DAY_CONFIG.raceDaysPerDate : 1,
  });
}

/**
 * XP på én evne for ét tick. Erstatter dailyAbilityDelta's andel af et point, når
 * kontakten er tændt. Kender intet loft (B4); afstanden til P og trætheden (G3a) ganges på i developmentXpTick.
 *
 * Løbsdags-gulvet (ejer 7/11, bekræftet 12/11, gate X8): på en løbsdag er XP i hver
 * evne mindst det, en hård træningsdag i etapens evner med rytterens træner og
 * facilitet ville give. Løbsdagen selv regnes uden træner (S13); gulvet er det, der
 * sikrer, at et hold med en god træner aldrig taber på at stille op. Gulvet regnes
 * i samme enhed som tick'et (også på løbsdags-aksen) og uden dagens intention, for
 * en træningsdag har ingen intention. Gulvet løfter kun selve dagen; løbsdagens
 * tillæg (`yieldMult`) regnes af dagen og lægges oven i, så "mere i det, etapen
 * kræver" er det samme for alle roller, uanset om gulvet binder (D3 variant A).
 */
export function developmentXpAbilityDelta(
  {
    ability, age, potentiale, program, primaryType = null, secondaryType = null,
    staff = null, facilityTier = null, riderLevel = null, academyRateMult = 1,
    trainingCfg = TRAINING_CONFIG, budgetDivisor = null, yieldMult = 1,
  }: XpAbilityDeltaInput,
  params: DevelopmentXpParams,
): number {
  if (!program || program.intensity === "rest") return 0;
  const raceDay = program.focus === XP_RACE_DAY_FOCUS;
  const intention = isNum(academyRateMult) && academyRateMult >= 0 ? academyRateMult : 1;
  const mult = isNum(yieldMult) && yieldMult > 0 ? yieldMult : 1;
  const base = {
    ability, age, potentiale, primaryType, secondaryType, staff, facilityTier, riderLevel, trainingCfg, budgetDivisor,
  };
  const day = programAbilityXp({ ...base, program, intention }, raceDay, params);
  if (!raceDay) return day * mult;
  const floor = programAbilityXp({ ...base, program: { ...program, intensity: RACE_DAY_FLOOR_INTENSITY }, intention: 1 }, false, params);
  return Math.max(floor, day * mult + Math.max(0, floor - day));
}

export interface XpTickResult {
  abilities: Record<string, number>;
  progress: Record<string, number>;
  gains: Record<string, number>;
  /** XP tjent pr. evne på dette tick (til tick-rapporten, trin 4). */
  xp: Record<string, number>;
  /** Kvitteringen som i dag: summen af tickets fremdrift målt i point. */
  score: number;
  /**
   * #6110 tændingsliste pkt. 2 (#8210): hele point på dette tick, som XP gemt FØR datoen
   * betalte (bjælken ved datoens start). Resten af tickets point er tjent af datoens egen XP.
   */
  barPaid: Record<string, number>;
  /** Bjælken i XP og prisen for næste point pr. synlig evne efter tick'et ("x af y XP"). */
  xpBar: Record<string, { xp: number; price: number }>;
}

/** Datoens start for én rytter: bjælken ved datoens start og point, der allerede er betalt fra den. */
export interface XpDateStart {
  progress?: Record<string, unknown> | null;
  paid?: Record<string, unknown> | null;
}

/**
 * Bjælken i XP og prisen for næste point pr. synlig evne ("x af y XP"), afrundet til hele tal
 * som i visningen (uafrundede tal gør talent og forhold nøjagtigt aflæselige, H6b/X9).
 * `only` begrænser til de evner, der står i den (rapporten: evner med XP eller bjælke).
 */
export function xpBarsFor(
  abilities: Record<string, unknown>, progress: Record<string, unknown> | null | undefined, params: DevelopmentXpParams,
  { only = null }: { only?: ReadonlySet<string> | null } = {},
): Record<string, { xp: number; price: number }> {
  const out: Record<string, { xp: number; price: number }> = {};
  for (const ability of VISIBLE_ABILITIES as readonly string[]) {
    if (only && !only.has(ability)) continue;
    const level = Number(abilities?.[ability]);
    if (!Number.isFinite(level)) continue;
    const view = xpBarView({ level, bar: Number(progress?.[ability] ?? 0) }, params);
    out[ability] = { xp: Math.round(view.xp), price: Math.round(view.price) };
  }
  return out;
}

/** XP pr. evne afrundet til hele tal som i visningen; evner, der runder til 0, udelades. */
export function roundedXp(xp: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ability, value] of Object.entries(xp ?? {})) {
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n > 0) out[ability] = n;
  }
  return out;
}

/** En tidligere rapportlinje på samme dato for samme rytter (kvittering eller kalenderdags-rapport). */
export interface XpDateRow {
  progress_before?: Record<string, unknown> | null;
  bar_paid?: Record<string, unknown> | null;
  xp_slot_seq?: unknown;
  game_day?: unknown;
}

/**
 * Datoens start ud fra datoens tidligere rapportlinjer: bjælken før datoens FØRSTE afregnede slot
 * (lavest `xp_slot_seq`; slots kan afregnes ude af løbsdags-rækkefølge: tryk, etape, aften), point
 * allerede betalt fra bjælken, og dette slots løbenummer på datoen. Ingen tidligere linjer = datoens
 * første slot (dateStart null, seq 1).
 */
export function xpDateStartFromRows(rows: ReadonlyArray<XpDateRow | null | undefined>): { dateStart: XpDateStart | null; seq: number } {
  const earlier = rows.filter((row): row is XpDateRow => Boolean(row) && typeof row === "object");
  if (earlier.length === 0) return { dateStart: null, seq: 1 };
  const rank = (row: XpDateRow) => {
    const seq = Number(row.xp_slot_seq);
    return Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER; // ældre linjer uden løbenummer sidst
  };
  const first = [...earlier].sort((a, b) => rank(a) - rank(b) || (Number(a.game_day ?? -Infinity) - Number(b.game_day ?? -Infinity)))[0];
  const paid: Record<string, number> = {};
  let maxSeq = 0;
  for (const row of earlier) {
    for (const [ability, n] of Object.entries(row.bar_paid ?? {})) {
      const v = Number(n);
      if (Number.isFinite(v) && v > 0) paid[ability] = (paid[ability] ?? 0) + v;
    }
    const seq = Number(row.xp_slot_seq);
    maxSeq = Math.max(maxSeq, Number.isFinite(seq) ? seq : 0);
  }
  return { dateStart: { progress: first.progress_before ?? null, paid }, seq: Math.max(maxSeq, earlier.length) + 1 };
}

/**
 * Det, tick'et skal vide om rytteren (G3a). `ceiling` er potentialet P (1-99; riders.talent_ceiling),
 * `fatigue` trætheden ved datoens start og `wear` sliddet (xpWearOf). Typerne følger med til
 * kalderens egne regler. Alt udeladt = faktor 1, XP som før.
 */
export interface XpTickRider {
  age?: number | null;
  potentiale?: number | null;
  ceiling?: number | null;
  fatigue?: number | null;
  wear?: number | null;
}

/**
 * Ét XP-tick for én rytter. `xpFor(ability)` er evnens XP på tick'et (kalderen
 * samler dailyAbilityDelta og løbsdagens tillæg). Tick'et ganger afstanden til P og
 * trætheden på (G3a), regnet én gang ud fra evnerne ved tick'ets start, og køber point
 * til prisen, højst `maxPointsPerTick` pr. evne. Der er ingen grænse pr. dato (G3a);
 * `dateUsedGains` (evnens point tidligere på datoen) bruges kun til kvitteringen for
 * point betalt af gemt XP (`barPaid`). Resten bliver på bjælken, omregnet til den nye
 * pris (spec §4.3, §7.3). Muterer ikke input.
 */
export function developmentXpTick(
  {
    abilities, progress, maxPointsPerTick = Infinity, dateUsedGains = null, rider = null, xpFor,
    dateStart = null,
  }: {
    abilities: Record<string, unknown>;
    progress?: Record<string, unknown> | null;
    maxPointsPerTick?: number;
    dateUsedGains?: Record<string, unknown> | null;
    /**
     * Tændingsnatten (fra R16). Uden grænse pr. dato udbetales gemt fremgang altid helt, så
     * feltet ændrer intet længere; det står, så motorens kald er uændret.
     */
    storedBarPayout?: boolean;
    /** Potentiale, træthed og slid til afstanden og trætheden (G3a). Udeladt = faktor 1. */
    rider?: XpTickRider | null;
    xpFor: (ability: string) => number;
    /** Bjælken ved datoens start og point betalt fra den tidligere på datoen. Udeladt = dette tick er datoens første. */
    dateStart?: XpDateStart | null;
  },
  params: DevelopmentXpParams,
): XpTickResult {
  const nextAbilities = { ...abilities } as Record<string, number>;
  const nextProgress = { ...(progress ?? {}) } as Record<string, number>;
  const gains: Record<string, number> = {};
  const xp: Record<string, number> = {};
  const barPaid: Record<string, number> = {};
  let score = 0;
  // G3a: én faktor for hele tick'et, ud fra evnerne ved tick'ets start, så rækkefølgen af
  // evnerne i løkken aldrig flytter udbyttet.
  const riderFactor = xpDistanceFactor({
    ceiling: rider?.ceiling, rating: params.distance ? xpBestTypeRating(abilities) : null, wear: xpWearOf(rider),
  }, params) * xpFatigueFactor(rider?.fatigue, params);
  for (const ability of VISIBLE_ABILITIES as readonly string[]) {
    const level = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(level)) continue; // korrupt input må ikke forgifte bjælken
    const raw = Number(xpFor(ability)) * riderFactor;
    const earned = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const bar = Number(nextProgress[ability] ?? 0);
    // En bjælke over 1 (resten fra en tidligere dato) betales ud, også uden ny XP (§7.3).
    if (!(earned > 0) && !(bar >= 1)) continue;
    const usedRaw = Number(dateUsedGains?.[ability]);
    const used = Number.isFinite(usedRaw) && usedRaw > 0 ? usedRaw : 0;
    // Intet nyt at lægge på og intet, tick'et må købe: bjælken står præcis, som den er.
    if (!(earned > 0) && !(maxPointsPerTick > 0)) continue;
    const out = buyPoints({ level, bar, xp: earned, maxPoints: maxPointsPerTick }, params);
    if (earned > 0) {
      xp[ability] = earned;
      score += earned / xpPriceForNextPoint(level, params);
    }
    nextProgress[ability] = out.bar;
    if (out.points > 0) {
      gains[ability] = out.points;
      nextAbilities[ability] = out.level;
      // Point betalt af XP gemt før datoen: det, bjælken ved datoens start alene kunne købe fra
      // evnens niveau ved datoens start, minus det, der allerede er betalt fra den på datoen.
      const startBar = dateStart?.progress ? Number(dateStart.progress[ability] ?? 0) : bar;
      const paidRaw = Number(dateStart?.paid?.[ability]);
      const paidBefore = Number.isFinite(paidRaw) && paidRaw > 0 ? paidRaw : 0;
      const coverable = startBar >= 1
        ? buyPoints({ level: level - used, bar: startBar, xp: 0 }, params).points : 0;
      const paid = Math.max(0, Math.min(out.points, coverable - paidBefore));
      if (paid > 0) barPaid[ability] = paid;
    }
  }
  return {
    abilities: nextAbilities, progress: nextProgress, gains, xp, score: Math.round(score * 100) / 100,
    barPaid, xpBar: xpBarsFor(nextAbilities, nextProgress, params),
  };
}
