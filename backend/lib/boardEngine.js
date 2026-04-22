const PLAN_DURATIONS = {
  "1yr": 1,
  "3yr": 3,
  "5yr": 5,
};

const PLAN_PENALTY_MODIFIERS = {
  "1yr": 1.0,
  "3yr": 0.8,
  "5yr": 0.6,
};

const CATEGORY_LABELS = {
  results: "Resultater",
  economy: "Okonomi",
  identity: "Identitet",
  ranking: "Rangering",
};

const BASE_CATEGORY_WEIGHTS = {
  results: 0.50,
  economy: 0.20,
  identity: 0.20,
  ranking: 0.10,
};

const GOAL_METADATA_BY_TYPE = {
  top_n_finish: { category: "ranking", importance: "required", weight: 1.0 },
  stage_wins: { category: "results", importance: "required", weight: 1.0 },
  gc_wins: { category: "results", importance: "required", weight: 1.1 },
  min_u25_riders: { category: "identity", importance: "required", weight: 1.0 },
  min_riders: { category: "identity", importance: "preferred", weight: 0.9 },
  no_outstanding_debt: { category: "economy", importance: "required", weight: 1.0 },
  sponsor_growth: { category: "economy", importance: "required", weight: 1.0 },
};

const PERSONALITY_BY_FOCUS = {
  youth_development: {
    sports_ambition: "medium",
    financial_risk: "cautious",
    identity_strength: "high",
  },
  star_signing: {
    sports_ambition: "high",
    financial_risk: "aggressive",
    identity_strength: "medium",
  },
  balanced: {
    sports_ambition: "medium",
    financial_risk: "balanced",
    identity_strength: "medium",
  },
};

const LEVELS = ["low", "medium", "high"];

export const VALID_BOARD_FOCUSES = [
  "youth_development",
  "star_signing",
  "balanced",
];

export const VALID_BOARD_PLAN_TYPES = Object.keys(PLAN_DURATIONS);

export const VALID_BOARD_REQUEST_TYPES = [
  "lower_results_pressure",
  "more_youth_focus",
  "more_results_focus",
  "ease_identity_requirements",
];

const BOARD_REQUEST_DEFINITIONS = {
  lower_results_pressure: {
    label: "Saenk resultatpresset",
    description: "Bed bestyrelsen om lidt mere luft i de sportslige krav i den aktive plan.",
    tradeoff_preview: "Hvis de siger ja, forventer de typisk strammere okonomisk disciplin.",
  },
  more_youth_focus: {
    label: "Mere ungdomsfokus",
    description: "Skub planen i en tydeligere ungdomsretning med mere plads til udvikling.",
    tradeoff_preview: "Hvis de siger ja, bliver U25-identiteten mere central i den aktive plan.",
  },
  more_results_focus: {
    label: "Mere resultatfokus nu",
    description: "Bed bestyrelsen om at vaegte topresultater hoejere med det samme.",
    tradeoff_preview: "Det giver ikke en lettere plan - de sportslige krav bliver skarpere.",
  },
  ease_identity_requirements: {
    label: "Lemp identitetskrav",
    description: "Bed om lidt mere fleksibilitet i trupsammensaetning og identitetsmaal.",
    tradeoff_preview: "Hvis de siger ja, skruer de typisk op for det sportslige pres i stedet.",
  },
};

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
  return definition ? { type: requestType, ...definition } : null;
}

export function getPlanDuration(planType) {
  return PLAN_DURATIONS[planType] ?? 1;
}

export function parseBoardGoals(rawGoals) {
  const parsedGoals = Array.isArray(rawGoals)
    ? rawGoals
    : typeof rawGoals === "string" && rawGoals.trim()
      ? safeJsonParse(rawGoals, [])
      : [];

  return parsedGoals.map((goal) => addGoalMetadata(goal));
}

export function deriveBoardPersonality({ focus = "balanced", planType = "1yr" } = {}) {
  const basePersonality = PERSONALITY_BY_FOCUS[focus] || PERSONALITY_BY_FOCUS.balanced;
  let sportsAmbition = basePersonality.sports_ambition;
  let identityStrength = basePersonality.identity_strength;

  if (planType === "1yr") {
    sportsAmbition = shiftLevel(sportsAmbition, 1);
  }

  if (planType === "5yr") {
    identityStrength = shiftLevel(identityStrength, 1);
  }

  const personality = {
    sports_ambition: sportsAmbition,
    financial_risk: basePersonality.financial_risk,
    identity_strength: identityStrength,
  };

  return {
    ...personality,
    summary: describeBoardPersonality(personality),
  };
}

