// #2310 · Board S4 — fuld transparens-UX. Rene visnings-beregningsfunktioner
// (ingen DB-adgang) delt mellem /api/board/status og eventuelle andre callers.
// Genbruger eksisterende tærskler/mekanik 1:1 — ingen ny satisfactions-formel.

import { CONSEQUENCE_CONSTANTS } from "./boardConsequences.js";
import { satisfactionToModifier } from "./boardEvaluation.js";

/**
 * Punkt 4 · afstand til bonustilbud (lag 6). Genbruger de samme tærskler som
 * boardConsequences.isBonusOfferEligible, men returnerer AFSTAND i stedet for
 * kun en boolean, så UI'et kan vise "2 mål fra et bonustilbud" fremfor kun ja/nej.
 */
export function computeBonusOfferProgress({ satisfaction, goalsMet, goalsTotal } = {}) {
  const { SATISFACTION_THRESHOLDS, BONUS_OFFER_GOALS_THRESHOLD } = CONSEQUENCE_CONSTANTS;
  const sat = Number.isFinite(Number(satisfaction)) ? Number(satisfaction) : 0;
  const met = Number.isFinite(Number(goalsMet)) ? Number(goalsMet) : 0;
  const total = Number.isFinite(Number(goalsTotal)) && Number(goalsTotal) > 0 ? Number(goalsTotal) : 0;

  const satisfactionOk = sat > SATISFACTION_THRESHOLDS.BONUS_OFFER;
  const satisfactionGap = satisfactionOk ? 0 : Math.max(0, SATISFACTION_THRESHOLDS.BONUS_OFFER - sat + 1);
  const goalsNeededCount = total > 0 ? Math.ceil(total * BONUS_OFFER_GOALS_THRESHOLD) : null;
  const goalsGap = goalsNeededCount != null ? Math.max(0, goalsNeededCount - met) : null;
  const eligible = satisfactionOk && total > 0 && (met / total) >= BONUS_OFFER_GOALS_THRESHOLD;

  return {
    eligible,
    satisfaction_ok: satisfactionOk,
    satisfaction_gap: satisfactionGap,
    goals_met: met,
    goals_total: total,
    goals_needed: goalsNeededCount,
    goals_gap: goalsGap,
    satisfaction_threshold: SATISFACTION_THRESHOLDS.BONUS_OFFER,
    goals_threshold_pct: Math.round(BONUS_OFFER_GOALS_THRESHOLD * 100),
  };
}

/**
 * Punkt 7 · lag 1 (passiv sponsor-modifier) lever i satisfactionToModifier og
 * persisteres på board_profiles.budget_modifier — vises hidtil INGEN steder
 * (kun lag 2-6 er synlige i BoardConsequencesPanel). Ren visnings-mapping.
 */
export function computePassiveModifierInfo(board) {
  const satisfaction = Number.isFinite(Number(board?.satisfaction)) ? Number(board.satisfaction) : 50;
  const modifier = Number.isFinite(Number(board?.budget_modifier))
    ? Number(board.budget_modifier)
    : satisfactionToModifier(satisfaction);
  const pct = Math.round((modifier - 1) * 100);
  let band = "neutral";
  if (satisfaction >= 80) band = "strong_boost";
  else if (satisfaction >= 60) band = "boost";
  else if (satisfaction >= 40) band = "neutral";
  else if (satisfaction >= 20) band = "penalty";
  else band = "strong_penalty";
  return { satisfaction, modifier, pct, band };
}
