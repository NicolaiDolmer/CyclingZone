/**
 * #3514 fase 1a. "Mandatet": den rene model-kerne.
 * ================================================
 * Spec (GODKENDT af ejer 7/8): docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md
 * Plan: docs/slices/09-board-mandate-rework-MASTER.md
 *
 * Denne fil er REN: ingen Supabase, ingen I/O, ingen tid-afhængighed ud over hvad
 * kalderen sender ind. Alt hvad der kan testes uden database ligger her, så
 * migrations-scriptet, motoren og (senere) årsmøde-API'et regner på præcis samme
 * matematik. Det er den direkte modgift mod fejlklassen bag reworket: tre steder
 * der hver regnede sit eget tilfredshedstal.
 *
 * Modellen erstatter IKKE mål-generering eller mål-evaluering. `generateBoardGoals`
 * og `evaluateGoalProgress` i boardGoals.js genbruges uændret (spec §3.1). Det
 * eneste nye er: hvordan de tre gamle planer lægges sammen til ÉN relation, og
 * hvilke regler der gælder for mandat og vision.
 */

import { clamp, clampSatisfaction, roundNumber } from "./boardUtils.js";
import { stampGoalsOwners } from "./boardMembers.js";
import { addGoalMetadata, buildGoalKey, buildNegotiatedGoal, buildStretchGoal } from "./boardGoals.js";

// ---------------------------------------------------------------------------
// 1. Migrations-vægte (ejer-beslutning 7 af 7/8)
// ---------------------------------------------------------------------------
// Confidence-startværdien er det vægtede snit af de 3 satisfactions: 1yr 50 %,
// 3yr 30 %, 5yr 20 %. Vægtene er ejer-låste og må ikke justeres uden nyt ejer-valg.
export const MANDATE_MIGRATION_WEIGHTS = Object.freeze({
  "1yr": 0.50,
  "3yr": 0.30,
  "5yr": 0.20,
});

/**
 * Er dette en 3/5-års-plan der aldrig blev underskrevet?
 *
 * Målt mod prod 17/8: 22 rækker (19 × 3yr + 3 × 5yr) står `pending` UDEN
 * start-/slut-sæson og med `seasons_completed = 0`, det er forhandlinger der blev
 * foreslået og aldrig afsluttet. Deres satisfaction er uden undtagelse præcis 50,
 * altså default-værdien: der er ingen relation at måle, kun en placeholder.
 *
 * De udelades derfor BÅDE fra confidence-snittet og fra visionen. To grunde:
 *   1. En placeholder på 50 trækker et hold på 80 ned og et hold på 20 op, den
 *      tilføjer støj, ikke information (målt effekt for de 19 hold: 52,7 → 51,6).
 *   2. En milepæl uden mål-sæson kan ikke evalueres, og et gættet årstal på et
 *      spiller-vendt mål er værre end ingen milepæl.
 *
 * 1-års-planer udelades ALDRIG af denne regel. `pending` er den normale tilstand
 * for et 1-års-board midt i sæsonskiftet (147 af 208 rækker 17/8), og
 * `current_goals` er stadig det mandat spilleren kører på lige nu.
 */
export function isUnsignedLongPlan(plan = {}) {
  if (plan?.plan_type !== "3yr" && plan?.plan_type !== "5yr") return false;
  const neverSigned = plan?.negotiation_status === "pending";
  const noSeasonWindow = plan?.plan_end_season_number == null;
  const noProgress = Number(plan?.seasons_completed ?? 0) === 0;
  return neverSigned && noSeasonWindow && noProgress;
}

/**
 * Confidence ved migration fra de 3 gamle planer.
 *
 * 32 hold i prod mangler en 3-års-plan og 24 mangler en 5-års-plan (målt 17/8).
 * Vægtene RENORMALISERES derfor over de planer der faktisk findes, alternativet
 * (behandl manglende plan som 0) ville straffe hold for noget de ikke har gjort,
 * og det er præcis den slags "uforskyldt fald" #3095-princippet forbyder.
 *
 * Returnerer både tallet og kvitteringen for tallet (spec §2: kvittering for alt).
 */