export function generateBoardGoals({ focus = "balanced", planType = "1yr" } = {}) {
  const planDuration = getPlanDuration(planType);
  const isMultiYear = planDuration > 1;
  const penaltyModifier = PLAN_PENALTY_MODIFIERS[planType] || 1.0;

  const stageWinsTarget = isMultiYear ? Math.round(planDuration * 0.8) : 1;
  const gcWinsTarget = isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1;
  const balancedStageTarget = isMultiYear ? Math.round(2 * planDuration * 0.7) : 2;

  const baseGoals = {
    youth_development: [
      {
        type: "min_u25_riders",
        target: 5,
        label: "Min. 5 U25-ryttere pa holdet",
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
      {
        type: "top_n_finish",
        target: 5,
        label: isMultiYear ? "Top 5 i divisionen ved planens afslutning" : "Top 5 i divisionen",
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "stage_wins",
        target: stageWinsTarget,
        label: isMultiYear
          ? `Mindst ${stageWinsTarget} etapesejre over planperioden`
          : "Mindst 1 etapesejr",
        cumulative: isMultiYear,
        satisfaction_bonus: 20,
        satisfaction_penalty: 0,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestaende gaeld ved saesonslut",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
    ],
    star_signing: [
      {
        type: "top_n_finish",
        target: 3,
        label: isMultiYear ? "Top 3 i divisionen ved planens afslutning" : "Top 3 i divisionen",
        satisfaction_bonus: 20,
        satisfaction_penalty: 15,
      },
      {
        type: "gc_wins",
        target: gcWinsTarget,
        label: isMultiYear
          ? `Mindst ${gcWinsTarget} samlede sejre over planperioden`
          : "Mindst 1 samlet sejr",
        cumulative: isMultiYear,
        satisfaction_bonus: 25,
        satisfaction_penalty: 10,
      },
      {
        type: "min_riders",
        target: 20,
        label: "Hold pa min. 20 ryttere",
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "sponsor_growth",
        target: isMultiYear ? planDuration * 5 : 10,
        label: isMultiYear
          ? `Sponsor-indkomst vokset med ${planDuration * 5}% over planperioden`
          : "Sponsor-indkomst vokset med 10%",
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
    ],
    balanced: [
      {
        type: "top_n_finish",
        target: 4,
        label: isMultiYear ? "Top 4 i divisionen ved planens afslutning" : "Top 4 i divisionen",
        satisfaction_bonus: 15,
        satisfaction_penalty: 8,
      },
      {
        type: "min_riders",
        target: 15,
        label: "Hold pa min. 15 ryttere",
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "stage_wins",
        target: balancedStageTarget,
        label: isMultiYear
          ? `Mindst ${balancedStageTarget} etapesejre over planperioden`
          : "Mindst 2 etapesejre",
        cumulative: isMultiYear,
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestaende gaeld ved saesonslut",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
    ],
  };

  const selectedGoals = baseGoals[focus] || baseGoals.balanced;
  return selectedGoals.map((goal) => addGoalMetadata({
    ...goal,
    satisfaction_penalty: Math.round(goal.satisfaction_penalty * penaltyModifier),
  }));
}

export function buildNegotiatedGoal(goal) {
  const enrichedGoal = addGoalMetadata(goal);

  switch (enrichedGoal.type) {
    case "top_n_finish": {
      const target = enrichedGoal.target + 2;
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Top ${target} i divisionen`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "stage_wins": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: enrichedGoal.cumulative
          ? `Mindst ${target} etapesejre over planperioden`
          : `Mindst ${target} etapesejr${target !== 1 ? "er" : ""}`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "gc_wins": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: enrichedGoal.cumulative
          ? `Mindst ${target} samlede sejre over planperioden`
          : `Mindst ${target} samlet sejr`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_u25_riders": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Min. ${target} U25-ryttere pa holdet`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_riders": {
      const target = Math.max(5, enrichedGoal.target - 3);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Hold pa min. ${target} ryttere`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "sponsor_growth": {
      const target = Math.max(5, enrichedGoal.target - 5);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Sponsor-indkomst vokset med ${target}%`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "no_outstanding_debt":
    default:
      return addGoalMetadata({
        ...enrichedGoal,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
  }
}

export function buildBoardProposal({ focus = "balanced", planType = "1yr" } = {}) {
  const goals = generateBoardGoals({ focus, planType });
  const personality = deriveBoardPersonality({ focus, planType });

  return {
    focus,
    plan_type: planType,
    personality,
    goals,
    negotiation_options: goals.map((goal) => buildNegotiatedGoal(goal)),
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
    });
  }

  const performance = calculateBoardPerformance({ board, standing, team, context });
  const overallScore = performance.adjustedOverallScore ?? 0.6;
  const satisfaction = board.satisfaction ?? 50;
  const planType = board.plan_type || "1yr";
  const currentGoals = goals.map((goal) => addGoalMetadata({ ...goal }));
  const goalChanges = [];
  let updatedGoals = currentGoals;
  let nextFocus = board.focus;
  let outcome = "approved";
  let title = "Bestyrelsen accepterer foresporgslen";
  let summary = definition?.description || "Bestyrelsen har justeret planen.";
  let tradeoffSummary = null;

  const rankingIndex = findGoalIndexByCategory(currentGoals, "ranking");
  const resultsIndex = findGoalIndexByCategory(currentGoals, "results");
  const identityIndex = findGoalIndexByCategory(currentGoals, "identity");
  const economyIndex = findGoalIndexByCategory(currentGoals, "economy");

  if (requestType === "lower_results_pressure") {
    if (satisfaction < 35 || overallScore < 0.52) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen synes allerede planen er under nok pres og vil se mere fremgang, for de letter kravene.",
      });
    }

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
    summary = "Bestyrelsen saenker det sportslige pres en smule i den aktive plan.";
    tradeoffSummary = economyIndex >= 0
      ? "Til gaengald bliver okonomikravet skarpere, sa holdet skal drives mere disciplineret resten af planen."
      : "Bestyrelsen giver kun en delvis lettelse, fordi planen stadig skal have tydelige resultater.";
  }

  if (requestType === "more_youth_focus") {
    const youthTemplateGoals = generateBoardGoals({ focus: "youth_development", planType });
    const youthIdentityGoal = youthTemplateGoals.find((goal) => goal.type === "min_u25_riders");
    const youthResultsGoal = youthTemplateGoals.find((goal) => goal.category === "results");

    if (identityIndex >= 0 && youthIdentityGoal) {
      updatedGoals = replaceGoal(updatedGoals, identityIndex, youthIdentityGoal, goalChanges, "replaced");
    }

    if (resultsIndex >= 0 && youthResultsGoal) {
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, buildNegotiatedGoal(youthResultsGoal), goalChanges, "replaced");
    }

    if (rankingIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, buildNegotiatedGoal(updatedGoals[rankingIndex]), goalChanges, "relaxed");
    }

    nextFocus = "youth_development";
    outcome = "tradeoff";
    title = "Bestyrelsen accepterer et mere ungt spor";
    summary = "Planen drejes mere mod udvikling og langsigtet trupbygning.";
    tradeoffSummary = "Til gaengald bliver U25-identiteten nu et tydeligere og mere varigt krav i den aktive plan.";
  }

  if (requestType === "more_results_focus") {
    const resultsTemplateGoals = generateBoardGoals({ focus: "star_signing", planType });
    const resultsRankingGoal = resultsTemplateGoals.find((goal) => goal.type === "top_n_finish");
    const resultsGoal = resultsTemplateGoals.find((goal) => goal.category === "results");

    if (rankingIndex >= 0 && resultsRankingGoal) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, resultsRankingGoal, goalChanges, "tightened");
    }

    if (resultsIndex >= 0 && resultsGoal) {
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, resultsGoal, goalChanges, "replaced");
    }

    if (identityIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, identityIndex, buildNegotiatedGoal(updatedGoals[identityIndex]), goalChanges, "relaxed");
    }

    nextFocus = "star_signing";
    outcome = "approved";
    title = "Bestyrelsen skruer op for ambitionen";
    summary = "Planen vaegter nu topresultater endnu tydeligere end for.";
    tradeoffSummary = "Du faar lidt mere fleksibilitet i identitetskravet, men resultatmaalene er til gengaeld blevet skarpere med det samme.";
  }

  if (requestType === "ease_identity_requirements") {
    if (satisfaction < 40 || overallScore < 0.55) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen vil ikke lempe identitetskravene, foer holdet staar mere stabilt sportsligt.",
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
    title = "Bestyrelsen letter identitetskravet";
    summary = "Holdet faar lidt mere fleksibilitet i trupbygningen og de identitetsbaerende mal.";
    tradeoffSummary = "Til gaengald forventer bestyrelsen et skarpere sportsligt output resten af planen.";
  }

  return {
    request_type: requestType,
    request_label: definition?.label || requestType,
    outcome,
    title,
    summary,
    tradeoff_summary: tradeoffSummary,
    updated_board: {
      focus: nextFocus,
      current_goals: updatedGoals,
    },
    goal_changes: goalChanges,
  };
}

