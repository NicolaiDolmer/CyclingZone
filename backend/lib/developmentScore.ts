// Udviklingsscore B (#6110 byggetrin 7, PR (a)): én kilde til dagens tal OG dagens udvikling.
//
// Spec: docs/superpowers/specs/2026-10-23-6110-udviklingsscore-teknisk-design.md (§3)
// og samlet design §5 + §13 (S9, S10, S11, S13, S14, S16, S22, S29).
//
// ═══ STATUS ══════════════════════════════════════════════════════════════════
// Bag flaget `development_score_v2` (slukket). Motoren kalder modulet gennem
// developmentScoreWiring.js (#6950, PR (c)); slukket kører alt uændret på
// `trainingScore.js`. Løbsdagens score-skrivning og API'et kommer i PR (b) og (d).
//
// ═══ KONTRAKTEN ══════════════════════════════════════════════════════════════
//   developmentDay(input, params) -> null | { score: 1..99, devMult, kind }
//
//   score    det spilleren ser (S10: kun tallet og 7-dages snittet, ingen faktorer).
//   devMult  det motoren ganger på dagens udvikling. Afledes KUN af `score` (S22):
//            to dage med samme score giver altid samme devMult. Ingen skjult
//            parallel faktor, og derfor heller ingen `contributions` her.
//   kind     "training" | "race". Løbsdage får tal på samme skala (S9).
//   null     der var intet pas at måle (hviledag eller ukendt intensitet).
//
// ═══ LEDDENE ═════════════════════════════════════════════════════════════════
// Træningsdag: intensitet, fokus-match (rolleklasse pr. sessionens evner),
//   træner, facilitet, talent (grundtalent + træningsdisciplin, S11), dagsstøj.
// Løbsdag: basis som en hård dag over etapens evner, uden træner og facilitet
//   (S13), tillæg i etapens evner, afgørelses-bonus og niveau-bonus (S14),
//   talent, dagsstøj. Udgået rytter: kun basis (S16).
//   Rollen (også fri rolle, S17) flytter kun HVOR løbets tillæg lander, ikke
//   hvor meget (D3: samme samlede udbytte for alle roller). Derfor tager scoren
//   ingen rolle. En hjælper, der arbejder i finalen, er "med i afgørelsen";
//   den mapping laver kalderen.
// Aldrig med (S29 + træningsscore B): form, træthed, kondition og alder.
//   Funktionen læser dem ikke, heller ikke hvis kalderen sender dem med.
//
// ═══ TAL ═════════════════════════════════════════════════════════════════════
// Alle kalibrerings-tal (kurve, talent-vægte, støjens bredde, løbets bonusser,
// niveau-vinduet, devMult-normaliseringen) er PRIVATE (hard rule 17,
// balance-internals/6110/) og gives som `params`. Der er bevidst ingen
// standardværdier. Referencerne for intensitet og fokus-match peger på
// eksisterende offentlige motor-konstanter, så skalaen ikke kan drive fra motoren.
//
// Ren funktion: ingen DB, ingen Date, ingen Math.random.

import { TRAINING_CONFIG, TRAINING_FOCUSES, programAbilityWeight } from "./training.js";
import { ROLE_CLASS_RATE, roleRateFactor, seededUnitMixed } from "./riderProgression.js";
import { staffTrainingBonus, facilityTrainingMultiplier } from "./staffTrainingBonus.js";
import { dayTypeForProgram } from "./trainingDayTypes.js";
import { raceDayFocusAbilities } from "./raceDayYield.js";

// Flaget står i stageFlagCatalog.js; motor-kaldet bor i developmentScoreWiring.js (#6950).
export const DEVELOPMENT_SCORE_V2_FLAG_KEY = "development_score_v2";

export const DEVELOPMENT_SCORE_MIN = 1;
export const DEVELOPMENT_SCORE_MAX = 99;
// Kurvens asymptote. Den nås aldrig, så MAX er en garanti, ikke en klippe.
const ASYMPTOTE = 99;

