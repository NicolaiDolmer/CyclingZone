import {
  VALID_BOARD_FOCUSES,
  VALID_BOARD_PLAN_TYPES,
  VALID_BOARD_REQUEST_TYPES,
  BOARD_REQUEST_DEFINITIONS,
} from "./boardConstants.js";
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
  return definition ? { type: requestType, ...definition } : null;
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
      });
    }

    if (strongStarProfile && (satisfaction < 60 || overallScore < 0.66)) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen afviser at saenke ambitionsniveauet for et hold med tydelige profiler, fordi sponsorernes forventninger allerede er skruet op.",
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
    summary = strongStarProfile
      ? "Bestyrelsen giver kun lidt luft, fordi et hold med store profiler stadig bliver holdt op pa hoje forventninger."
      : "Bestyrelsen saenker det sportslige pres en smule i den aktive plan.";
    tradeoffSummary = economyIndex >= 0
      ? strongStarProfile
        ? "Profilerne giver sponsorprojektet tyngde, men de betyder ogsa at boardet strammer okonomikravet i stedet for at slippe ambitionerne helt."
        : "Til gaengald bliver okonomikravet skarpere, sa holdet skal drives mere disciplineret resten af planen."
      : "Bestyrelsen giver kun en delvis lettelse, fordi planen stadig skal have tydelige resultater.";
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
      updatedGoals = replaceGoal(updatedGoals, resultsIndex, buildNegotiatedGoal(youthResultsGoal), goalChanges, "replaced");
    }

    if (rankingIndex >= 0) {
      updatedGoals = replaceGoal(updatedGoals, rankingIndex, buildNegotiatedGoal(updatedGoals[rankingIndex]), goalChanges, "relaxed");
    }

    nextFocus = usesBalancedBridge ? "balanced" : "youth_development";
    outcome = "tradeoff";
    title = usesBalancedBridge
      ? "Bestyrelsen accepterer kun en gradvis drejning"
      : "Bestyrelsen accepterer et mere ungt spor";
    summary = usesBalancedBridge
      ? "Bestyrelsen vil gerne se mere udvikling, men et hold med tydelige profiler kan ikke skifte helt spor pa en gang."
      : identityProfile?.youth_level === "high"
        ? "Bestyrelsen ser allerede et ungdomsspor i truppen og drejer planen tydeligere mod udvikling."
        : strongNationalCore
          ? "Bestyrelsen ser en tydelig kerne i truppen og accepterer at dreje planen mod en mere langsigtet udviklingsretning."
          : "Planen drejes mere mod udvikling og langsigtet trupbygning.";
    tradeoffSummary = usesBalancedBridge
      ? "Planen bliver mere ungdomsorienteret, men boardet holder fokus i en balanceret mellemstation og slipper ikke resultatpresset helt endnu."
      : "Til gaengald bliver U25-identiteten nu et tydeligere og mere varigt krav i den aktive plan.";
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

    if (rankingIndex >= 0 && resultsRankingGoal) {
      updatedGoals = replaceGoal(
        updatedGoals,
        rankingIndex,
        usesBalancedBridge ? buildNegotiatedGoal(resultsRankingGoal) : resultsRankingGoal,
        goalChanges,
        "tightened"
      );
    }

    if (resultsIndex >= 0 && resultsGoal) {
      updatedGoals = replaceGoal(
        updatedGoals,
        resultsIndex,
        usesBalancedBridge ? buildNegotiatedGoal(resultsGoal) : resultsGoal,
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
    summary = usesBalancedBridge
      ? "Bestyrelsen vil gerne se mere resultattryk, men et udtalt ungdomsspor bliver kun flyttet gradvist over mod en mere ambitiost mellemposition."
      : strongStarProfile
        ? "Store profiler og sponsorernes forventninger faar bestyrelsen til at skrue op for ambitionen med det samme."
        : ["gc", "sprint", "classics"].includes(identityProfile?.primary_specialization)
          ? "Bestyrelsen laeser holdet som klar til at jagte stoerre resultater og skruer op for ambitionen."
          : "Planen vaegter nu topresultater endnu tydeligere end for.";
    tradeoffSummary = usesBalancedBridge
      ? "Boardet holder fast i en del af udviklingssporet, sa holdet ma bevise det nye ambitionsniveau over tid."
      : "Du faar lidt mere fleksibilitet i identitetskravet, men resultatmaalene er til gengaeld blevet skarpere med det samme.";
  }

  if (requestType === "ease_identity_requirements") {
    if (satisfaction < 40 || overallScore < 0.55) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen vil ikke lempe identitetskravene, foer holdet staar mere stabilt sportsligt.",
      });
    }

    if (strongNationalCore && satisfaction < 65) {
      return buildRejectedBoardRequest({
        requestType,
        reason: "Bestyrelsen ser den nationale kerne som en vigtig del af holdets DNA og vil ikke slippe den endnu.",
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
    summary = strongNationalCore
      ? "Bestyrelsen ser stadig den nationale kerne som en vigtig del af holdets DNA og giver kun lidt mere fleksibilitet i identitetskravet."
      : "Holdet faar lidt mere fleksibilitet i trupbygningen og de identitetsbaerende mal.";
    tradeoffSummary = strongNationalCore
      ? "Den nationale identitet bliver ikke sluppet helt, og bestyrelsen forventer til gaengald et skarpere sportsligt output resten af planen."
      : "Til gaengald forventer bestyrelsen et skarpere sportsligt output resten af planen.";
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
        return { disabled: true, reason: "Planen har ingen sportslige mal at lempe." };
      }
      if (satisfaction < 35) {
        return { disabled: true, reason: "Bestyrelsen er for utilfreds til at lette resultatkravene." };
      }
      if (overallScore != null && overallScore < 0.52) {
        return { disabled: true, reason: "Bestyrelsen vil se mere fremgang, for de letter resultatkravene." };
      }
      if (strongStarProfile && satisfaction < 60) {
        return { disabled: true, reason: "Store profiler holder sponsorernes forventninger hoje, sa boardet letter ikke resultatkravene endnu." };
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
      if (identityProfile?.youth_level === "low" && satisfaction < 45) {
        return { disabled: true, reason: "Bestyrelsen vil se en tydeligere ungdomsbase i truppen, for de skifter fokus." };
      }
      return { disabled: false, reason: null };
    case "more_results_focus":
      if (board.focus === "star_signing") {
        return { disabled: true, reason: "Planen presser allerede efter topresultater." };
      }
      if (identityProfile?.squad_status === "thin" && satisfaction < 45) {
        return { disabled: true, reason: "Bestyrelsen vil se en bredere trup, for de skruer yderligere op for ambitionsniveauet." };
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
      if (strongNationalCore && satisfaction < 65) {
        return { disabled: true, reason: "Bestyrelsen ser den nationale kerne som en vigtig del af holdets DNA og slipper den ikke endnu." };
      }
      if (identityProfile?.primary_specialization === "youth" && identityProfile?.youth_level === "high" && satisfaction < 55) {
        return { disabled: true, reason: "Bestyrelsen ser ungdomssporet som en kerne af holdets identitet og slipper det ikke endnu." };
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