export function finalizeBoardGoals({ goals = [], negotiationIndexes = [] } = {}) {
  const selectedIndexes = new Set(
    (negotiationIndexes || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)
  );

  return goals.map((goal, index) => (
    selectedIndexes.has(index) ? buildNegotiatedGoal(goal) : addGoalMetadata({ ...goal })
  ));
}

export function inferNegotiationIndexesFromGoals({
  goals = [],
  negotiationOptions = [],
  submittedGoals = [],
} = {}) {
  if (!Array.isArray(submittedGoals) || submittedGoals.length !== goals.length) {
    throw new Error("Invalid goals payload");
  }

  const selectedIndexes = [];

  submittedGoals.forEach((submittedGoal, index) => {
    const normalizedSubmitted = normalizeComparableGoal(submittedGoal);
    const normalizedGoal = normalizeComparableGoal(goals[index]);
    const normalizedNegotiation = normalizeComparableGoal(negotiationOptions[index]);

    if (JSON.stringify(normalizedSubmitted) === JSON.stringify(normalizedGoal)) return;

    if (JSON.stringify(normalizedSubmitted) === JSON.stringify(normalizedNegotiation)) {
      selectedIndexes.push(index);
      return;
    }

    throw new Error(`Invalid goal payload at index ${index}`);
  });

  return selectedIndexes;
}

