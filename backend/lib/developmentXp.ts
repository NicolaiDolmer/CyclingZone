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
//      og er endelig helt op til 99. Der er ingen mur.
//   2. XP PR. DAG: potentialet står fast gennem karrieren og afgør, hvor meget
//      rytteren tjener. Forskellen mellem ryttere ligger i XP, aldrig i prisen.
//   3. ALDER: fuld XP til et stykke ind i karrieren, derefter tydeligt faldende.
//      Alder giver aldrig ekstra fart. Mentale evner har deres egen kurve, fordi de
//      vokser længere end de fysiske.
//   4. FOKUS: en træning giver mest i sessionens evner og lidt i resten.
//   5. TYPE: rolleklassen er en andel af XP, ikke et loft. Den er anlæg og følger
//      ikke med, når rytteren trænes om.
//   6. BJÆLKEN: gemmes som en andel af næste point. Når et point købes, regnes
//      overskuddet om til den nye pris, så ingen XP går tabt eller opstår.
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
  price: { base: number; exponent: number };
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

  const price = p.price as Record<string, unknown> | null | undefined;
  if (!price || typeof price !== "object") return null;
  if (!isNum(price.base) || !(price.base > 0)) return null;
  if (!isNum(price.exponent) || !(price.exponent > 0)) return null;

  const potentialXp = validCurve(p.potentialXp);
  if (!potentialXp || potentialXp.length < 2) return null;
  // Højere potentiale må aldrig give mindre XP, og ingen rytter tjener nul.
  if (!potentialXp.every((q, i) => q.value > 0 && (i === 0 || q.value >= potentialXp[i - 1].value))) return null;

  const age = p.ageShare as Record<string, unknown> | null | undefined;
  if (!age || typeof age !== "object") return null;
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
  if (!type || typeof type !== "object") return null;
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

  return Object.freeze({
    price: Object.freeze({ base: price.base, exponent: price.exponent }),
    potentialXp: freezeCurve(potentialXp),
    ageShare: Object.freeze({ physical: freezeCurve(physical), mental: freezeCurve(mental) }),
    offFocusShare: p.offFocusShare,
    raceOffFocusShare: p.raceOffFocusShare,
    typeShare: Object.freeze(typeShare),
    // Kun med, når den er sat, så params uden variation har samme form som før.
    ...(variation ? { variation } : {}),
  });
}

/** XP for næste point. Afhænger kun af evnens værdi og er endelig helt op til 99. */
export function xpPriceForNextPoint(level: number, params: DevelopmentXpParams): number {
  const l = Math.min(MAX_ABILITY, Math.max(0, Number(level) || 0));
  return params.price.base * Math.pow(1 - l / SCALE_TOP, -params.price.exponent);
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
 * nuværende pris, og den kan ligge over 1, når et dato-loft har klippet et point.
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
 * kontakten er tændt. Kender intet loft (B4): kun prisen bremser.
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
}

/**
 * Ét XP-tick for én rytter. `xpFor(ability)` er evnens XP på tick'et (kalderen
 * samler dailyAbilityDelta og løbsdagens tillæg). Point købes til prisen og højst
 * `maxPointsPerTick` pr. evne; resten bliver på bjælken (spec §4.3). Muterer ikke input.
 */
export function developmentXpTick(
  { abilities, progress, maxPointsPerTick = Infinity, xpFor }: {
    abilities: Record<string, unknown>;
    progress?: Record<string, unknown> | null;
    maxPointsPerTick?: number;
    xpFor: (ability: string) => number;
  },
  params: DevelopmentXpParams,
): XpTickResult {
  const nextAbilities = { ...abilities } as Record<string, number>;
  const nextProgress = { ...(progress ?? {}) } as Record<string, number>;
  const gains: Record<string, number> = {};
  const xp: Record<string, number> = {};
  let score = 0;
  for (const ability of VISIBLE_ABILITIES as readonly string[]) {
    const level = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(level)) continue; // korrupt input må ikke forgifte bjælken
    const raw = Number(xpFor(ability));
    const earned = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const bar = Number(nextProgress[ability] ?? 0);
    // En bjælke over 1 (klippet af dato-loftet) betales ud, også uden ny XP (§7.3).
    if (!(earned > 0) && !(bar >= 1)) continue;
    const out = buyPoints({ level, bar, xp: earned, maxPoints: maxPointsPerTick }, params);
    if (earned > 0) {
      xp[ability] = earned;
      score += earned / xpPriceForNextPoint(level, params);
    }
    nextProgress[ability] = out.bar;
    if (out.points > 0) {
      gains[ability] = out.points;
      nextAbilities[ability] = out.level;
    }
  }
  return { abilities: nextAbilities, progress: nextProgress, gains, xp, score: Math.round(score * 100) / 100 };
}