export type DevelopmentDayKind = "training" | "race";
// "decisive": med i afgørelsen (inkl. hjælpere der arbejder i finalen).
// "finale":   faldt fra i finalen. "none": hverken eller.
export type RaceDecision = "decisive" | "finale" | "none";

export interface DevelopmentScoreParams {
  salt: string;
  // Scoren for en dag, der står præcis på referencen (u = 1).
  midpoint: number;
  // Hvor hårdt kvaliteten slår igennem på skalaen (> 0).
  curve: number;
  // Talentet som log-lineært led om et centrum. Manglende disciplin = neutral.
  talent: { center: number; spread: number; baseWeight: number; disciplineWeight: number };
  // Dagsstøj: seeded normal, klippet til ±clip, ganget på i log-rum.
  noise: { sigma: number; clip: number };
  race: {
    stageBonus: number;
    decisionBonus: { decisive: number; finale: number };
    // Glidende bonus over (feltets niveau − rytterens niveau): 0 uden for
    // [fromGap, toGap], top `max` ved `peakGap`. Aldrig negativ.
    levelBonus: { max: number; fromGap: number; peakGap: number; toGap: number };
  };
  // devMult = (score / midpoint)^exponent / normalizer. Normaliseringen holder
  // sæsonens samlede tempo på D1-milepælene (måles i 10-sæsoners-simuleringen).
  devMult: { exponent: number; normalizer: number };
}

export interface TalentInput {
  // Grundtalent i ratingens skala (1-99). Skjult; forlader aldrig serveren.
  baseTalent: number;
  // Træningsdisciplin (synlig mental evne, S11). null/udeladt = neutral.
  trainingDiscipline?: number | null;
}

interface CommonInput {
  // Seed for dagsstøjen: (rytter, dag). For løbsdage bør dayKey skelne flere
  // løbsdage på samme kalenderdato (fx `${seasonId}#gd${gameDay}`).
  riderId: string;
  dayKey: string;
  talent: TalentInput;
  primaryType?: string | null;
  secondaryType?: string | null;
}

export interface TrainingProgram {
  focus?: string | null;
  intensity?: string | null;
  focusAbilities?: readonly string[] | null;
  // #5319: v3-kataloget (training_catalog_v3) lægger sessionens egne vægte her.
  focusWeights?: Readonly<Record<string, number>> | null;
}

export interface TrainingDayInput extends CommonInput {
  kind: "training";
  program: TrainingProgram;
  staff?: unknown;
  facilityTier?: number | null;
  riderLevel?: string | null;
}

export interface RaceDayInput extends CommonInput {
  kind: "race";
  // Etapens profil (race_stage_profiles.profile_type). Ukendt = samme fallback
  // som løbsdagens program i dag. `stageAbilities` overstyrer profilen.
  profileType?: string | null;
  stageAbilities?: readonly string[] | null;
  // false = udgået rytter (S16): kun basis.
  finished: boolean;
  decision?: RaceDecision | null;
  // Rytterens og feltets niveau ved løbsstart (samme skala). Mangler et af
  // dem, gives ingen niveau-bonus.
  riderRating?: number | null;
  fieldRating?: number | null;
}

export type DevelopmentDayInput = TrainingDayInput | RaceDayInput;

export interface DevelopmentDay {
  score: number;
  devMult: number;
  kind: DevelopmentDayKind;
}

// Kun til harness og simulering på serveren. Må ALDRIG sendes til en klient
// (S10, H4, H6b): talent- og støj-leddet ville åbne sidekanalen igen.
export interface DevelopmentDayFactors {
  kind: DevelopmentDayKind;
  intensity: number;
  focusMatch: number;
  coach: number;
  facility: number;
  stage: number;
  decision: number;
  level: number;
  talent: number;
  noise: number;
}