export function evaluateGoal(goal, standing, team, context = {}) {
  const enrichedGoal = addGoalMetadata(goal);
  const { isFinalSeason = true, activeLoanCount = 0, planStartSponsorIncome, currentSponsorIncome } = context;

  switch (enrichedGoal.type) {
    case "top_n_finish":
      return (standing?.rank_in_division || 99) <= enrichedGoal.target;
    case "stage_wins":
      if (enrichedGoal.cumulative) return null;
      return (standing?.stage_wins || 0) >= enrichedGoal.target;
    case "gc_wins":
      if (enrichedGoal.cumulative) return null;
      return (standing?.gc_wins || 0) >= enrichedGoal.target;
    case "min_u25_riders":
      return (team?.riders || []).filter((rider) => rider.is_u25).length >= enrichedGoal.target;
    case "min_riders":
      return (team?.riders || []).length >= enrichedGoal.target;
    case "no_outstanding_debt":
      if (!isFinalSeason) return null;
      return activeLoanCount === 0;
    case "sponsor_growth":
      if (!isFinalSeason) return null;
      if (!planStartSponsorIncome || planStartSponsorIncome === 0) return null;
      return ((currentSponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= enrichedGoal.target;
    default:
      return false;
  }
}

export function countGoalsMet(goals, standing, team, context = {}) {
  if (!goals?.length) return 0;

  return parseBoardGoals(goals).filter((goal) => {
    if (goal.cumulative) return false;
    return evaluateGoal(goal, standing, team, context) === true;
  }).length;
}

export function evaluateGoalProgress(goal, standing, team, context = {}) {
  const enrichedGoal = addGoalMetadata(goal);
  const riders = team?.riders || [];
  const planDuration = Math.max(context.planDuration || 1, 1);
  const seasonsCompleted = Math.max(context.seasonsCompleted || 1, 1);
  const isFinalSeason = Boolean(context.isFinalSeason);
  const cumulativeStageWins = context.cumulativeStats?.stageWins ?? 0;
  const cumulativeGcWins = context.cumulativeStats?.gcWins ?? 0;

  let actual = null;
  let target = enrichedGoal.target;
  let score = 0.5;
  let status = "neutral";
  let missingData = false;

  switch (enrichedGoal.type) {
    case "top_n_finish":
      if (standing?.rank_in_division == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      actual = standing.rank_in_division;
      score = scoreLowerBetter(actual, target);
      status = actual <= target ? "ahead" : score >= 0.65 ? "near_miss" : "behind";
      break;
    case "stage_wins":
      actual = enrichedGoal.cumulative ? cumulativeStageWins : (standing?.stage_wins ?? 0);
      target = enrichedGoal.cumulative
        ? (isFinalSeason
          ? enrichedGoal.target
          : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration)))
        : enrichedGoal.target;
      if (!enrichedGoal.cumulative && standing == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "gc_wins":
      actual = enrichedGoal.cumulative ? cumulativeGcWins : (standing?.gc_wins ?? 0);
      target = enrichedGoal.cumulative
        ? (isFinalSeason
          ? enrichedGoal.target
          : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration)))
        : enrichedGoal.target;
      if (!enrichedGoal.cumulative && standing == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "min_u25_riders":
      actual = riders.filter((rider) => rider.is_u25).length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "min_riders":
      actual = riders.length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "no_outstanding_debt":
      actual = context.activeLoanCount ?? 0;
      score = scoreDebtGoal(actual, isFinalSeason);
      status = actual === 0 ? "ahead" : actual === 1 ? "watch" : "behind";
      break;
    case "sponsor_growth": {
      const planStartSponsorIncome = context.planStartSponsorIncome;
      if (!planStartSponsorIncome || planStartSponsorIncome <= 0) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }

      const currentSponsorIncome = context.currentSponsorIncome ?? team?.sponsor_income ?? 0;
      actual = ((currentSponsorIncome - planStartSponsorIncome) / planStartSponsorIncome) * 100;
      target = isFinalSeason
        ? enrichedGoal.target
        : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration));
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    default:
      actual = null;
      score = 0.5;
      status = "neutral";
      break;
  }

  return {
    ...enrichedGoal,
    actual,
    target,
    score: roundNumber(score),
    score_pct: Math.round(score * 100),
    status,
    missing_data: missingData,
  };
}