export function computeMigratedConfidence(satisfactions = {}) {
  const inputs = {};
  let weightSum = 0;
  let weightedSum = 0;

  for (const [planType, weight] of Object.entries(MANDATE_MIGRATION_WEIGHTS)) {
    const raw = satisfactions?.[planType];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const value = clampSatisfaction(Number(raw));
    inputs[planType] = value;
    weightSum += weight;
    weightedSum += value * weight;
  }

  // Intet at regne på (hold uden nogen plan overhovedet) → neutral 50, samme
  // startværdi som board_profiles bruger i dag.
  if (weightSum <= 0) {
    return {
      confidence: 50,
      source: {
        method: "migration_v1",
        weights: { ...MANDATE_MIGRATION_WEIGHTS },
        inputs: {},
        renormalized: false,
        fallback: "no_plans_neutral_50",
      },
    };
  }

  const renormalized = Math.abs(weightSum - 1) > 1e-9;
  const effectiveWeights = {};
  for (const planType of Object.keys(inputs)) {
    effectiveWeights[planType] = roundNumber(MANDATE_MIGRATION_WEIGHTS[planType] / weightSum);
  }

  return {
    confidence: clampSatisfaction(weightedSum / weightSum),
    source: {
      method: "migration_v1",
      weights: { ...MANDATE_MIGRATION_WEIGHTS },
      effective_weights: effectiveWeights,
      inputs,
      renormalized,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Tillids-trappen (ejer-beslutning 6 af 7/8)
// ---------------------------------------------------------------------------
// Forhandlingsmagt er optjent: <30 → 1 justering, 30-74 → 2 (standard), ≥75 → 3
// justeringer OG bestyrelsen strækker sig længere i modtilbud.
export const TRUST_LADDER = Object.freeze([
  { minConfidence: 75, adjustments: 3, counterofferGenerosity: 1.25, key: "trusted" },
  { minConfidence: 30, adjustments: 2, counterofferGenerosity: 1.00, key: "standard" },
  { minConfidence: 0, adjustments: 1, counterofferGenerosity: 0.80, key: "strained" },
]);

export function getTrustTier(confidence) {
  const value = Number.isFinite(Number(confidence)) ? clampSatisfaction(Number(confidence)) : 50;
  return TRUST_LADDER.find((tier) => value >= tier.minConfidence) ?? TRUST_LADDER[TRUST_LADDER.length - 1];
}

export function adjustmentsAllowedFor(confidence) {
  return getTrustTier(confidence).adjustments;
}

/**
 * Hvor meget bestyrelsen strækker sig i et modtilbud. 1,0 = standard-spændet;
 * >1 gør Easier billigere og Stretch mere generøs; <1 strammer begge veje.
 * Bruges af årsmøde-API'et i fase 1b-resten (ikke live endnu).
 */
export function counterofferGenerosityFor(confidence) {
  return getTrustTier(confidence).counterofferGenerosity;
}

// ---------------------------------------------------------------------------
// 3. Kategoriscorer på relationen
// ---------------------------------------------------------------------------
export const MANDATE_CATEGORIES = Object.freeze(["results", "economy", "identity", "ranking"]);

/**
 * De 4 kategoriscorer 0-100 for relationen.
 *
 * `calculatePerformanceBreakdown` i boardEvaluation.js producerer allerede
 * `categories[key].score` i 0-1,15-skalaen (over 1 = overpræstation). Vi klipper
 * til 0-100 for lagring, fordi tallet er spiller-vendt: et metter der kan gå over
 * 100 % er præcis den slags "3×100 % = 56 %"-forvirring reworket skal fjerne.
 *
 * Kategorier uden mål udelades helt (null-visning i UI'et) frem for at blive
 * gættet til 50, et opfundet tal uden kvittering er værre end ingen visning.
 */
export function buildCategoryScores(breakdownCategories = {}) {
  const out = {};
  for (const key of MANDATE_CATEGORIES) {
    const entry = breakdownCategories?.[key];
    const score = entry?.score;
    if (score == null || !Number.isFinite(Number(score))) continue;
    out[key] = clamp(Math.round(Number(score) * 100), 0, 100);
  }
  return out;
}

/**
 * Kategoriscorer ved MIGRATION. Hold har op til 3 planer, hver med sine egne
 * kategoriscorer. Vi bruger de samme 50/30/20-vægte som confidence, så tallet
 * på metrene og tallet i toppen kommer fra samme regnestykke, kravet
 * "confidence-forklaring identisk på dashboard og boardroom" starter her.
 */
export function mergeCategoryScoresForMigration(perPlanCategoryScores = {}) {
  const out = {};
  for (const category of MANDATE_CATEGORIES) {
    let weightSum = 0;
    let weightedSum = 0;
    for (const [planType, weight] of Object.entries(MANDATE_MIGRATION_WEIGHTS)) {
      const value = perPlanCategoryScores?.[planType]?.[category];
      if (value == null || !Number.isFinite(Number(value))) continue;
      weightSum += weight;
      weightedSum += Number(value) * weight;
    }
    if (weightSum > 0) out[category] = clamp(Math.round(weightedSum / weightSum), 0, 100);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Visions-milepæle
// ---------------------------------------------------------------------------
// Grandfathering (#1234): en milepæl beholder den slut-sæson den havde i sin
// oprindelige plan. Ingen spiller får sit mål rykket nærmere ved migrationen.

// Mål-typer der er LØBENDE forpligtelser (holdstørrelse, gældfrihed) frem for
// noget man "når" på et tidspunkt. De bliver stadig milepæle, vi smider ikke
// spillerdata væk, men de er ikke headline på tidslinjen, fordi "ingen gæld i
// sæson 6" ikke er en fortælling om hvor klubben er på vej hen.
const CONTINUOUS_OBLIGATION_GOAL_TYPES = new Set([
  "no_outstanding_debt",
  "min_riders",
  "positive_balance",
  "min_u25_riders",
]);

/**
 * Er milepælen stor nok til at bære tidslinjen? Reglen er bevidst konservativ:
 * headline = ikke en løbende forpligtelse OG (required/bonus-importance eller
 * fuld vægt). Alt andet foldes sammen i fase 2's UI. Fjerner INGEN data.
 */
export function isHeadlineMilestone(goal = {}) {
  if (CONTINUOUS_OBLIGATION_GOAL_TYPES.has(goal?.type)) return false;
  const importance = goal?.importance;
  if (importance === "required" || importance === "bonus") return true;
  return Number(goal?.weight ?? 0) >= 1;
}

/**
 * Nøgle der er stabil på tværs af kørsler, så migrationen er idempotent og en
 * milepæl kan gen-findes uden at afhænge af rækkefølgen i `current_goals`.
 */
export function buildMilestoneKey({ origin, goal, targetSeasonNumber, index }) {
  const type = goal?.type ?? "unknown";
  const target = goal?.target ?? "na";
  return `${origin}:s${targetSeasonNumber}:${type}:${target}:${index}`;
}

/**
 * Engangs-tillidsslaget ved MISSET milepæl (ejer-beslutning 3).
 *
 * Skaleres efter milepælens vægt, og genbruger målets EGEN `satisfaction_penalty`
 * som grundlag hvor den findes, så straffen er den samme størrelsesorden som den
 * spilleren allerede kender fra planerne. Ingen kaskade: tallet anvendes én gang
 * i mål-sæsonen og påvirker ikke næste mandat.
 *
 * Loft på 15 point: et enkelt misset mål må aldrig alene kaste et hold gennem to
 * konsekvens-lag (40 → 15 ville være netop det).
 */
export const MILESTONE_MISS_MAX_PENALTY = 15;
export const MILESTONE_MISS_DEFAULT_PENALTY = 6;

export function computeMilestoneMissPenalty(goal = {}, weight = 1) {
  const base = Number.isFinite(Number(goal?.satisfaction_penalty))
    ? Number(goal.satisfaction_penalty)
    : MILESTONE_MISS_DEFAULT_PENALTY;
  const scaled = Math.round(base * clamp(Number(weight) || 1, 0, 2));
  return clamp(scaled, 0, MILESTONE_MISS_MAX_PENALTY);
}

/**
 * Belønningen ved NÅET milepæl. Samme kilde (målets egen bonus), samme loft.
 * Belønningsvaluta er kun confidence (ejer-beslutning 4), ingen pengestrøm.
 */
export function computeMilestoneHitReward(goal = {}, weight = 1) {
  const base = Number.isFinite(Number(goal?.satisfaction_bonus))
    ? Number(goal.satisfaction_bonus)
    : MILESTONE_MISS_DEFAULT_PENALTY;
  const scaled = Math.round(base * clamp(Number(weight) || 1, 0, 2));
  return clamp(scaled, 0, MILESTONE_MISS_MAX_PENALTY);
}

/**
 * Oversæt én 3- eller 5-års-plan til visions-milepæle.
 *
 * `plan.plan_end_season_number` er mål-sæsonen. Mangler den (ældre rækker), falder
 * vi tilbage på start + varighed, og hvis heller ikke DET findes, udelades planen
 * og kalderen får den i `skipped`, vi gætter aldrig en sæson for et spiller-vendt mål.
 */
export function planToMilestones(plan = {}, goals = []) {
  const origin = plan?.plan_type === "5yr" ? "5yr" : "3yr";
  const targetSeasonNumber = Number(plan?.plan_end_season_number);
  if (!Number.isFinite(targetSeasonNumber) || targetSeasonNumber <= 0) {
    return { milestones: [], skipped: [{ reason: "missing_plan_end_season_number", origin }] };
  }

  const milestones = (goals || []).map((goal, index) => {
    const weight = Number.isFinite(Number(goal?.weight)) ? Number(goal.weight) : 1;
    return {
      milestone_key: buildMilestoneKey({ origin, goal, targetSeasonNumber, index }),
      goal,
      target_season_number: targetSeasonNumber,
      origin,
      weight: roundNumber(clamp(weight, 0, 2)),
      is_headline: isHeadlineMilestone(goal),
      status: "pending",
    };
  });

  return { milestones, skipped: [] };
}

// ---------------------------------------------------------------------------
// 5. Mandatet fra 1-års-planen
// ---------------------------------------------------------------------------
export const MANDATE_MIN_GOALS = 3;
export const MANDATE_MAX_GOALS = 5;

/**
 * 1-års-planens mål bliver sæsonens mandat UÆNDRET (spec §3.5: "ingen
 * genforhandling påtvinges"). Vi hverken beskærer eller udvider mål-listen ved
 * migrationen, 3-5-reglen gælder mål GENERERET af årsmødet, ikke mål spilleren
 * allerede har forhandlet sig frem til. `goal_count_outside_range` rapporteres i
 * scorecardet så afvigelsen er synlig i stedet for stiltiende rettet.
 */
export function planToMandate(plan = {}, goals = [], { confidence, assignedMembers = null } = {}) {
  // #3514 S-M2a · owner_archetype_key stemples ÉN gang på mandatets mål-JSON
  // hvis kalderen har teamets assignede medlemmer ved hånden (opt-in,
  // bagudkompatibelt no-op ellers). Mål der allerede har feltet rører vi
  // ikke, se boardMembers.js::stampGoalsOwners.
  const rawGoalList = Array.isArray(goals) ? goals : [];
  const goalList = assignedMembers ? stampGoalsOwners(rawGoalList, { assignedMembers }) : rawGoalList;
  return {
    focus: plan?.focus ?? null,
    goals: goalList,
    status: "active",
    adjustments_allowed: adjustmentsAllowedFor(confidence),
    adjustments_used: 0,
    request_used: false,
    extraordinary_request_unlocked: false,
    extraordinary_request_used: false,
    goal_count_outside_range: goalList.length < MANDATE_MIN_GOALS || goalList.length > MANDATE_MAX_GOALS,
    source: {
      method: "migration_v1",
      from_plan_type: "1yr",
      from_board_id: plan?.id ?? null,
      original_negotiation_status: plan?.negotiation_status ?? null,
      trust_tier: getTrustTier(confidence).key,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Konsekvens-bånd: bruges af scorecardet
// ---------------------------------------------------------------------------
// Tærsklerne er UÆNDREDE (spec §3.1: "Konsekvens-lag 1-6: uændrede tærskler, nu
// mod det ENE confidence-tal"). De gentages her frem for at importeres, fordi
// scorecardet skal kunne køre uden at trække hele konsekvens-motoren ind, og
// en test holder de to lister ens.
export const MANDATE_CONSEQUENCE_BANDS = Object.freeze([
  { key: "sponsor_pullout", layer: 5, below: 10 },
  { key: "forced_listing", layer: 4, below: 15 },
  { key: "signing_restriction", layer: 3, below: 30 },
  { key: "salary_cap", layer: 2, below: 40 },
]);

export const MANDATE_BONUS_OFFER_ABOVE = 75;

/**
 * Hvilke konsekvens-lag ville et givet tillidstal udløse? Rent opslag, ingen
 * sideeffekt, scorecardet bruger det til at måle "ingen hold krydser uforskyldt".
 */
export function consequenceLayersFor(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return [];
  return MANDATE_CONSEQUENCE_BANDS.filter((band) => value < band.below).map((band) => band.layer);
}

export function isBonusBand(confidence) {
  return Number(confidence) > MANDATE_BONUS_OFFER_ABOVE;
}

// ---------------------------------------------------------------------------
// 7. Årsmødets justeringer (Easier / Keep / Stretch — spec §4.2, #4557)
// ---------------------------------------------------------------------------

/** Justerings-budget: Easier og Stretch koster 1 hver, Keep koster 0. */
export function goalAdjustmentCost(choice) {
  return choice === "easier" || choice === "stretch" ? 1 : 0;
}

function pickMandateOptionFields(goal) {
  return {
    target: goal.target,
    label: goal.label,
    satisfaction_bonus: goal.satisfaction_bonus ?? 0,
    satisfaction_penalty: goal.satisfaction_penalty ?? 0,
  };
}

/**
 * De tre forudberegnede valg (Easier/Keep/Stretch) for ét mandat-mål — rå
 * data til `GET /board/meeting` (spec §4.8), så frontend aldrig selv skal
 * kende regnestykket. `null` for easier/stretch betyder: knappen er
 * deaktiveret, ingen reel lempelse/stramning mulig for netop dette mål
 * (#3012-klassen — aldrig et dødt klik).
 */
export function buildMandateGoalOptions(goal, { generosity = 1.0 } = {}) {
  const enrichedGoal = addGoalMetadata(goal);
  const easier = buildNegotiatedGoal(enrichedGoal);
  const stretch = buildStretchGoal(enrichedGoal, { generosity });
  return {
    easier: easier ? pickMandateOptionFields(easier) : null,
    keep: pickMandateOptionFields(enrichedGoal),
    stretch: stretch ? pickMandateOptionFields(stretch) : null,
  };
}

export class MandateAdjustmentBudgetError extends Error {
  constructor(used, allowed) {
    super(`Mandatets justerings-budget er overskredet: ${used} valgt, ${allowed} tilladt.`);
    this.name = "MandateAdjustmentBudgetError";
    this.status = 409;
    this.errorCode = "board_mandate_adjustment_budget_exceeded";
    this.used = used;
    this.allowed = allowed;
  }
}

/**
 * Anvend manageren valg (Easier/Keep/Stretch pr. mål, ved `goalKey` —
 * `boardGoals.js::buildGoalKey`, indholdsbaseret, IKKE et id) på mandatets
 * mål-liste. SERVERENS autoritative kilde (spec §4.5) — klienten sender kun
 * hensigten, aldrig de færdige tal. Et ukendt/manglende valg for et mål
 * betyder "Keep" (ingen ændring). Håndhæver justerings-budgettet
 * (`adjustments_used <= adjustments_allowed`): kaster
 * `MandateAdjustmentBudgetError` ved brud, så kaldestedet (routen) kan svare
 * 409 uden selv at kende reglen.
 */
export function finalizeMandateGoals({
  goals = [],
  adjustments = [],
  generosity = 1.0,
  adjustmentsAllowed = 0,
} = {}) {
  const choiceByGoalKey = new Map();
  for (const adjustment of adjustments || []) {
    if (!adjustment?.goalKey) continue;
    choiceByGoalKey.set(adjustment.goalKey, adjustment.choice);
  }

  let adjustmentsUsed = 0;
  const finalGoals = (goals || []).map((goal) => {
    const enrichedGoal = addGoalMetadata(goal);
    const choice = choiceByGoalKey.get(buildGoalKey(enrichedGoal)) || "keep";

    if (choice === "easier") {
      const negotiated = buildNegotiatedGoal(enrichedGoal);
      if (negotiated) {
        adjustmentsUsed += goalAdjustmentCost("easier");
        return negotiated;
      }
      return enrichedGoal; // Ingen reel lempelse mulig — no-op, ingen budget brugt.
    }
    if (choice === "stretch") {
      const stretched = buildStretchGoal(enrichedGoal, { generosity });
      if (stretched) {
        adjustmentsUsed += goalAdjustmentCost("stretch");
        return stretched;
      }
      return enrichedGoal; // Ingen reel stramning mulig — no-op, ingen budget brugt.
    }
    return enrichedGoal;
  });

  if (adjustmentsUsed > adjustmentsAllowed) {
    throw new MandateAdjustmentBudgetError(adjustmentsUsed, adjustmentsAllowed);
  }

  return { goals: finalGoals, adjustments_used: adjustmentsUsed };
}