const GROWTH: Readonly<Record<string, number>> = TRAINING_CONFIG.focusGrowthMult;
const FOCUSES: Readonly<Record<string, readonly string[]>> = TRAINING_FOCUSES;
const ROLE_RATE: Readonly<Record<string, number>> = ROLE_CLASS_RATE;
// JSDoc'en i staffTrainingBonus.js kræver en streng som riderLevel, men funktionen
// tåler null (ukendt niveau = ingen specialiserings-fordel), som trainingScore.js
// allerede sender.
const coachBonus = staffTrainingBonus as unknown as (args: {
  facilityTier: number | null; staff: unknown; ability: string; riderLevel: string | null;
}) => number;

// Referencen: et mellem-pas med håndværks-match er 1,0 på begge led.
const REFERENCE_INTENSITY = GROWTH.normal;
const REFERENCE_FOCUS_MATCH = ROLE_RATE.haandvaerk;
// Løbsdagens basis er en hård dag (spec §3), uanset hvad planen sagde.
const RACE_BASE_INTENSITY = "hard";

function isPositiveFinite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Kaster ved ufuldstændige eller ugyldige params. Der findes ingen standardværdier,
 * så en simulering med en manglende nøgle skal fejle højt i stedet for at regne
 * videre med NaN.
 */
export function assertDevelopmentScoreParams(params: DevelopmentScoreParams): void {
  const fail = (what: string): never => {
    throw new Error(`developmentScore: ugyldige params (${what})`);
  };
  if (!params || typeof params !== "object") fail("mangler");
  if (typeof params.salt !== "string" || params.salt.length === 0) fail("salt");
  if (!isPositiveFinite(params.midpoint) || params.midpoint >= ASYMPTOTE) fail("midpoint");
  if (!isPositiveFinite(params.curve)) fail("curve");
  const t = params.talent;
  if (!t || !isFiniteNumber(t.center) || !isPositiveFinite(t.spread)
    || !isFiniteNumber(t.baseWeight) || t.baseWeight < 0
    || !isFiniteNumber(t.disciplineWeight) || t.disciplineWeight < 0) fail("talent");
  const n = params.noise;
  if (!n || !isFiniteNumber(n.sigma) || n.sigma < 0 || !isPositiveFinite(n.clip)) fail("noise");
  const r = params.race;
  if (!r || !isFiniteNumber(r.stageBonus) || r.stageBonus < 1) fail("race.stageBonus");
  const d = r.decisionBonus;
  if (!d || !isFiniteNumber(d.decisive) || !isFiniteNumber(d.finale)
    || d.finale < 1 || d.decisive < d.finale) fail("race.decisionBonus");
  const l = r.levelBonus;
  if (!l || !isFiniteNumber(l.max) || l.max < 0
    || !isFiniteNumber(l.fromGap) || !isFiniteNumber(l.peakGap) || !isFiniteNumber(l.toGap)
    || !(l.fromGap < l.peakGap && l.peakGap < l.toGap)) fail("race.levelBonus");
  const m = params.devMult;
  if (!m || !isFiniteNumber(m.exponent) || m.exponent < 0 || !isPositiveFinite(m.normalizer)) fail("devMult");
}