export function buildBoardOutlook({ board, standing, team, context = {} } = {}) {
  if (!board) return null;

  const performance = calculateBoardPerformance({ board, standing, team, context });
  return {
    personality: performance.personality,
    feedback: performance.feedback,
    goal_evaluations: performance.goalEvaluations,
    score_breakdown: performance.scoreBreakdown,
    overall_score: performance.adjustedOverallScore,
    status_label: describeOverallStatus(performance.adjustedOverallScore),
  };
}

export function calculateBoardSatisfaction(board, standing, team, context = {}) {
  return evaluateBoardSeason({ board, standing, team, context }).newSatisfaction;
}

export function satisfactionToModifier(satisfaction) {
  if (satisfaction >= 80) return 1.20;
  if (satisfaction >= 60) return 1.10;
  if (satisfaction >= 40) return 1.00;
  if (satisfaction >= 20) return 0.90;
  return 0.80;
}

export function evaluateBoardSeason({ board, standing, team, context = {} } = {}) {
  const performance = calculateBoardPerformance({ board, standing, team, context });
  const expectation = getExpectationBaseline(performance.personality);
  const satisfactionDelta = Math.round((performance.adjustedOverallScore - expectation) * 55);
  const newSatisfaction = clampSatisfaction((board?.satisfaction || 50) + satisfactionDelta);

  return {
    goals: performance.goals,
    goalsMet: countGoalsMet(performance.goals, standing, team, context),
    newSatisfaction,
    newModifier: satisfactionToModifier(newSatisfaction),
    feedback: {
      ...performance.feedback,
      satisfaction_delta: satisfactionDelta,
    },
    goalEvaluations: performance.goalEvaluations,
    personality: performance.personality,
    scoreBreakdown: performance.scoreBreakdown,
    overallScore: performance.adjustedOverallScore,
  };
}

export function createInitialBoardProfile({
  teamId,
  seasonId = null,
  balance = 0,
  sponsorIncome = 100,
  focus = "balanced",
  planType = "1yr",
  negotiationStatus = "pending",
} = {}) {
  return {
    team_id: teamId,
    plan_type: planType,
    focus,
    satisfaction: 50,
    budget_modifier: 1.0,
    season_id: seasonId,
    current_goals: generateBoardGoals({ focus, planType }),
    negotiation_status: negotiationStatus,
    plan_start_balance: balance,
    plan_start_sponsor_income: sponsorIncome,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
  };
}

function addGoalMetadata(goal = {}) {
  const metadata = GOAL_METADATA_BY_TYPE[goal.type] || {};
  return {
    ...goal,
    category: goal.category ?? metadata.category ?? "results",
    importance: goal.importance ?? metadata.importance ?? "required",
    weight: goal.weight ?? metadata.weight ?? 1.0,
  };
}

