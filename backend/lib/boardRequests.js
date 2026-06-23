import {
  VALID_BOARD_FOCUSES,
  VALID_BOARD_PLAN_TYPES,
  VALID_BOARD_REQUEST_TYPES,
  BOARD_REQUEST_DEFINITIONS,
} from "./boardConstants.js";

// S-02g · Mid-cycle-låsning + window-blokering + MAJOR pivot cool-down (Q-batch 1B + Q-batch 1C).
// Eksporteret som konstanter så tests + frontend hint-tekster kan reference samme tærskler.
export const REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT = 5;       // F5: requests umulige i sidste 5 race-days
export const MID_CYCLE_PROGRESS_THRESHOLD_PCT = 50;          // F6: ≥50% plan-gennemført ELLER
export const MID_CYCLE_SATISFACTION_DELTA_PCT = 30;          // >30% satisfaction-delta åbner re-orientering
export const RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT = 50;    // #915: gen-forhandling låst når ≥50% af sæsonen er kørt
export const MAJOR_PIVOT_REQUEST_TYPES = new Set([           // F4: kun krydsninger youth↔star tæller
  "more_youth_focus",     // major hvis FRA star_signing
  "more_results_focus",   // major hvis FRA youth_development
]);

// S-02g · Tradeoff-låsninger (Q-batch 1B Q16, hardkodet pr. request-type).
// Anvendes ved næste plan-renewal hvis active_season.id matcher tradeoff_active_until_season_id.
export const TRADEOFF_PAYLOADS_BY_REQUEST = {
  lower_results_pressure: { kind: "tighten_identity_riders", delta: 1 },
  ease_identity_requirements: { kind: "raise_sponsor_growth_target", delta_pct: 5 },
  // more_youth_focus + more_results_focus har ALLEREDE inline tradeoff-effekter i resolveBoardRequest
  // (replaceGoal med buildTightenedGoal). Ingen deferred låsning her.
};

export function isMajorPivotRequest({ requestType, currentFocus }) {
  if (!MAJOR_PIVOT_REQUEST_TYPES.has(requestType)) return false;
  if (requestType === "more_youth_focus" && currentFocus === "star_signing") return true;
  if (requestType === "more_results_focus" && currentFocus === "youth_development") return true;
  return false;
}
import {
  deriveTeamIdentityProfile,
  hasStrongNationalCore,
  hasStrongStarProfile,
} from "./boardIdentity.js";
import {
  parseBoardGoals,
  generateBoardGoals,
  buildNegotiatedGoal,
  addGoalMetadata,
  normalizeComparableGoal,
  buildGoalLabel,
} from "./boardGoals.js";
import { calculateBoardPerformance } from "./boardEvaluation.js";

export function isValidBoardFocus(focus) {
  return VALID_BOARD_FOCUSES.includes(focus);
}

export function isValidBoardPlanType(planType) {
  return VALID_BOARD_PLAN_TYPES.includes(planType);
}

export function isValidBoardRequestType(requestType) {
  return VALID_BOARD_REQUEST_TYPES.includes(requestType);
}

export function getBoardRequestDefinition(requestType) {
  const definition = BOARD_REQUEST_DEFINITIONS[requestType];
  if (!definition) return null;

  // #1084 · i18n-koder ved siden af den danske råtekst (frontend resolver via
  // board.json requestDefs.* med råteksten som fallback — mønster fra #917/#694).
  return {
    type: requestType,
    ...definition,
    label_key: `requestDefs.${requestType}.label`,
    description_key: `requestDefs.${requestType}.description`,
    tradeoff_preview_key: `requestDefs.${requestType}.tradeoffPreview`,
  };
}

export function buildBoardRequestOptions({ board, context = {} } = {}) {
  if (!board) return [];

  const goals = parseBoardGoals(board.current_goals);

  return VALID_BOARD_REQUEST_TYPES.map((requestType) => {
    const definition = getBoardRequestDefinition(requestType);
    const availability = getBoardRequestAvailability({
      requestType,
      board,
      goals,
      context,
    });

    return {
      ...definition,
      disabled: availability.disabled,
      disabled_reason: availability.reason,
      disabled_reason_key: availability.reason_key || null,
      disabled_reason_params: availability.reason_params || {},
    };
  });
}