// Standard-normalfordelt tal fra to seeded uniforme tal (Box-Muller).
function seededNormal(key: string): number {
  const u1 = Math.max(seededUnitMixed(`${key}:a`), 1e-12);
  const u2 = seededUnitMixed(`${key}:b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Dagsstøjen for (rytter, dag). Median 1, symmetrisk i log-rum, aldrig ≤ 0. */
export function dayNoise(riderId: string, dayKey: string, params: DevelopmentScoreParams): number {
  const z = clamp(seededNormal(`devscore:${params.salt}:${riderId}:${dayKey}`), -params.noise.clip, params.noise.clip);
  return Math.exp(params.noise.sigma * z);
}

/** Talent-leddet: grundtalent + træningsdisciplin (S11). Monotont stigende i begge. */
export function talentFactor(talent: TalentInput, params: DevelopmentScoreParams): number {
  const { center, spread, baseWeight, disciplineWeight } = params.talent;
  const base = isFiniteNumber(talent?.baseTalent) ? talent.baseTalent : center;
  const discipline = isFiniteNumber(talent?.trainingDiscipline) ? talent.trainingDiscipline : center;
  const zBase = (clamp(base, DEVELOPMENT_SCORE_MIN, DEVELOPMENT_SCORE_MAX) - center) / spread;
  const zDisc = (clamp(discipline, DEVELOPMENT_SCORE_MIN, DEVELOPMENT_SCORE_MAX) - center) / spread;
  return Math.exp(baseWeight * zBase + disciplineWeight * zDisc);
}

// Glidende "bump" i [0, 1]: 0 ved kanterne, 1 ved toppen, cosinus-flanker.
function smoothBump(x: number, from: number, peak: number, to: number): number {
  if (!(x > from && x < to)) return 0;
  const t = x <= peak ? (x - from) / (peak - from) : (to - x) / (to - peak);
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

/**
 * Niveau-bonus (S14): bred omkring eget niveau og et lidt stærkere felt, ingen
 * bonus ved et alt for let eller alt for hårdt felt. Altid ≥ 1 (aldrig under
 * fuldt udbytte).
 */
export function levelBonusFactor(
  riderRating: number | null | undefined,
  fieldRating: number | null | undefined,
  params: DevelopmentScoreParams,
): number {
  if (!isFiniteNumber(riderRating) || !isFiniteNumber(fieldRating)) return 1;
  const { max, fromGap, peakGap, toGap } = params.race.levelBonus;
  return 1 + max * smoothBump(fieldRating - riderRating, fromGap, peakGap, toGap);
}

function decisionFactor(decision: RaceDecision | null | undefined, params: DevelopmentScoreParams): number {
  if (decision === "decisive") return params.race.decisionBonus.decisive;
  if (decision === "finale") return params.race.decisionBonus.finale;
  return 1;
}

interface WeightedAbility { ability: string; weight: number }

function trainingAbilityWeights(program: TrainingProgram): WeightedAbility[] {
  const focus = program?.focus ?? null;
  const abilities = program?.focusAbilities ?? (focus ? FOCUSES[focus] : null) ?? [];
  return abilities.map((ability) => ({ ability, weight: Number(programAbilityWeight(program, ability)) }));
}

// Vægtet middel af rolle-raten over dagens evner, relativt til håndværk.
// Færdighedsdagen trænes altid til håndværks-raten (samme loft som motoren).
function focusMatchFor(
  weights: readonly WeightedAbility[],
  primaryType: string | null | undefined,
  secondaryType: string | null | undefined,
  capAtCraft: boolean,
): number {
  let weightSum = 0;
  let rateSum = 0;
  for (const { ability, weight } of weights) {
    if (!isPositiveFinite(weight)) continue;
    const baseRate = primaryType == null
      ? REFERENCE_FOCUS_MATCH
      : Number(roleRateFactor(primaryType, secondaryType ?? null, ability));
    const rate = capAtCraft ? Math.min(baseRate, REFERENCE_FOCUS_MATCH) : baseRate;
    weightSum += weight;
    rateSum += weight * rate;
  }
  const match = weightSum > 0 ? rateSum / weightSum : ROLE_RATE.andenRolle;
  return match / REFERENCE_FOCUS_MATCH;
}

function trainingCoach(
  weights: readonly WeightedAbility[],
  input: TrainingDayInput,
): number {
  let weightSum = 0;
  let sum = 0;
  for (const { ability, weight } of weights) {
    if (!isPositiveFinite(weight)) continue;
    weightSum += weight;
    sum += weight * Number(coachBonus({
      facilityTier: input.facilityTier ?? null,
      staff: input.staff ?? null,
      ability,
      riderLevel: input.riderLevel ?? null,
    }));
  }
  return weightSum > 0 ? sum / weightSum : 1;
}

/**
 * Leddene bag dagens score, alle som faktorer relativt til referencen (1 = neutral).
 * Server-only (se DevelopmentDayFactors). null = intet pas at måle.
 */
export function developmentDayFactors(
  input: DevelopmentDayInput,
  params: DevelopmentScoreParams,
): DevelopmentDayFactors | null {
  const talent = talentFactor(input.talent, params);
  const noise = dayNoise(String(input.riderId), String(input.dayKey), params);

  if (input.kind === "race") {
    const abilities = input.stageAbilities ?? raceDayFocusAbilities(input.profileType ?? null);
    const weights = (abilities as readonly string[]).map((ability) => ({ ability, weight: 1 }));
    const finished = input.finished === true;
    return {
      kind: "race",
      intensity: GROWTH[RACE_BASE_INTENSITY] / REFERENCE_INTENSITY,
      focusMatch: focusMatchFor(weights, input.primaryType, input.secondaryType, false),
      // S13: træner og facilitet påvirker aldrig løbsdage.
      coach: 1,
      facility: 1,
      // S16: udgået rytter får kun basis.
      stage: finished ? params.race.stageBonus : 1,
      decision: finished ? decisionFactor(input.decision, params) : 1,
      level: finished ? levelBonusFactor(input.riderRating, input.fieldRating, params) : 1,
      talent,
      noise,
    };
  }

  const program = input.program ?? {};
  const intensityKey = program.intensity ?? "";
  const growth = GROWTH[intensityKey];
  // Hviledag ("rest" står ikke i focusGrowthMult) eller ukendt intensitet.
  if (!isPositiveFinite(growth)) return null;
  const weights = trainingAbilityWeights(program);
  return {
    kind: "training",
    intensity: growth / REFERENCE_INTENSITY,
    focusMatch: focusMatchFor(weights, input.primaryType, input.secondaryType, dayTypeForProgram(program) === "skill"),
    coach: trainingCoach(weights, input),
    facility: Number(facilityTrainingMultiplier({ facilityTier: input.facilityTier ?? null, staff: input.staff ?? null })),
    stage: 1,
    decision: 1,
    level: 1,
    talent,
    noise,
  };
}

const FACTOR_KEYS = Object.freeze([
  "intensity", "focusMatch", "coach", "facility", "stage", "decision", "level", "talent", "noise",
] as const);

/** u = Π faktorer. 1,0 = referencedagen. */
export function relativeQuality(factors: DevelopmentDayFactors): number {
  let u = 1;
  for (const key of FACTOR_KEYS) {
    const value = factors[key];
    if (isPositiveFinite(value)) u *= value;
  }
  return u;
}

/** Mættende kurve u → 1..99 (ikke afrundet). */
export function scoreFromRelativeQuality(u: number, params: DevelopmentScoreParams): number {
  if (!isPositiveFinite(u)) return DEVELOPMENT_SCORE_MIN;
  const m = ASYMPTOTE / params.midpoint - 1;
  const p = Math.pow(u, params.curve);
  return clamp((ASYMPTOTE * p) / (p + m), DEVELOPMENT_SCORE_MIN, DEVELOPMENT_SCORE_MAX);
}

/** S22: dagens udviklings-multiplikator afledes udelukkende af den viste score. */
export function devMultFromScore(score: number, params: DevelopmentScoreParams): number {
  const s = clamp(Number(score) || DEVELOPMENT_SCORE_MIN, DEVELOPMENT_SCORE_MIN, DEVELOPMENT_SCORE_MAX);
  return Math.pow(s / params.midpoint, params.devMult.exponent) / params.devMult.normalizer;
}

/**
 * Dagens Udviklingsscore og udviklings-multiplikator for én rytter-dag.
 * Det er denne funktion 10-sæsoners-simuleringen (S25) kalder.
 */
export function developmentDay(input: DevelopmentDayInput, params: DevelopmentScoreParams): DevelopmentDay | null {
  assertDevelopmentScoreParams(params);
  const factors = developmentDayFactors(input, params);
  if (!factors) return null;
  const score = Math.round(scoreFromRelativeQuality(relativeQuality(factors), params));
  return { score, devMult: devMultFromScore(score, params), kind: factors.kind };
}