function getBoardRequestAvailability({ requestType, board, goals = [], context = {} } = {}) {
  if (!board) {
    return { disabled: true, reason: "Ingen aktiv bestyrelsesplan." };
  }

  if (board.negotiation_status !== "completed") {
    return { disabled: true, reason: "Forhandl en ny plan, for du sender requests." };
  }

  if (context.requestUsedThisSeason) {
    return { disabled: true, reason: "Du har allerede brugt saesonens board request." };
  }

  const satisfaction = board.satisfaction ?? 50;
  const overallScore = context.overallScore ?? null;
  const rankingIndex = findGoalIndexByCategory(goals, "ranking");
  const resultsIndex = findGoalIndexByCategory(goals, "results");
  const identityIndex = findGoalIndexByCategory(goals, "identity");

  switch (requestType) {
    case "lower_results_pressure":
      if (rankingIndex < 0 && resultsIndex < 0) {
        return { disabled: true, reason: "Planen har ingen sportslige mal at lempe." };
      }
      if (satisfaction < 35) {
        return { disabled: true, reason: "Bestyrelsen er for utilfreds til at lette resultatkravene." };
      }
      if (overallScore != null && overallScore < 0.52) {
        return { disabled: true, reason: "Bestyrelsen vil se mere fremgang, for de letter resultatkravene." };
      }
      return { disabled: false, reason: null };
    case "more_youth_focus":
      if (board.focus === "youth_development") {
        return { disabled: true, reason: "Planen er allerede i ungdomsretning." };
      }
      if (identityIndex < 0) {
        return { disabled: true, reason: "Planen mangler et identitetsmal at dreje." };
      }
      if (satisfaction < 30) {
        return { disabled: true, reason: "Bestyrelsen vil se mere stabilitet, for de skifter fokus nu." };
      }
      return { disabled: false, reason: null };
    case "more_results_focus":
      if (board.focus === "star_signing") {
        return { disabled: true, reason: "Planen presser allerede efter topresultater." };
      }
      return { disabled: false, reason: null };
    case "ease_identity_requirements":
      if (identityIndex < 0) {
        return { disabled: true, reason: "Planen har intet identitetskrav at lempe." };
      }
      if (satisfaction < 40) {
        return { disabled: true, reason: "Bestyrelsen vil have mere tillid, for de lemper identitetskravet." };
      }
      if (overallScore != null && overallScore < 0.55) {
        return { disabled: true, reason: "Bestyrelsen vil se mere sportslig stabilitet, for de letter identitetskravet." };
      }
      return { disabled: false, reason: null };
    default:
      return { disabled: true, reason: "Ukendt board request." };
  }
}

function buildRejectedBoardRequest({ requestType, reason }) {
  const definition = getBoardRequestDefinition(requestType);

  return {
    request_type: requestType,
    request_label: definition?.label || requestType,
    outcome: "rejected",
    title: "Bestyrelsen afviser foresporgslen",
    summary: reason || "Bestyrelsen afviser foresporgslen lige nu.",
    tradeoff_summary: null,
    updated_board: null,
    goal_changes: [],
  };
}