export function resolveBoardRequest({ board, requestType, team, standing, context = {} } = {}) {
  if (!board) {
    throw new Error("Board profile required");
  }

  if (!isValidBoardRequestType(requestType)) {
    throw new Error("Invalid request_type");
  }

  const goals = parseBoardGoals(board.current_goals);
  const definition = getBoardRequestDefinition(requestType);
  const availability = getBoardRequestAvailability({
    requestType,
    board,
    goals,
    context,
  });

  if (availability.disabled) {
    return buildRejectedBoardRequest({
      requestType,
      reason: availability.reason || "Bestyrelsen afviser foresporgslen lige nu.",
      reasonKey: availability.reason_key || "requestReason.fallback",
      reasonParams: availability.reason_params || {},
    });
  }

  const performance = calculateBoardPerformance({ board, standing, team, context });
  const overallScore = performance.adjustedOverallScore ?? 0.6;
  const identityProfile = context.identityProfile || performance.identityProfile;
  const satisfaction = board.satisfaction ?? 50;
  const planType = board.plan_type || "1yr";
  const riderPool = Array.isArray(team?.riders) ? team.riders : [];
  const currentGoals = goals.map((goal) => addGoalMetadata({ ...goal }));
  const goalChanges = [];
  let updatedGoals = currentGoals;
  let nextFocus = board.focus;
  let outcome = "approved";
  let title = "Bestyrelsen accepterer foresporgslen";
  let summary = definition?.description || "Bestyrelsen har justeret planen.";
  let tradeoffSummary = null;
  // #1084 · i18n-koder parallelt med den danske råtekst — persisteres i
  // board_request_log.request_payload og resolves on-read i frontend.
  let titleCode = "requestOutcome.approvedTitle";
  let summaryCode = definition?.description_key || null;
  let tradeoffSummaryCode = null;

  const rankingIndex = findGoalIndexByCategory(currentGoals, "ranking");
  const resultsIndex = findGoalIndexByCategory(currentGoals, "results");
  const identityIndex = findGoalIndexByCategory(currentGoals, "identity");
  const economyIndex = findGoalIndexByCategory(currentGoals, "economy");
  const strongNationalCore = hasStrongNationalCore(identityProfile);
  const strongStarProfile = hasStrongStarProfile(identityProfile);

  if (requestType === "lower_results_pressure") {
    if (satisfaction < 35 || overallScore < 0.52) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen synes allerede planen er under nok pres og vil se mere fremgang, for de letter kravene.",
        reasonKey: "requestReason.lowerResults.underEnoughPressure",
      });
    }

    if (strongStarProfile && (satisfaction < 60 || overallScore < 0.66)) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen afviser at saenke ambitionsniveauet for et hold med tydelige profiler, fordi sponsorernes forventninger allerede er skruet op.",
        reasonKey: "requestReason.lowerResults.starAmbitionLocked",
      });
    }

    // #1234 · buildNegotiatedGoal returnerer null når et mål ikke reelt kan
    // lempes (target på sit gulv) — replaceGoal lader da målet stå uændret i
    // stedet for den gamle no-op-rabat (samme target, halv penalty).
    if (rankingIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, buildNegotiatedGoal(updatedGoals[rankingIndex]), goalChanges, "relaxed");
    }

    if (resultsIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, buildNegotiatedGoal(updatedGoals[resultsIndex]), goalChanges, "relaxed");
    }

    if (economyIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, economyIndex, buildTightenedGoal(updatedGoals[economyIndex]), goalChanges, "tightened");
    }

    outcome = goalChanges.filter((change) => change.kind === "relaxed").length >= 2 ? "tradeoff" : "partial";
    title = outcome === "partial"
      ? "Bestyrelsen giver lidt luft"
      : "Bestyrelsen giver luft mod en pris";
    titleCode = outcome === "partial"
      ? "requestOutcome.lowerResults.titlePartial"
      : "requestOutcome.lowerResults.titleTradeoff";
    summary = strongStarProfile
      ? "Bestyrelsen giver kun lidt luft, fordi et hold med store profiler stadig bliver holdt op pa hoje forventninger."
      : "Bestyrelsen saenker det sportslige pres en smule i den aktive plan.";
    summaryCode = strongStarProfile
      ? "requestOutcome.lowerResults.summaryStar"
      : "requestOutcome.lowerResults.summaryDefault";
    tradeoffSummary = economyIndex >= 0
      ? strongStarProfile
        ? "Profilerne giver sponsorprojektet tyngde, men de betyder ogsa at boardet strammer okonomikravet i stedet for at slippe ambitionerne helt."
        : "Til gaengald bliver okonomikravet skarpere, sa holdet skal drives mere disciplineret resten af planen."
      : "Bestyrelsen giver kun en delvis lettelse, fordi planen stadig skal have tydelige resultater.";
    tradeoffSummaryCode = economyIndex >= 0
      ? strongStarProfile
        ? "requestOutcome.lowerResults.tradeoffStar"
        : "requestOutcome.lowerResults.tradeoffEconomy"
      : "requestOutcome.lowerResults.tradeoffPartial";
  }

  if (requestType === "more_youth_focus") {
    const youthTemplateGoals = generateBoardGoals({
      focus: "youth_development",
      planType,
      team,
      riders: riderPool,
      standing,
    });
    const youthIdentityGoal = youthTemplateGoals.find((goal) => goal.type === "min_u25_riders");
    const youthResultsGoal = youthTemplateGoals.find((goal) => goal.category === "results");
    const usesBalancedBridge = shouldUseBalancedBridge({
      currentFocus: board.focus,
      requestType,
      identityProfile,
      satisfaction,
    });

    if (identityIndex >= 0 && youthIdentityGoal) {
      updatedGoals = replaceGoal(updatedGoals, identityIndex, youthIdentityGoal, goalChanges, "replaced");
    }

    if (resultsIndex >= 0 && youthResultsGoal) {
      // #1234 · Skift til ungdoms-målet skal ske selv når det ikke kan lempes
      // (buildNegotiatedGoal → null): fald tilbage til template-målet som det
      // er, i stedet for stille at beholde det gamle resultat-mål.
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, buildNegotiatedGoal(youthResultsGoal) ?? youthResultsGoal, goalChanges, "replaced");
    }

    if (rankingIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, buildNegotiatedGoal(updatedGoals[rankingIndex]), goalChanges, "relaxed");
    }

    nextFocus = usesBalancedBridge ? "balanced" : "youth_development";
    outcome = "tradeoff";
    title = usesBalancedBridge
      ? "Bestyrelsen accepterer kun en gradvis drejning"
      : "Bestyrelsen accepterer et mere ungt spor";
    titleCode = usesBalancedBridge
      ? "requestOutcome.moreYouth.titleBridge"
      : "requestOutcome.moreYouth.titleDefault";
    summary = usesBalancedBridge
      ? "Bestyrelsen vil gerne se mere udvikling, men et hold med tydelige profiler kan ikke skifte helt spor pa en gang."
      : identityProfile?.youth_level === "high"
        ? "Bestyrelsen ser allerede et ungdomsspor i truppen og drejer planen tydeligere mod udvikling."
        : strongNationalCore
          ? "Bestyrelsen ser en tydelig kerne i truppen og accepterer at dreje planen mod en mere langsigtet udviklingsretning."
          : "Planen drejes mere mod udvikling og langsigtet trupbygning.";
    summaryCode = usesBalancedBridge
      ? "requestOutcome.moreYouth.summaryBridge"
      : identityProfile?.youth_level === "high"
        ? "requestOutcome.moreYouth.summaryYouthTrack"
        : strongNationalCore
          ? "requestOutcome.moreYouth.summaryNationalCore"
          : "requestOutcome.moreYouth.summaryDefault";
    tradeoffSummary = usesBalancedBridge
      ? "Planen bliver mere ungdomsorienteret, men boardet holder fokus i en balanceret mellemstation og slipper ikke resultatpresset helt endnu."
      : "Til gaengald bliver U25-identiteten nu et tydeligere og mere varigt krav i den aktive plan.";
    tradeoffSummaryCode = usesBalancedBridge
      ? "requestOutcome.moreYouth.tradeoffBridge"
      : "requestOutcome.moreYouth.tradeoffDefault";
  }

  if (requestType === "more_results_focus") {
    const resultsTemplateGoals = generateBoardGoals({
      focus: "star_signing",
      planType,
      team,
      riders: riderPool,
      standing,
    });
    const resultsRankingGoal = resultsTemplateGoals.find((goal) => goal.type === "top_n_finish");
    const resultsGoal = resultsTemplateGoals.find((goal) => goal.category === "results");
    const usesBalancedBridge = shouldUseBalancedBridge({
      currentFocus: board.focus,
      requestType,
      identityProfile,
      satisfaction,
    });

    // #1234 · Balanced-bridge blødgør de nye mål via buildNegotiatedGoal; kan
    // template-målet ikke lempes (null), bruges det som det er — skiftet til
    // resultat-sporet skal stadig ske, bare uden rabat.
    if (rankingIndex >= 0 && resultsRankingGoal) {
      updatedGoals = replaceGoal(
        updatedGoals,
        rankingIndex,
        usesBalancedBridge ? (buildNegotiatedGoal(resultsRankingGoal) ?? resultsRankingGoal) : resultsRankingGoal,
        goalChanges,
        "tightened"
      );
    }

    if (resultsIndex >= 0 && resultsGoal) {
      updatedGoals = replaceGoal(
        updatedGoals,
        resultsIndex,
        usesBalancedBridge ? (buildNegotiatedGoal(resultsGoal) ?? resultsGoal) : resultsGoal,
        goalChanges,
        "replaced"
      );
    }

    if (identityIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, identityIndex, buildNegotiatedGoal(updatedGoals[identityIndex]), goalChanges, "relaxed");
    }

    nextFocus = usesBalancedBridge ? "balanced" : "star_signing";
    outcome = usesBalancedBridge ? "tradeoff" : "approved";
    title = usesBalancedBridge
      ? "Bestyrelsen accepterer kun en gradvis optrapning"
      : "Bestyrelsen skruer op for ambitionen";
    titleCode = usesBalancedBridge
      ? "requestOutcome.moreResults.titleBridge"
      : "requestOutcome.moreResults.titleDefault";
    summary = usesBalancedBridge
      ? "Bestyrelsen vil gerne se mere resultattryk, men et udtalt ungdomsspor bliver kun flyttet gradvist over mod en mere ambitiost mellemposition."
      : strongStarProfile
        ? "Store profiler og sponsorernes forventninger faar bestyrelsen til at skrue op for ambitionen med det samme."
        : ["gc", "sprint", "classics"].includes(identityProfile?.primary_specialization)
          ? "Bestyrelsen laeser holdet som klar til at jagte stoerre resultater og skruer op for ambitionen."
          : "Planen vaegter nu topresultater endnu tydeligere end for.";
    summaryCode = usesBalancedBridge
      ? "requestOutcome.moreResults.summaryBridge"
      : strongStarProfile
        ? "requestOutcome.moreResults.summaryStar"
        : ["gc", "sprint", "classics"].includes(identityProfile?.primary_specialization)
          ? "requestOutcome.moreResults.summarySpecialized"
          : "requestOutcome.moreResults.summaryDefault";
    tradeoffSummary = usesBalancedBridge
      ? "Boardet holder fast i en del af udviklingssporet, sa holdet ma bevise det nye ambitionsniveau over tid."
      : "Du faar lidt mere fleksibilitet i identitetskravet, men resultatmaalene er til gengaeld blevet skarpere med det samme.";
    tradeoffSummaryCode = usesBalancedBridge
      ? "requestOutcome.moreResults.tradeoffBridge"
      : "requestOutcome.moreResults.tradeoffDefault";
  }

  if (requestType === "ease_identity_requirements") {
    if (satisfaction < 40 || overallScore < 0.55) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen vil ikke lempe identitetskravene, foer holdet staar mere stabilt sportsligt.",
        reasonKey: "requestReason.easeIdentity.needStabilityFirst",
      });
    }

    if (strongNationalCore && satisfaction < 65) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen ser den nationale kerne som en vigtig del af holdets DNA og vil ikke slippe den endnu.",
        reasonKey: "requestReason.easeIdentity.nationalCoreDna",
      });
    }

    if (identityIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, identityIndex, buildNegotiatedGoal(updatedGoals[identityIndex]), goalChanges, "relaxed");
    }

    if (rankingIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, buildTightenedGoal(updatedGoals[rankingIndex]), goalChanges, "tightened");
    } else if (resultsIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, buildTightenedGoal(updatedGoals[resultsIndex]), goalChanges, "tightened");
    }

    outcome = "tradeoff";
    title = strongNationalCore
      ? "Bestyrelsen letter kun identitetskravet lidt"
      : "Bestyrelsen letter identitetskravet";
    titleCode = strongNationalCore
      ? "requestOutcome.easeIdentity.titleCore"
      : "requestOutcome.easeIdentity.titleDefault";
    summary = strongNationalCore
      ? "Bestyrelsen ser stadig den nationale kerne som en vigtig del af holdets DNA og giver kun lidt mere fleksibilitet i identitetskravet."
      : "Holdet faar lidt mere fleksibilitet i trupbygningen og de identitetsbaerende mal.";
    summaryCode = strongNationalCore
      ? "requestOutcome.easeIdentity.summaryCore"
      : "requestOutcome.easeIdentity.summaryDefault";
    tradeoffSummary = strongNationalCore
      ? "Den nationale identitet bliver ikke sluppet helt, og bestyrelsen forventer til gaengald et skarpere sportsligt output resten af planen."
      : "Til gaengald forventer bestyrelsen et skarpere sportsligt output resten af planen.";
    tradeoffSummaryCode = strongNationalCore
      ? "requestOutcome.easeIdentity.tradeoffCore"
      : "requestOutcome.easeIdentity.tradeoffDefault";
  }

  // S-02g · F3 + F4: deferred tradeoff-stramning + MAJOR-pivot cool-down sat ved approval.
  // Rejected requests har ingen updated_board → ingen tradeoff/pivot-felter. Approved/partial/tradeoff
  // outcome er hvor effekten skal gemmes.
  const tradeoffPayload = TRADEOFF_PAYLOADS_BY_REQUEST[requestType] || null;
  const isMajorPivot = isMajorPivotRequest({ requestType, currentFocus: board.focus });
  const tradeoffActiveUntilSeasonId = tradeoffPayload && context.activeSeasonId
    ? context.activeSeasonId
    : null;
  const majorPivotUsedAt = isMajorPivot ? new Date().toISOString() : null;

  return {
    request_type: requestType,
    request_label: definition?.label || requestType,
    request_label_key: definition?.label_key || null,
    outcome,
    title,
    title_code: titleCode,
    summary,
    summary_code: summaryCode,
    summary_params: {},
    tradeoff_summary: tradeoffSummary,
    tradeoff_summary_code: tradeoffSummary ? tradeoffSummaryCode : null,
    updated_board: {
      focus: nextFocus,
      current_goals: updatedGoals,
      tradeoff_active_until_season_id: tradeoffActiveUntilSeasonId,
      tradeoff_payload: tradeoffPayload,
      major_pivot_used_at: majorPivotUsedAt,
    },
    goal_changes: goalChanges,
    is_major_pivot: isMajorPivot,
    has_deferred_tradeoff: Boolean(tradeoffPayload),
  };
}

