/**
 * #3514 fase 1b: motor-wiring for mandat-modellen.
 * =================================================
 * Spec: docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md §3.1-3.3
 *
 * INAKTIV I DENNE PR. Ingen funktion herfra kaldes fra en live kodesti. Modulet
 * eksisterer og er testet, men wiringen ind i `boardWeekendFinalization` og
 * `economyEngine`'s sæson-slut sker i den PR der flipper UI'et, bevidst, fordi
 * de to filer kører under løbsweekender, og en ændring dér skal reviewes sammen
 * med den flade der viser resultatet. Kill-switchen (`board_mandate_model_enabled`)
 * er alligevel den bindende gate: alle indgange herfra tjekker den først.
 *
 * De fire ting motoren gør (spec §3):
 *   1. Weekend-opdatering → ÉT confidence-tal (ikke tre).
 *   2. Milepæls-evaluering i mål-sæsonen: engangs-tillidsslag + formandsbeat.
 *   3. Mid-season check-in låser 1 ekstraordinær samtale op.
 *   4. Årsmødets tillids-trappe tildeles ved forhandlingens start.
 *
 * Alt regnestykke ligger i boardMandate.js (ren). Denne fil er I/O + rækkefølge.
 */

import {
  adjustmentsAllowedFor,
  buildCategoryScores,
  computeMilestoneHitReward,
  computeMilestoneMissPenalty,
  getTrustTier,
} from "./boardMandate.js";
import { evaluateGoal } from "./boardGoals.js";
import { clampSatisfaction } from "./boardUtils.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

// ---------------------------------------------------------------------------
// 1. Milepæls-evaluering (ren)
// ---------------------------------------------------------------------------
/**
 * Hvilke milepæle forfalder i denne sæson, og hvad koster/giver de?
 *
 * Ejer-beslutning 3 (7/8): en misset milepæl giver ÉT synligt engangs-tillidsslag
 * skaleret efter vægt. Visionen fortsætter uforstyrret, der er ingen kaskade ind
 * i næste mandat, og en misset milepæl ændrer ikke de øvrige milepæles mål-sæsoner.
 *
 * `isFinalSeason: true` sendes med, fordi milepælen ER sin egen slut-sæson: det er
 * dét år målet skulle være nået. Uden flaget ville de kumulative typer blive
 * pro-rateret og en nået milepæl kunne læses som misset (#2596-fejlklassen).
 */
export function evaluateDueMilestones({
  milestones = [],
  seasonNumber,
  standing,
  team,
  context = {},
} = {}) {
  const season = Number(seasonNumber);
  if (!Number.isFinite(season)) return [];

  return (milestones || [])
    .filter((milestone) => milestone?.status === "pending"
      && Number(milestone?.target_season_number) === season)
    .map((milestone) => {
      const goal = milestone?.goal ?? {};
      const weight = Number(milestone?.weight ?? 1);
      const met = evaluateGoal(goal, standing, team, { ...context, isFinalSeason: true }) === true;
      const delta = met
        ? computeMilestoneHitReward(goal, weight)
        : -computeMilestoneMissPenalty(goal, weight);

      return {
        milestone_id: milestone?.id ?? null,
        milestone_key: milestone?.milestone_key ?? null,
        status: met ? "achieved" : "missed",
        confidence_delta: delta,
        goal_type: goal?.type ?? null,
        goal_label: goal?.label ?? null,
        is_headline: Boolean(milestone?.is_headline),
        // Formandens beat hentes i fase 2 ud fra denne kode + medlemmets arketype;
        // motoren opfinder ikke tekst.
        chairman_beat_key: met
          ? "mandate.milestone.achieved"
          : "mandate.milestone.missed",
      };
    });
}

// ---------------------------------------------------------------------------
// 2. Weekend-opdatering → ét confidence-tal (ren)
// ---------------------------------------------------------------------------
/**
 * Oversæt én sæson-evaluering til den nye relations-tilstand.
 *
 * `evaluateBoardSeason` (boardEvaluation.js) er UÆNDRET og bruges som i dag,
 * clamp-mekanikken og forventnings-baselinen genbruges (spec §3.1: "eksisterende
 * vægte og evaluerings-motor genbruges"). Det eneste nye er at resultatet lander
 * ét sted i stedet for tre, og at kvitteringen følger med tallet.
 */
export function computeRelationUpdateFromEvaluation({
  relation,
  evaluation,
  reasonCategory = "weekend_update",
  raceId = null,
  raceName = null,
} = {}) {
  const before = clampSatisfaction(Number(relation?.confidence ?? 50));
  const delta = Number(evaluation?.feedback?.satisfaction_delta ?? 0);
  const after = clampSatisfaction(before + (Number.isFinite(delta) ? delta : 0));

  return {
    confidence: after,
    category_scores: buildCategoryScores(evaluation?.scoreBreakdown?.categories),
    confidence_source: {
      method: reasonCategory,
      delta: after - before,
      goals_met: evaluation?.goalsMet ?? 0,
      goals_total: Array.isArray(evaluation?.goals) ? evaluation.goals.length : 0,
      overall_score: evaluation?.overallScore ?? null,
    },
    // Kvittering i det FÆLLES feed (board_satisfaction_events), ikke i en ny strøm.
    receipt: {
      satisfaction_before: before,
      satisfaction_after: after,
      satisfaction_delta: after - before,
      goals_met: evaluation?.goalsMet ?? 0,
      goals_total: Array.isArray(evaluation?.goals) ? evaluation.goals.length : 0,
      reason_category: reasonCategory,
      race_id: raceId,
      race_name: raceName,
    },
  };
}