function findGoalIndexByCategory(goals = [], category) {
  return goals.findIndex((goal) => addGoalMetadata(goal).category === category);
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
    case "min_riders": {
      const nextTarget = enrichedGoal.target + 2;
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

function buildGoalLabel(goal = {}) {
  switch (goal.type) {
    case "top_n_finish":
      return goal.label?.includes("ved planens afslutning")
        ? `Top ${goal.target} i divisionen ved planens afslutning`
        : `Top ${goal.target} i divisionen`;
    case "stage_wins":
      return goal.cumulative
        ? `Mindst ${goal.target} etapesejre over planperioden`
        : `Mindst ${goal.target} etapesejr${goal.target !== 1 ? "er" : ""}`;
    case "gc_wins":
      return goal.cumulative
        ? `Mindst ${goal.target} samlede sejre over planperioden`
        : goal.target === 1
          ? "Mindst 1 samlet sejr"
          : `Mindst ${goal.target} samlede sejre`;
    case "min_u25_riders":
      return `Min. ${goal.target} U25-ryttere pa holdet`;
    case "min_riders":
      return `Hold pa min. ${goal.target} ryttere`;
    case "sponsor_growth":
      return goal.label?.includes("over planperioden")
        ? `Sponsor-indkomst vokset med ${goal.target}% over planperioden`
        : `Sponsor-indkomst vokset med ${goal.target}%`;
    case "no_outstanding_debt":
      return "Ingen udestaende gaeld ved saesonslut";
    default:
      return goal.label || "";
  }
}

function calculateBoardPerformance({ board, standing, team, context = {} } = {}) {
  const goals = parseBoardGoals(board?.current_goals);
  const personality = deriveBoardPersonality({
    focus: board?.focus,
    planType: board?.plan_type,
  });

  const goalEvaluations = goals.map((goal) => evaluateGoalProgress(goal, standing, team, context));
  const scoreBreakdown = calculatePerformanceBreakdown(goalEvaluations, personality);
  const historyAdjustment = applyBoardMemory(scoreBreakdown.overall_score, context.recentSnapshots || []);
  const adjustedOverallScore = clamp(historyAdjustment.adjusted_score, 0, 1.15);
  const feedback = buildBoardFeedback({
    scoreBreakdown: {
      ...scoreBreakdown,
      adjusted_overall_score: adjustedOverallScore,
      recent_history_score: historyAdjustment.recent_score,
      momentum_modifier: historyAdjustment.momentum_modifier,
    },
    personality,
    context,
  });

  return {
    adjustedOverallScore,
    feedback,
    goalEvaluations,
    goals,
    personality,
    scoreBreakdown: {
      ...scoreBreakdown,
      adjusted_overall_score: adjustedOverallScore,
      recent_history_score: historyAdjustment.recent_score,
      momentum_modifier: historyAdjustment.momentum_modifier,
    },
  };
}

function calculatePerformanceBreakdown(goalEvaluations, personality) {
  const weights = getAdjustedCategoryWeights(personality);
  const categoryEntries = Object.entries(CATEGORY_LABELS).map(([key, label]) => {
    const categoryGoals = goalEvaluations.filter((goal) => goal.category === key);
    if (!categoryGoals.length) return [key, null];

    const totalGoalWeight = categoryGoals.reduce((sum, goal) => sum + (goal.weight || 1), 0);
    const score = totalGoalWeight > 0
      ? categoryGoals.reduce((sum, goal) => sum + (goal.score * (goal.weight || 1)), 0) / totalGoalWeight
      : 0.5;

    return [key, {
      key,
      label,
      score: roundNumber(score),
      score_pct: Math.round(score * 100),
      weight: roundNumber(weights[key]),
      goals: categoryGoals.length,
    }];
  });

  const categories = Object.fromEntries(categoryEntries.filter(([, value]) => value));
  const availableWeight = Object.values(categories).reduce((sum, category) => sum + category.weight, 0);
  const weightedScore = availableWeight > 0
    ? Object.values(categories).reduce((sum, category) => sum + (category.score * category.weight), 0) / availableWeight
    : 0.6;

  return {
    categories,
    overall_score: roundNumber(weightedScore),
    overall_pct: Math.round(weightedScore * 100),
  };
}

function applyBoardMemory(currentOverallScore, recentSnapshots) {
  const recentScore = calculateRecentHistoryScore(recentSnapshots);
  if (recentScore == null) {
    return {
      adjusted_score: currentOverallScore,
      recent_score: null,
      momentum_modifier: 0,
    };
  }

  const momentumModifier = clamp((currentOverallScore - recentScore) * 0.10, -0.05, 0.05);
  const adjustedScore = clamp((currentOverallScore * 0.80) + (recentScore * 0.20) + momentumModifier, 0, 1.15);

  return {
    adjusted_score: roundNumber(adjustedScore),
    recent_score: roundNumber(recentScore),
    momentum_modifier: roundNumber(momentumModifier),
  };
}

function calculateRecentHistoryScore(recentSnapshots = []) {
  const usableSnapshots = (recentSnapshots || [])
    .filter((snapshot) => snapshot && snapshot.goals_total > 0)
    .slice(0, 3);

  if (!usableSnapshots.length) return null;

  const totalScore = usableSnapshots.reduce((sum, snapshot) => {
    const goalRatio = snapshot.goals_met / Math.max(snapshot.goals_total, 1);
    const deltaAdjustment = clamp((snapshot.satisfaction_delta || 0) / 40, -0.25, 0.25);
    return sum + clamp(goalRatio + deltaAdjustment, 0, 1.15);
  }, 0);

  return totalScore / usableSnapshots.length;
}

function getAdjustedCategoryWeights(personality) {
  const weights = { ...BASE_CATEGORY_WEIGHTS };

  if (personality.sports_ambition === "high") {
    weights.results *= 1.10;
    weights.ranking *= 1.10;
  } else if (personality.sports_ambition === "low") {
    weights.results *= 0.90;
    weights.ranking *= 0.90;
  }

  if (personality.financial_risk === "cautious") {
    weights.economy *= 1.15;
  } else if (personality.financial_risk === "aggressive") {
    weights.economy *= 0.85;
  }

  if (personality.identity_strength === "high") {
    weights.identity *= 1.15;
  } else if (personality.identity_strength === "low") {
    weights.identity *= 0.85;
  }

  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, roundNumber(value / totalWeight)])
  );
}