// #915 · Genforhandlings-lås. En allerede-signeret plan (negotiation_status ===
// "completed") kan ikke gen-forhandles (renew → re-sign) når sæsonen er for langt
// fremme. Samme princip som board-requests' slutfase-vindue (F5): tillader tidlig-
// sæson justering, men lukker det vindue hvor en manager ellers kunne skifte til
// lettere mål lige før plan-evaluering for at puste tilfredsheden op.
//
// Gælder KUN signerede planer for den igangværende sæson. Udløbne/pending planer
// (incl. første signering og fornyelse af en udløbet plan ved sæsonstart) må altid
// signeres — guarden returnerer { locked: false } for dem.
export function getBoardRenegotiationLock({ board, activeSeason } = {}) {
  if (!board || board.negotiation_status !== "completed") {
    return { locked: false };
  }

  const total = Number(activeSeason?.race_days_total ?? 0);
  const completed = Number(activeSeason?.race_days_completed ?? 0);

  // Sæsonstart (ingen race-days kørt endnu) → ikke låst: legitim signering/fornyelse.
  if (total <= 0 || completed <= 0) {
    return { locked: false };
  }

  const raceDaysLeft = total - completed;
  if (raceDaysLeft <= REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT) {
    return {
      locked: true,
      code: "BOARD_RENEGOTIATION_LOCKED_WINDOW",
      reason: `Saesonens slutfase er begyndt. Bestyrelsesplanen kan ikke gen-forhandles de sidste ${REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT} race-days.`,
      // #678 Track 3: { code, params }-kontrakt så frontend resolveApiError kan
      // vise EN-tekst i stedet for den danske `reason`-fallback.
      errorCode: "board_renegotiation_locked_window",
      errorParams: { raceDays: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT },
    };
  }

  const progressPct = (completed / total) * 100;
  if (progressPct >= RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT) {
    return {
      locked: true,
      code: "BOARD_RENEGOTIATION_LOCKED_PROGRESS",
      reason: `Bestyrelsesplanen kan ikke gen-forhandles midt i en igangvaerende saeson (efter ${RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT}% af saesonen er koert). Vent til planen udloeber eller saesonen slutter.`,
      errorCode: "board_renegotiation_locked_progress",
      errorParams: { percent: RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT },
    };
  }

  return { locked: false };
}

