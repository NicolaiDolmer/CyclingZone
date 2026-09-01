/**
 * #3514 fase 1-rest: motor-wiring for mandat-modellen.
 * =================================================
 * Spec: docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md §3.1-3.3
 * Addendum (A2/A7): docs/superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md
 *
 * WIRET BAG KILL-SWITCH (fase 1-rest, 1/9). `applyWeekendSync`/`applySeasonEndSync`/
 * `unlockExtraordinaryRequestForTeam` er de tre indgange `boardWeekendFinalization.js`,
 * `economyEngine.js` og `boardMidSeason.js` kalder. Alle tre tjekker kill-switchen
 * (`board_mandate_model_enabled`) FØRST og returnerer `null` med det samme når den
 * er 'off' — ingen anden læsning eller skrivning sker. OFF er stadig bit-for-bit
 * nuværende adfærd: board_profiles forbliver den flade spilleren ser, disse
 * funktioner skriver KUN til skyggemodellens egne tabeller (board_relations,
 * board_vision_milestones, board_satisfaction_events.mandate_id/milestone_id).
 *
 * De fire ting motoren gør (spec §3):
 *   1. Weekend-opdatering → ÉT confidence-tal (ikke tre).
 *   2. Milepæls-evaluering: forfaldne i mål-sæsonen (engangs-tillidsslag +
 *      formandsbeat) OG tidligt nåede (A7: "fejr straks + fyld op").
 *   3. Mid-season check-in låser 1 ekstraordinær samtale op.
 *   4. Årsmødets tillids-trappe tildeles ved forhandlingens start (ren,
 *      `allocateNegotiationPower` — wires ind i årsmøde-API'et, som ikke er en
 *      del af denne PR, jf. GRÆNSER).
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
import { evaluateGoalProgress } from "./boardGoals.js";
import { clampSatisfaction } from "./boardUtils.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

// ---------------------------------------------------------------------------
// 1. Milepæls-evaluering (ren)
// ---------------------------------------------------------------------------
/**
 * Er milepælens mål opfyldt LIGE NU, uanset om vi er i mål-sæsonen?
 *
 * Genbruger `evaluateGoalProgress`s `met`-felt (boardGoals.js) i stedet for
 * `evaluateGoal` direkte: det er den samme "fuldt nået"-regel BoardPage allerede
 * bruger til afkrydsning, og den ene der korrekt håndterer kumulative
 * stage_wins/gc_wins-mål (som `evaluateGoal` selv returnerer `null` for,
 * uanset `isFinalSeason` — de tælles kun via `cumulativeStats`, #4377-klassen).
 * At bruge to forskellige "er den nået"-regler i mandat-motoren og på
 * BoardPage ville genskabe præcis den slags kontekst-drift reworket findes
 * for at fjerne.
 */
function isMilestoneGoalMet(milestone, { standing, team, context = {} } = {}) {
  const goal = milestone?.goal ?? {};
  return evaluateGoalProgress(goal, standing, team, { ...context, isFinalSeason: true }).met === true;
}

/**
 * Fælles kvitterings-form for BÅDE rettidig og tidlig milepæls-afgørelse
 * (spec §3.1 punkt 4 / addendum A7). `isEarly` afgør kun `achieved_early` +
 * `slot_open` + hvilken beat-nøgle formanden taler med — regnestykket
 * (belønning/straf, loft på 15) er identisk.
 */
function buildMilestoneOutcome(milestone, { met, isEarly, weight }) {
  const goal = milestone?.goal ?? {};
  const delta = met
    ? computeMilestoneHitReward(goal, weight)
    : -computeMilestoneMissPenalty(goal, weight);

  return {
    milestone_id: milestone?.id ?? null,
    milestone_key: milestone?.milestone_key ?? null,
    status: met ? "achieved" : "missed",
    // A7 (ejer-valg 1/9): en visions-milepæl nået FØR sin mål-sæson lukkes MED
    // DET SAMME i stedet for at vente — "fejr straks + fyld op". Et tomt slot
    // åbnes på tidslinjen; næste årsmøde foreslår en erstatning (fase 2-UI,
    // ikke bygget her — kun data-krogen).
    achieved_early: Boolean(isEarly && met),
    slot_open: Boolean(isEarly && met),
    confidence_delta: delta,
    goal_type: goal?.type ?? null,
    goal_label: goal?.label ?? null,
    is_headline: Boolean(milestone?.is_headline),
    // Formandens beat hentes i fase 2 ud fra denne kode + medlemmets arketype;
    // motoren opfinder ikke tekst.
    chairman_beat_key: met
      ? (isEarly ? "mandate.milestone.achieved_early" : "mandate.milestone.achieved")
      : "mandate.milestone.missed",
  };
}