function buildBoardFeedback({ scoreBreakdown, personality, context = {} } = {}) {
  const categoryEntries = Object.values(scoreBreakdown?.categories || {});

  if (!categoryEntries.length) {
    return {
      headline: "Bestyrelsen afventer mere data",
      summary: "Ssonens spor er endnu for spinkle til en tydelig vurdering.",
      tone: "neutral",
    };
  }

  const strongestCategory = [...categoryEntries].sort((a, b) => b.score - a.score)[0];
  const weakestCategory = [...categoryEntries].sort((a, b) => a.score - b.score)[0];
  const overallScore = scoreBreakdown.adjusted_overall_score ?? scoreBreakdown.overall_score ?? 0.6;

  if (context.isExpired) {
    return {
      headline: "Planen er udlobet",
      summary: "Bestyrelsen vil forhandle en ny plan ud fra den seneste evaluering og holdets nuvaerende retning.",
      tone: "neutral",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (!context.hasSeasonData && !context.recentSnapshots?.length) {
    return {
      headline: "Bestyrelsen afventer saesonens forste markorer",
      summary: `${personality.summary} Indtil videre er forventningerne intakte, men de sportslige svar kommer forst nar saesonen tager form.`,
      tone: "neutral",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.90) {
    return {
      headline: "Bestyrelsen er meget tilfreds",
      summary: `${strongestCategory.label} driver planen frem, og ${weakestCategory.label.toLowerCase()} er stadig under kontrol.`,
      tone: "positive",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.72) {
    return {
      headline: "Bestyrelsen ser stabil fremgang",
      summary: `${strongestCategory.label} er pa sporet, men ${weakestCategory.label.toLowerCase()} kraever mere fokus for at holde planen sund.`,
      tone: "steady",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.55) {
    return {
      headline: "Bestyrelsen afventer naeste skridt",
      summary: `${weakestCategory.label} halter efter planen, og presset stiger hvis udviklingen ikke vender snart.`,
      tone: "warning",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  return {
    headline: "Bestyrelsen er bekymret",
    summary: `${weakestCategory.label} ligger klart under forventning, og holdet mangler tydelig fremgang i den nuvaerende plan.`,
    tone: "negative",
    strongest_category: strongestCategory.key,
    weakest_category: weakestCategory.key,
  };
}

function normalizeComparableGoal(goal) {
  const enrichedGoal = addGoalMetadata(goal);
  return {
    type: enrichedGoal?.type ?? null,
    target: enrichedGoal?.target ?? null,
    label: enrichedGoal?.label ?? null,
    category: enrichedGoal?.category ?? null,
    importance: enrichedGoal?.importance ?? null,
    weight: enrichedGoal?.weight ?? null,
    cumulative: Boolean(enrichedGoal?.cumulative),
    satisfaction_bonus: enrichedGoal?.satisfaction_bonus ?? 0,
    satisfaction_penalty: enrichedGoal?.satisfaction_penalty ?? 0,
    negotiated: Boolean(enrichedGoal?.negotiated),
  };
}

function describeBoardPersonality(personality) {
  const ambitionLabel = {
    low: "lav sportslig ambition",
    medium: "moderat sportslig ambition",
    high: "hoj sportslig ambition",
  }[personality.sports_ambition] || "moderat sportslig ambition";

  const riskLabel = {
    cautious: "forsigtig okonomisk risikovillighed",
    balanced: "balanceret okonomisk risikovillighed",
    aggressive: "aggressiv okonomisk risikovillighed",
  }[personality.financial_risk] || "balanceret okonomisk risikovillighed";

  const identityLabel = {
    low: "svag identitetsstyrke",
    medium: "moderat identitetsstyrke",
    high: "stark identitetsstyrke",
  }[personality.identity_strength] || "moderat identitetsstyrke";

  return `${ambitionLabel}, ${riskLabel} og ${identityLabel}.`;
}

function describeOverallStatus(score) {
  if (score >= 0.90) return "Meget staerkt";
  if (score >= 0.72) return "Pa sporet";
  if (score >= 0.55) return "Usikkert";
  return "Under pres";
}

function getExpectationBaseline(personality) {
  const baselineByAmbition = {
    low: 0.58,
    medium: 0.62,
    high: 0.66,
  };

  return baselineByAmbition[personality.sports_ambition] ?? 0.62;
}

function shiftLevel(level, delta) {
  const currentIndex = LEVELS.indexOf(level);
  const nextIndex = clamp(currentIndex + delta, 0, LEVELS.length - 1);
  return LEVELS[nextIndex];
}

function scoreHigherBetter(actual, target) {
  if (actual == null) return 0.6;

  const safeTarget = target > 0 ? target : 1;
  if (target <= 0) return actual <= 0 ? 1.05 : 1.15;

  const ratio = actual / safeTarget;
  if (ratio >= 1) {
    return clamp(1 + Math.min(0.15, (ratio - 1) * 0.25), 0, 1.15);
  }

  return clamp(Math.pow(Math.max(ratio, 0), 0.70), 0, 1.0);
}

function scoreLowerBetter(actual, target) {
  if (actual == null) return 0.6;

  const safeTarget = Math.max(target || 1, 1);
  if (actual <= safeTarget) {
    const margin = (safeTarget - actual) / safeTarget;
    return clamp(1 + Math.min(0.15, margin * 0.20), 0, 1.15);
  }

  const miss = actual - safeTarget;
  const tolerance = Math.max(4, safeTarget);
  return clamp(1 - (miss / tolerance), 0, 1.0);
}

function scoreDebtGoal(activeLoanCount, isFinalSeason) {
  if (activeLoanCount === 0) return isFinalSeason ? 1.05 : 1.0;
  if (activeLoanCount === 1) return 0.65;
  if (activeLoanCount === 2) return 0.35;
  return 0.15;
}

function roundNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampSatisfaction(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}