// #1084 · Hver utilgængeligheds-grund bærer både dansk råtekst (fallback) og en
// i18n-kode + params, så frontend kan vise EN uden leak. Bruges også som
// summary på rejected-resultater (resolve-on-read i BoardRequestPanel).
function unavailable(reason, reasonKey, reasonParams = {}) {
  return { disabled: true, reason, reason_key: reasonKey, reason_params: reasonParams };
}

function getBoardRequestAvailability({ requestType, board, goals = [], context = {} } = {}) {
  if (!board) {
    return unavailable("Ingen aktiv bestyrelsesplan.", "requestReason.noActivePlan");
  }

  if (board.negotiation_status !== "completed") {
    return unavailable("Forhandl en ny plan, for du sender requests.", "requestReason.planNotActive");
  }

  if (context.requestUsedThisSeason) {
    return unavailable("Du har allerede brugt saesonens board request.", "requestReason.alreadyUsed");
  }

  // S-02g F5 · Window-blokering: requests umulige i sidste 5 race-days
  // (lokalt afkortet evalueringsvindue så manager ikke kan dreje plan-mål
  // lige før plan-evaluering)
  if (
    context.raceDaysLeft != null
    && Number(context.raceDaysLeft) <= REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT
  ) {
    return unavailable(
      `Saesonens slutfase er begyndt. Bestyrelsen tager ikke imod requests de sidste ${REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT} race-days.`,
      "requestReason.windowBlocked",
      { raceDays: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT }
    );
  }

  // S-02g F6 · Mid-cycle-låsning for 5yr/3yr-planer: kræver ≥50% plan-gennemført
  // ELLER >30% satisfaction-delta før plan kan drejes. 1yr-planer er korte nok
  // til at de altid må drejes (forudsat de andre guards passer).
  const planType = board.plan_type;
  if (planType === "5yr" || planType === "3yr") {
    const planDuration = Number(context.planDuration ?? (planType === "5yr" ? 5 : 3));
    const seasonsCompleted = Number(context.seasonsCompleted ?? 0);
    const progressPct = planDuration > 0 ? (seasonsCompleted / planDuration) * 100 : 0;
    const satisfactionDeltaAbsPct = Math.abs(Number(context.satisfactionDeltaPct ?? 0));

    const progressMet = progressPct >= MID_CYCLE_PROGRESS_THRESHOLD_PCT;
    const deltaMet = satisfactionDeltaAbsPct > MID_CYCLE_SATISFACTION_DELTA_PCT;

    if (!progressMet && !deltaMet) {
      const planLabel = planType === "5yr" ? "5-aarsplanen" : "3-aarsplanen";
      return unavailable(
        `${planLabel} er for tidligt i forloebet til at blive drejet. Bestyrelsen oensker mindst ${MID_CYCLE_PROGRESS_THRESHOLD_PCT}% af planen gennemfoert eller en stor tilfredsheds-aendring foer en re-orientering.`,
        "requestReason.midCycleLocked",
        { years: planType === "5yr" ? 5 : 3, percent: MID_CYCLE_PROGRESS_THRESHOLD_PCT }
      );
    }
  }

  // S-02g F4 · MAJOR pivot cool-down: én MAJOR focus-skift pr. plan-livscyklus.
  // MAJOR = krydsning mellem extremer (youth↔star) — ikke pivots til/fra balanced.
  if (
    isMajorPivotRequest({ requestType, currentFocus: board.focus })
    && board.major_pivot_used_at
  ) {
    return unavailable(
      "Bestyrelsen har allerede accepteret en MAJOR drejning i denne plan-livscyklus. En ny stor retnings-aendring kraever en frisk plan.",
      "requestReason.majorPivotUsed"
    );
  }

  const satisfaction = board.satisfaction ?? 50;
  const overallScore = context.overallScore ?? null;
  const rankingIndex = findGoalIndexByCategory(goals, "ranking");
  const resultsIndex = findGoalIndexByCategory(goals, "results");
  const identityIndex = findGoalIndexByCategory(goals, "identity");
  const identityProfile = context.identityProfile
    || deriveTeamIdentityProfile({
      team: context.team,
      riders: context.team?.riders || context.riders || [],
      standing: context.standing,
    });
  const strongNationalCore = hasStrongNationalCore(identityProfile);
  const strongStarProfile = hasStrongStarProfile(identityProfile);

  switch (requestType) {
    case "lower_results_pressure":
      if (rankingIndex < 0 && resultsIndex < 0) {
        return unavailable("Planen har ingen sportslige mal at lempe.", "requestReason.lowerResults.noSportingGoals");
      }
      if (satisfaction < 35) {
        return unavailable("Bestyrelsen er for utilfreds til at lette resultatkravene.", "requestReason.lowerResults.tooUnhappy");
      }
      if (overallScore != null && overallScore < 0.52) {
        return unavailable("Bestyrelsen vil se mere fremgang, for de letter resultatkravene.", "requestReason.lowerResults.needProgress");
      }
      if (strongStarProfile && satisfaction < 60) {
        return unavailable("Store profiler holder sponsorernes forventninger hoje, sa boardet letter ikke resultatkravene endnu.", "requestReason.lowerResults.starPressure");
      }
      return { disabled: false, reason: null };
    case "more_youth_focus":
      if (board.focus === "youth_development") {
        return unavailable("Planen er allerede i ungdomsretning.", "requestReason.moreYouth.alreadyYouth");
      }
      if (identityIndex < 0) {
        return unavailable("Planen mangler et identitetsmal at dreje.", "requestReason.moreYouth.noIdentityGoal");
      }
      if (satisfaction < 30) {
        return unavailable("Bestyrelsen vil se mere stabilitet, for de skifter fokus nu.", "requestReason.moreYouth.needStability");
      }
      if (identityProfile?.youth_level === "low" && satisfaction < 45) {
        return unavailable("Bestyrelsen vil se en tydeligere ungdomsbase i truppen, for de skifter fokus.", "requestReason.moreYouth.needYouthBase");
      }
      return { disabled: false, reason: null };
    case "more_results_focus":
      if (board.focus === "star_signing") {
        return unavailable("Planen presser allerede efter topresultater.", "requestReason.moreResults.alreadyResults");
      }
      if (identityProfile?.squad_status === "thin" && satisfaction < 45) {
        return unavailable("Bestyrelsen vil se en bredere trup, for de skruer yderligere op for ambitionsniveauet.", "requestReason.moreResults.squadTooThin");
      }
      return { disabled: false, reason: null };
    case "ease_identity_requirements":
      if (identityIndex < 0) {
        return unavailable("Planen har intet identitetskrav at lempe.", "requestReason.easeIdentity.noIdentityGoal");
      }
      if (satisfaction < 40) {
        return unavailable("Bestyrelsen vil have mere tillid, for de lemper identitetskravet.", "requestReason.easeIdentity.needTrust");
      }
      if (overallScore != null && overallScore < 0.55) {
        return unavailable("Bestyrelsen vil se mere sportslig stabilitet, for de letter identitetskravet.", "requestReason.easeIdentity.needSportingStability");
      }
      if (strongNationalCore && satisfaction < 65) {
        return unavailable("Bestyrelsen ser den nationale kerne som en vigtig del af holdets DNA og slipper den ikke endnu.", "requestReason.easeIdentity.nationalCoreCentral");
      }
      if (identityProfile?.primary_specialization === "youth" && identityProfile?.youth_level === "high" && satisfaction < 55) {
        return unavailable("Bestyrelsen ser ungdomssporet som en kerne af holdets identitet og slipper det ikke endnu.", "requestReason.easeIdentity.youthCoreCentral");
      }
      return { disabled: false, reason: null };
    default:
      return unavailable("Ukendt board request.", "requestReason.unknown");
  }
}