/**
 * Læg milepæls-udfald oveni en confidence-værdi. Rækkefølgen er bindende:
 * sæsonens almindelige evaluering FØRST, milepælene DEREFTER, ellers ville et
 * engangs-slag blive clampet væk af sæson-deltaet og kvitteringen ville vise et
 * tal spilleren aldrig så.
 */
export function applyMilestoneDeltas(confidenceBefore, outcomes = []) {
  let current = clampSatisfaction(Number(confidenceBefore ?? 50));
  const steps = [];
  for (const outcome of outcomes || []) {
    const before = current;
    current = clampSatisfaction(current + Number(outcome?.confidence_delta ?? 0));
    steps.push({
      ...outcome,
      confidence_before: before,
      confidence_after: current,
      // Det FAKTISKE slag efter clamp, det er dét spilleren ser, og dermed dét
      // kvitteringen skal vise. Et hold på 4 tillid kan ikke tabe 10.
      applied_delta: current - before,
    });
  }
  return { confidence: current, steps };
}

// ---------------------------------------------------------------------------
// 3. Tillids-trappen ved årsmødets start
// ---------------------------------------------------------------------------
/**
 * Tildel forhandlingsmagt ud fra confidence PÅ MØDETIDSPUNKTET og frys den.
 * Frysningen er ikke pynt: uden den ville en spiller der taber tillid midt i en
 * forhandling få trukket en justering væk under sig.
 */
export function allocateNegotiationPower(confidence) {
  const tier = getTrustTier(confidence);
  return {
    adjustments_allowed: adjustmentsAllowedFor(confidence),
    counteroffer_generosity: tier.counterofferGenerosity,
    trust_tier: tier.key,
    confidence_at_allocation: clampSatisfaction(Number(confidence ?? 50)),
  };
}

// ---------------------------------------------------------------------------
// 4. I/O: alle indgange er flag-gatede
// ---------------------------------------------------------------------------
/**
 * Hent holdets relation. Returnerer null hvis flaget er off, så en kalder der
 * glemmer at tjekke flaget ikke ved et uheld kan begynde at læse den nye model.
 */
export async function loadRelation(supabase, teamId, { isBetaTester = false } = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;

  const { data, error } = await supabase
    .from("board_relations")
    .select("id, team_id, confidence, category_scores, confidence_source, last_event_at")
    .eq("team_id", teamId)
    .maybeSingle();

  if (error) throw new Error(`board_relations lookup failed: ${error.message}`);
  return data ?? null;
}

/**
 * Skriv en ny confidence + kvittering. Ét kald = ét tal + én kvittering, aldrig
 * det ene uden det andet, det er hele pointen med "kvittering for alt", og det
 * er grunden til at de to skrivninger ligger i samme funktion.
 */
export async function persistConfidenceChange(supabase, {
  relationId,
  teamId,
  seasonId,
  boardId = null,
  mandateId = null,
  milestoneId = null,
  confidence,
  categoryScores,
  confidenceSource,
  receipt,
} = {}) {
  ensureSupabase(supabase);

  const now = new Date().toISOString();
  const update = {
    confidence: clampSatisfaction(Number(confidence)),
    confidence_source: confidenceSource ?? {},
    last_event_at: now,
    updated_at: now,
  };
  if (categoryScores && Object.keys(categoryScores).length > 0) {
    update.category_scores = categoryScores;
  }

  const { error: relationError } = await supabase
    .from("board_relations")
    .update(update)
    .eq("id", relationId);
  if (relationError) throw new Error(`board_relations update failed: ${relationError.message}`);

  if (!receipt) return { confidence: update.confidence, receipt_written: false };

  const { error: eventError } = await supabase
    .from("board_satisfaction_events")
    .insert({
      board_id: boardId,
      team_id: teamId,
      season_id: seasonId,
      mandate_id: mandateId,
      milestone_id: milestoneId,
      ...receipt,
    });
  // En manglende kvittering er en RIGTIG fejl, ikke en logline: et tal der har
  // flyttet sig uden kvittering er præcis den tilstand reworket skal afskaffe.
  if (eventError) throw new Error(`board_satisfaction_events insert failed: ${eventError.message}`);

  return { confidence: update.confidence, receipt_written: true };
}

/**
 * Mid-season check-in låser 1 ekstraordinær samtale op (ejer-beslutning 5).
 * Idempotent: kalder man to gange i samme sæson, låses der ikke to op.
 */
export async function unlockExtraordinaryRequest(supabase, { mandateId } = {}) {
  ensureSupabase(supabase);
  const { data, error } = await supabase
    .from("board_mandates")
    .update({ extraordinary_request_unlocked: true, updated_at: new Date().toISOString() })
    .eq("id", mandateId)
    .eq("status", "active")
    .eq("extraordinary_request_unlocked", false)
    .select("id");

  if (error) throw new Error(`board_mandates unlock failed: ${error.message}`);
  return { unlocked: Array.isArray(data) ? data.length > 0 : Boolean(data) };
}
