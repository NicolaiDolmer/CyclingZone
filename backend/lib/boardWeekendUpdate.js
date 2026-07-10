// #1187-B · Løbende bestyrelses-tilfredshed — ren weekend-opdaterings-mekanik.
// =============================================================================
// Design-beslutninger LÅST af ejeren 11/6 (issue #1187, design-session-kommentar):
//   1. Opdaterings-trigger: pr. løbsweekend ved weekend-finalization (wiring sker
//      IKKE her — modulet er rene funktioner uden DB-adgang).
//   2. Clamp: ±5 point pr. weekend (WEEKEND_SATISFACTION_CLAMP). En enkelt
//      katastrofe-weekend kan aldrig alene udløse hårde konsekvenser.
//   3. Hårde konsekvens-lag (salary cap → signing-restriktion → tvangssalg →
//      pullout) trigges KUN ved checkpoints: mid-season + sæson-slut
//      (getConsequenceCheckpoint). Den bløde genforhandlings-trigger (<50,
//      boardMidSeason.js) fortsætter uændret.
//   4. Sponsor-/budget-modifier følger LIVE pr. weekend via satisfactionToModifier.
//   5. board_test_mode (#805) fryser fortsat økonomi-effekten: satisfaction må
//      bevæge sig i test, men modifier-effekten neutraliseres
//      (resolveWeekendEconomyModifier).
//
// Mekanik: target-tracking mod evaluateBoardSeason (genbrug 1:1, INGEN ny
// satisfactions-formel). Hver weekend beregnes den fulde sæson-evaluering mod
// den AKTUELLE kumulative standing; target = sæson-start-satisfaction +
// evaluateBoardSeason's satisfaction_delta. Satisfaction bevæger sig mod target
// med højst ±clamp pr. weekend. Konsekvens: efter sæsonens sidste weekend er
// satisfaction konvergeret (eller på vej) mod præcis det tal dagens sæson-slut-
// evaluering ville give — sæson-slut-checkpointet introducerer derfor ikke et
// ekstra spring oven i weekend-bevægelsen.
//
// Genbruges 1:1 af dry-run-harnesset (scripts/boardSatisfactionHarness.js, kører
// FØR live-wiring per simulér-før-ship-reglen) og af den senere wiring i
// weekend-finalization. INTET her skriver til DB.

import { evaluateBoardSeason, satisfactionToModifier } from "./boardEvaluation.js";
import { clamp, clampSatisfaction } from "./boardUtils.js";

// Ejer-beslutning 11/6: ±5 point pr. løbsweekend (nedad-bevægelse). Bevaret som
// downside-grænsen — hårde konsekvenser er checkpoint-gatede og kalibreret mod
// denne værdi (boardSatisfactionHarness.js's konsekvens-rate-gate), så en
// hurtigere NEDAD-bevægelse ville alene forøge antallet af hold der rammer
// hårde lag (verificeret empirisk: ±8 symmetrisk gav 22-32% mod målet ≤10%).
export const WEEKEND_SATISFACTION_CLAMP = 5;

// #2309 · "Hurtigere tilfredsheds-respons" — ejer-ønske: boardet skal reagere
// hurtigere på FREMGANG end den nuværende ±5-clamp tillader, uden at gøre
// nedturen hårdere (det ville modarbejde konsekvens-rate-gaten, se ovenfor).
// Asymmetrisk clamp: opad-bevægelse (holdet præsterer over sin løbende
// tilfredshed) får en højere grænse end nedad. Effekt: et hold der vender en
// dårlig start indhenter boardets tillid ~60% hurtigere, mens en katastrofe-
// weekend stadig kun kan koste holdet op til ±5 point (uændret risiko-profil).
export const WEEKEND_SATISFACTION_CLAMP_UP = 8;

/**
 * #1451 · "Hvorfor"-kategori for et weekend-event. Positiv bevægelse drives af
 * den stærkeste kategori, negativ af den svageste; flad bevægelse har ingen grund.
 * Ren funktion — ingen DB. Bruges af weekend-finalization-loggen + UI'et.
 */
export function resolveReasonCategory({ evaluation, satisfactionDelta } = {}) {
  const feedback = evaluation?.feedback;
  if (!feedback) return null;
  if (satisfactionDelta > 0) return feedback.strongest_category ?? null;
  if (satisfactionDelta < 0) return feedback.weakest_category ?? null;
  return null;
}

export const CHECKPOINT_KINDS = {
  MID_SEASON: "mid_season",
  SEASON_END: "season_end",
};