/**
 * Hvilke milepæle forfalder i denne sæson, og hvad koster/giver de?
 *
 * Ejer-beslutning 3 (7/8): en misset milepæl giver ÉT synligt engangs-tillidsslag
 * skaleret efter vægt. Visionen fortsætter uforstyrret, der er ingen kaskade ind
 * i næste mandat, og en misset milepæl ændrer ikke de øvrige milepæles mål-sæsoner.
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
    .map((milestone) => buildMilestoneOutcome(milestone, {
      met: isMilestoneGoalMet(milestone, { standing, team, context }),
      isEarly: false,
      weight: Number(milestone?.weight ?? 1),
    }));
}

/**
 * A7 (addendum, ejer-valg 1/9): hvilke ENDNU IKKE forfaldne milepæle er
 * allerede opfyldt? "Milepæl nået FØR mål-sæsonen" — evidensen (død bestyrelse
 * = klage nr. 1) er stærkere end da §3.1's "evalueres i mål-sæsonen"-linje blev
 * låst 7/8, så dette er en bevidst, afgrænset genåbning for netop den
 * situation. En misset milepæl rammes ALDRIG her (kun i sin egen mål-sæson,
 * via `evaluateDueMilestones`) — kun tidlig SUCCES fejres tidligt.
 */
export function evaluateEarlyMilestones({
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
      && Number(milestone?.target_season_number) > season
      && isMilestoneGoalMet(milestone, { standing, team, context }))
    .map((milestone) => buildMilestoneOutcome(milestone, {
      met: true,
      isEarly: true,
      weight: Number(milestone?.weight ?? 1),
    }));
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

// ---------------------------------------------------------------------------
// 5. Produktions-indgange: de tre kald boardWeekendFinalization.js,
//    economyEngine.js og boardMidSeason.js foretager. Hver tjekker
//    kill-switchen FØRST og returnerer `null` med det samme når den er 'off'
//    — ingen anden læsning/skrivning sker, og kalderen behøver ikke selv
//    tjekke flaget (én kilde til "er dette wiret", ikke tre).
// ---------------------------------------------------------------------------

async function fetchRelationRow(supabase, teamId) {
  const { data, error } = await supabase
    .from("board_relations")
    .select("id, team_id, confidence, category_scores, confidence_source")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(`board_relations lookup failed: ${error.message}`);
  return data ?? null;
}

async function fetchActiveMandateRow(supabase, teamId, seasonId) {
  if (!seasonId) return null;
  const { data, error } = await supabase
    .from("board_mandates")
    .select("id")
    .eq("team_id", teamId)
    .eq("season_id", seasonId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`board_mandates lookup failed: ${error.message}`);
  return data ?? null;
}

async function fetchPendingMilestones(supabase, teamId) {
  const { data, error } = await supabase
    .from("board_vision_milestones")
    .select("id, milestone_key, goal, target_season_number, origin, weight, is_headline, status")
    .eq("team_id", teamId)
    .eq("status", "pending");
  if (error) throw new Error(`board_vision_milestones lookup failed: ${error.message}`);
  return data ?? [];
}

/**
 * Skriv ÉT milepæls-udfald: opdatér milepælen selv (status/achieved_early/
 * slot_open) OG confidence + kvittering i samme funktion, samme princip som
 * `persistConfidenceChange` — aldrig et tal uden sin kvittering.
 */
async function persistMilestoneOutcome(supabase, { teamId, seasonId, mandateId, relationId, step }) {
  const now = new Date().toISOString();
  const { error: milestoneError } = await supabase
    .from("board_vision_milestones")
    .update({
      status: step.status,
      evaluated_at: now,
      confidence_delta: step.applied_delta,
      achieved_early: Boolean(step.achieved_early),
      slot_open: Boolean(step.slot_open),
      updated_at: now,
    })
    .eq("id", step.milestone_id);
  if (milestoneError) throw new Error(`board_vision_milestones update failed: ${milestoneError.message}`);

  await persistConfidenceChange(supabase, {
    relationId,
    teamId,
    seasonId,
    mandateId,
    milestoneId: step.milestone_id,
    confidence: step.confidence_after,
    receipt: {
      satisfaction_before: step.confidence_before,
      satisfaction_after: step.confidence_after,
      satisfaction_delta: step.applied_delta,
      goals_met: step.status === "achieved" ? 1 : 0,
      goals_total: 1,
      reason_category: step.chairman_beat_key,
    },
  });
}

/**
 * Weekend-indgang (kaldes fra boardWeekendFinalization.js, én gang pr.
 * ikke-baseline 1yr-board pr. finaliseret løbsweekend).
 *
 * `evaluation` er FULDE returværdien af `evaluateBoardSeason` (boardEvaluation.js)
 * for holdets 1yr-board — den evaluering flag-off-stien allerede regner og
 * bruger til at opdatere `board_profiles.satisfaction`. Vi genbruger den 1:1
 * (spec §3.1: "eksisterende vægte og evalueringsmotor genbruges") i stedet for
 * at regne noget nyt.
 *
 * Returnerer `null` uden nogen læsning/skrivning når flaget er off ELLER holdet
 * ikke har en skyggerelation endnu (fx oprettet efter seneste skyggedata-
 * genopbygning — kendt afgrænsning, se scripts/rebuild-board-mandate-shadow-3514.mjs).
 */
export async function applyWeekendSync(supabase, {
  teamId,
  seasonId,
  evaluation,
  raceId = null,
  raceName = null,
  isBetaTester = false,
} = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;
  if (!evaluation) return null;

  const relation = await fetchRelationRow(supabase, teamId);
  if (!relation) return { skipped: "no_shadow_relation" };

  const mandate = await fetchActiveMandateRow(supabase, teamId, seasonId);
  const update = computeRelationUpdateFromEvaluation({
    relation,
    evaluation,
    reasonCategory: "weekend_update",
    raceId,
    raceName,
  });

  await persistConfidenceChange(supabase, {
    relationId: relation.id,
    teamId,
    seasonId,
    mandateId: mandate?.id ?? null,
    confidence: update.confidence,
    categoryScores: update.category_scores,
    confidenceSource: update.confidence_source,
    receipt: update.receipt,
  });

  return { confidence: update.confidence };
}

/**
 * Sæson-slut-indgang (kaldes fra economyEngine.js's processTeamSeasonEnd, ÉN
 * gang pr. hold, EFTER at alle holdets board_profiles-planer er behandlet).
 *
 * Rækkefølgen indeni er bindende (se applyMilestoneDeltas-kommentaren):
 *   1. Sæsonens ordinære 1yr-evaluering (mandateEvaluation) FØRST.
 *   2. Milepælene (forfaldne + tidligt nåede, A7) DEREFTER, oven på det
 *      allerede opdaterede tal.
 *
 * `milestoneContexts` er én { planType: '3yr'|'5yr', context } pr. langsigtet
 * board holdet har, med den SAMME `context` som `economyEngine.js` allerede
 * byggede til at evaluere DET boards egen `evaluateBoardSeason`-kald — en
 * milepæl skal evalueres med den kontekst (cumulative stats, planStart*-felter)
 * den plan den kom fra faktisk havde, ikke en gættet fælles kontekst.
 */
export async function applySeasonEndSync(supabase, {
  teamId,
  seasonId,
  seasonNumber,
  standing,
  team,
  mandateEvaluation = null,
  milestoneContexts = [],
  isBetaTester = false,
} = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;

  const relation = await fetchRelationRow(supabase, teamId);
  if (!relation) return { skipped: "no_shadow_relation" };

  const mandate = await fetchActiveMandateRow(supabase, teamId, seasonId);
  let confidence = clampSatisfaction(Number(relation.confidence ?? 50));

  if (mandateEvaluation) {
    const update = computeRelationUpdateFromEvaluation({
      relation,
      evaluation: mandateEvaluation,
      reasonCategory: "season_end",
    });
    confidence = update.confidence;

    await persistConfidenceChange(supabase, {
      relationId: relation.id,
      teamId,
      seasonId,
      mandateId: mandate?.id ?? null,
      confidence: update.confidence,
      categoryScores: update.category_scores,
      confidenceSource: update.confidence_source,
      receipt: update.receipt,
    });
  }

  const milestones = milestoneContexts.length ? await fetchPendingMilestones(supabase, teamId) : [];
  const outcomes = [];
  const seen = new Set();
  for (const { planType, context } of milestoneContexts) {
    const originMilestones = milestones.filter((m) => m.origin === planType);
    const due = evaluateDueMilestones({ milestones: originMilestones, seasonNumber, standing, team, context });
    const early = evaluateEarlyMilestones({ milestones: originMilestones, seasonNumber, standing, team, context });
    for (const outcome of [...due, ...early]) {
      if (outcome?.milestone_id && !seen.has(outcome.milestone_id)) {
        seen.add(outcome.milestone_id);
        outcomes.push(outcome);
      }
    }
  }

  if (outcomes.length) {
    const applied = applyMilestoneDeltas(confidence, outcomes);
    for (const step of applied.steps) {
      await persistMilestoneOutcome(supabase, {
        teamId, seasonId, mandateId: mandate?.id ?? null, relationId: relation.id, step,
      });
    }
    confidence = applied.confidence;
  }

  return { confidence, milestones_evaluated: outcomes.length };
}

/**
 * Mid-season-indgang (kaldes fra boardMidSeason.js for ALLE hold der når
 * midpoint-checkpointet, uanset om selve check-in-banneren udløses).
 * Ejer-beslutning 5: check-in'et låser 1 ekstraordinær samtale op — idempotent
 * via `unlockExtraordinaryRequest`s `extraordinary_request_unlocked = false`-filter.
 */
export async function unlockExtraordinaryRequestForTeam(supabase, {
  teamId,
  seasonId,
  isBetaTester = false,
} = {}) {
  ensureSupabase(supabase);
  if (!await isBoardMandateModelEnabled(supabase, { isBetaTester })) return null;

  const mandate = await fetchActiveMandateRow(supabase, teamId, seasonId);
  if (!mandate) return { unlocked: false, reason: "no_active_mandate" };
  return unlockExtraordinaryRequest(supabase, { mandateId: mandate.id });
}