function buildRejectedBoardRequest({ requestType, reason, reasonKey = null, reasonParams = {} }) {
  const definition = getBoardRequestDefinition(requestType);

  return {
    request_type: requestType,
    request_label: definition?.label || requestType,
    request_label_key: definition?.label_key || null,
    outcome: "rejected",
    title: "Bestyrelsen afviser foresporgslen",
    title_code: "requestOutcome.rejectedTitle",
    summary: reason || "Bestyrelsen afviser foresporgslen lige nu.",
    summary_code: reasonKey || "requestReason.fallback",
    summary_params: reasonParams || {},
    tradeoff_summary: null,
    tradeoff_summary_code: null,
    updated_board: null,
    goal_changes: [],
  };
}

function findGoalIndexByCategory(goals = [], category) {
  return goals.findIndex((goal) => addGoalMetadata(goal).category === category);
}

// #1750 · Minimal mål-payload til frontend's getBoardGoalLabel — kun de felter
// type-resolveren bruger (type, target, cumulative, race_scope, nationality_code,
// label). Holder goal_changes-payloaden lille uden at lække intern goal-state.
function pickGoalLabelFields(goal = {}) {
  return {
    type: goal.type,
    target: goal.target,
    cumulative: goal.cumulative ?? false,
    race_scope: goal.race_scope ?? null,
    nationality_code: goal.nationality_code ?? null,
    label: goal.label ?? null,
  };
}