/**
 * Beregn ny satisfaction + modifier efter en finaliseret løbsweekend.
 *
 * @param {object} args
 * @param {object} args.board     — board_profiles-row (plan). `satisfaction` =
 *                                  værdien FØR denne weekend (den løbende værdi).
 * @param {object} args.standing  — kumulativ sæson-standing til og med weekenden
 *                                  (rank_in_division, stage_wins, gc_wins, ...).
 * @param {object} args.team      — team inkl. `riders` (samme form som
 *                                  processTeamSeasonEnd bruger).
 * @param {object} [args.context] — evaluateBoardSeason-context (planDuration,
 *                                  seasonsCompleted, cumulativeStats, ...).
 * @param {number} [args.seasonStartSatisfaction] — satisfaction ved sæson-start
 *                                  (anker for target). Default: board.satisfaction
 *                                  — korrekt ved første weekend; live-wiring skal
 *                                  give sæson-start-værdien eksplicit fra weekend 2.
 * @param {number} [args.clampLimit] — maks. NEDAD-bevægelse pr. weekend (default ±5).
 * @param {number} [args.clampLimitUp] — maks. OPAD-bevægelse pr. weekend
 *                                  (default ±8, #2309 — hurtigere respons på
 *                                  fremgang uden at forøge downside-risikoen).
 * @returns {object|null} update-resultat, eller null hvis board mangler.
 */
export function computeWeekendSatisfactionUpdate({
  board,
  standing,
  team,
  context = {},
  seasonStartSatisfaction = null,
  clampLimit = WEEKEND_SATISFACTION_CLAMP,
  clampLimitUp = WEEKEND_SATISFACTION_CLAMP_UP,
} = {}) {
  if (!board) return null;

  const current = toFiniteOr(board.satisfaction, 50);
  const anchor = toFiniteOr(seasonStartSatisfaction, current);
  const downLimit = Math.max(0, toFiniteOr(clampLimit, WEEKEND_SATISFACTION_CLAMP));
  const upLimit = Math.max(downLimit, toFiniteOr(clampLimitUp, WEEKEND_SATISFACTION_CLAMP_UP));

  // Genbrug af den eksisterende sæson-evaluering 1:1. feedback.satisfaction_delta
  // er uafhængig af board.satisfaction (ren funktion af score vs. expectation),
  // så target er stabilt uanset hvor langt den løbende værdi allerede er flyttet.
  const evaluation = evaluateBoardSeason({ board, standing, team, context });
  const seasonDelta = toFiniteOr(evaluation?.feedback?.satisfaction_delta, 0);
  const targetSatisfaction = clampSatisfaction(anchor + seasonDelta);

  const rawStep = targetSatisfaction - current;
  // #2309 · asymmetrisk grænse: opad-bevægelse (rawStep > 0) må bruge det
  // højere upLimit, nedad-bevægelse holder sig til det uændrede downLimit.
  const limit = rawStep >= 0 ? upLimit : downLimit;
  const appliedStep = clamp(rawStep, -downLimit, upLimit);
  const newSatisfaction = clampSatisfaction(current + appliedStep);

  return {
    previousSatisfaction: current,
    seasonStartSatisfaction: anchor,
    seasonDelta,
    targetSatisfaction,
    rawStep,
    appliedDelta: newSatisfaction - current,
    clampedByLimit: Math.abs(rawStep) > limit,
    newSatisfaction,
    newModifier: satisfactionToModifier(newSatisfaction),
    goalsMet: evaluation?.goalsMet ?? 0,
    goalsTotal: (evaluation?.goals || []).length,
    evaluation,
  };
}

/**
 * Beslutning 5 (#805-samspil): økonomi-effekten af modifieren neutraliseres i
 * board_test_mode. Satisfaction/modifier må gerne bevæge sig synligt i UI —
 * men den modifier der rammer udbetalinger skal være 1.0 i test-mode.
 * Spejler processSeasonStart's `boardTestMode ? 1.0 : baseModifier`-gren som
 * ren funktion, så weekend-wiring og harness deler præcis samme regel.
 */
export function resolveWeekendEconomyModifier({ modifier, boardTestMode = false } = {}) {
  if (boardTestMode) return 1.0;
  const value = Number(modifier);
  return Number.isFinite(value) && value > 0 ? value : 1.0;
}

/**
 * Beslutning 3: hårde konsekvens-lag evalueres kun ved checkpoints.
 * Returnerer checkpoint-typen for en netop finaliseret weekend, ellers null.
 *  - mid_season: weekend nr. floor(total/2) (matcher boardMidSeason-midpoint-idéen)
 *  - season_end: sæsonens sidste weekend
 * Ved totalWeekends=1 er den ene weekend sæson-slut (intet mid-checkpoint).
 */
export function getConsequenceCheckpoint({ completedWeekends, totalWeekends } = {}) {
  const total = Math.max(1, Math.round(toFiniteOr(totalWeekends, 0)));
  const done = Math.round(toFiniteOr(completedWeekends, 0));
  if (done <= 0) return null;
  if (done >= total) return CHECKPOINT_KINDS.SEASON_END;
  const mid = Math.floor(total / 2);
  if (mid > 0 && done === mid) return CHECKPOINT_KINDS.MID_SEASON;
  return null;
}

export function isConsequenceCheckpoint(args) {
  return getConsequenceCheckpoint(args) !== null;
}

function toFiniteOr(value, fallback) {
  // Eksplicit null/undefined-tjek: Number(null) er 0 (finite) og ville ellers
  // gøre et udeladt seasonStartSatisfaction til anker 0 i stedet for fallback.
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