function replaceGoal(goals, index, nextGoal, goalChanges = [], kind = "replaced") {
  if (index < 0 || index >= goals.length || !nextGoal) {
    return goals;
  }

  const updatedGoals = [...goals];
  const previousGoal = addGoalMetadata(updatedGoals[index]);
  const enrichedGoal = addGoalMetadata({
    ...nextGoal,
    label: nextGoal.label || buildGoalLabel(nextGoal),
  });

  if (JSON.stringify(normalizeComparableGoal(previousGoal)) !== JSON.stringify(normalizeComparableGoal(enrichedGoal))) {
    goalChanges.push({
      kind,
      before_label: previousGoal.label,
      after_label: enrichedGoal.label,
      category: enrichedGoal.category,
      // #1750 · Strukturerede mål-payloads så frontend kan type-oversætte
      // before/after via getBoardGoalLabel (EN-mode lækkede ellers de danske
      // råtekst-labels). De rå *_label-felter bevares som fallback for
      // allerede-persisterede requests.
      before_goal: pickGoalLabelFields(previousGoal),
      after_goal: pickGoalLabelFields(enrichedGoal),
    });
  }

  updatedGoals[index] = enrichedGoal;
  return updatedGoals;
}

function buildTightenedGoal(goal) {
  const enrichedGoal = addGoalMetadata(goal);

  switch (enrichedGoal.type) {
    case "top_n_finish":
      return addGoalMetadata({
        ...enrichedGoal,
        target: Math.max(1, enrichedGoal.target - 1),
        label: buildGoalLabel({ ...enrichedGoal, target: Math.max(1, enrichedGoal.target - 1) }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 5,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 5,
      });
    case "stage_wins":
    case "gc_wins": {
      const nextTarget = enrichedGoal.target + 1;
      return addGoalMetadata({
        ...enrichedGoal,
        target: nextTarget,
        label: buildGoalLabel({ ...enrichedGoal, target: nextTarget }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 5,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 5,
      });
    }
    case "min_u25_riders": {
      const nextTarget = enrichedGoal.target + 1;
      return addGoalMetadata({
        ...enrichedGoal,
        target: nextTarget,
        label: buildGoalLabel({ ...enrichedGoal, target: nextTarget }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 3,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 4,
      });
    }
    case "min_national_riders": {
      const nextTarget = enrichedGoal.target + 1;
      return addGoalMetadata({
        ...enrichedGoal,
        target: nextTarget,
        label: buildGoalLabel({ ...enrichedGoal, target: nextTarget }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 3,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 4,
      });
    }
    case "min_riders": {
      const nextTarget = Math.min(enrichedGoal.max_target ?? (enrichedGoal.target + 2), enrichedGoal.target + 2);
      return addGoalMetadata({
        ...enrichedGoal,
        target: nextTarget,
        label: buildGoalLabel({ ...enrichedGoal, target: nextTarget }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 2,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 4,
      });
    }
    case "sponsor_growth": {
      const nextTarget = enrichedGoal.target + 5;
      return addGoalMetadata({
        ...enrichedGoal,
        target: nextTarget,
        label: buildGoalLabel({ ...enrichedGoal, target: nextTarget }),
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 4,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 5,
      });
    }
    case "no_outstanding_debt":
    default:
      return addGoalMetadata({
        ...enrichedGoal,
        satisfaction_bonus: (enrichedGoal.satisfaction_bonus || 0) + 2,
        satisfaction_penalty: (enrichedGoal.satisfaction_penalty || 0) + 4,
      });
  }
}

function shouldUseBalancedBridge({ currentFocus, requestType, identityProfile, satisfaction = 50 } = {}) {
  if (requestType === "more_results_focus" && currentFocus === "youth_development") {
    return satisfaction < 68 && !hasStrongStarProfile(identityProfile);
  }

  if (requestType === "more_youth_focus" && currentFocus === "star_signing") {
    return satisfaction < 65 || (hasStrongStarProfile(identityProfile) && satisfaction < 75);
  }

  return false;
}
