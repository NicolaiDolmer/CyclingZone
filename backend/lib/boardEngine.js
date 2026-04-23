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

const DIVISION_SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
  3: { min: 8, max: 10 },
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
  min_national_riders: { category: "identity", importance: "required", weight: 1.0 },
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

const SPECIALIZATION_LABELS = {
  gc: "GC-hold",
  sprint: "Sprinthold",
  classics: "Klassikerhold",
  breakaway: "Etapejaegerhold",
  youth: "Ungdomshold",
  balanced: "Balanceret hold",
};

const COMPETITIVE_TIER_LABELS = {
  contender: "Resultatklar",
  competitive: "Konkurrencedygtig",
  rebuilding: "Under opbygning",
};

const SQUAD_STATUS_LABELS = {
  thin: "Tynd trup",
  healthy: "Sund trup",
  full: "Bred trup",
};

const LEVELS = ["low", "medium", "high"];

const NATIONAL_CORE_IDENTITY_BONUS_BY_STRENGTH = {
  none: 0,
  low: 0.01,
  medium: 0.03,
  high: 0.05,
};

const STAR_PROFILE_PRESTIGE_BONUS_BY_LEVEL = {
  low: 0,
  medium: 0.02,
  high: 0.04,
  elite: 0.06,
};

const STAR_PROFILE_GOAL_PRESSURE_BY_LEVEL = {
  low: 0,
  medium: 0,
  high: 1,
  elite: 1,
};

const STAR_PROFILE_SPONSOR_PRESSURE_BY_LEVEL = {
  low: 0,
  medium: 0,
  high: 5,
  elite: 10,
};

export const BOARD_IDENTITY_RIDER_SELECT = [
  "id",
  "is_u25",
  "salary",
  "uci_points",
  "nationality_code",
  "popularity",
  "stat_fl",
  "stat_bj",
  "stat_kb",
  "stat_bk",
  "stat_tt",
  "stat_bro",
  "stat_sp",
  "stat_acc",
  "stat_udh",
  "stat_mod",
  "stat_res",
  "stat_ftr",
].join(", ");

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

export function generateBoardGoals({
  focus = "balanced",
  planType = "1yr",
  team = null,
  riders = [],
  standing = null,
} = {}) {
  const planDuration = getPlanDuration(planType);
  const isMultiYear = planDuration > 1;
  const penaltyModifier = PLAN_PENALTY_MODIFIERS[planType] || 1.0;
  const riderPool = Array.isArray(riders) && riders.length
    ? riders
    : Array.isArray(team?.riders)
      ? team.riders
      : [];
  const division = normalizeDivision(team?.division ?? standing?.division);
  const useDynamicTargets = division != null || riderPool.length > 0 || standing?.rank_in_division != null;
  const identityProfile = useDynamicTargets
    ? deriveTeamIdentityProfile({ team, riders: riderPool, standing })
    : null;
  const squadLimits = identityProfile?.squad_limits || (division != null ? getDivisionSquadLimits(division) : null);

  const youthRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 5,
      focus: "youth_development",
      division,
      standing,
      identityProfile,
    })
    : 5;
  const starRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 3,
      focus: "star_signing",
      division,
      standing,
      identityProfile,
    })
    : 3;
  const balancedRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 4,
      focus: "balanced",
      division,
      standing,
      identityProfile,
    })
    : 4;
  const youthStageWinsTarget = useDynamicTargets
    ? getDynamicStageWinsTarget({
      baseTarget: isMultiYear ? Math.round(planDuration * 0.8) : 1,
      focus: "youth_development",
      planDuration,
      isMultiYear,
      standing,
      identityProfile,
    })
    : (isMultiYear ? Math.round(planDuration * 0.8) : 1);
  const starGcWinsTarget = useDynamicTargets
    ? getDynamicGcWinsTarget({
      baseTarget: isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1,
      planDuration,
      isMultiYear,
      identityProfile,
    })
    : (isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1);
  const balancedStageTarget = useDynamicTargets
    ? getDynamicStageWinsTarget({
      baseTarget: isMultiYear ? Math.round(2 * planDuration * 0.7) : 2,
      focus: "balanced",
      planDuration,
      isMultiYear,
      standing,
      identityProfile,
    })
    : (isMultiYear ? Math.round(2 * planDuration * 0.7) : 2);
  const youthU25Target = useDynamicTargets
    ? getDynamicU25Target({
      planDuration,
      division,
      identityProfile,
    })
    : 5;
  const starMinRidersTarget = useDynamicTargets
    ? getDynamicMinRiderTarget({
      focus: "star_signing",
      identityProfile,
    })
    : 20;
  const balancedMinRidersTarget = useDynamicTargets
    ? getDynamicMinRiderTarget({
      focus: "balanced",
      identityProfile,
    })
    : 15;
  const balancedNationalIdentityGoal = useDynamicTargets
    ? buildNationalIdentityGoal({ identityProfile })
    : null;
  const sponsorGrowthTarget = useDynamicTargets
    ? getDynamicSponsorGrowthTarget({
      baseTarget: isMultiYear ? planDuration * 5 : 10,
      focus: "star_signing",
      planDuration,
      division,
      standing,
      team,
      identityProfile,
    })
    : (isMultiYear ? planDuration * 5 : 10);

  const baseGoals = {
    youth_development: [
      {
        type: "min_u25_riders",
        target: youthU25Target,
        label: `Min. ${youthU25Target} U25-ryttere pa holdet`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
      {
        type: "top_n_finish",
        target: youthRankingTarget,
        label: isMultiYear
          ? `Top ${youthRankingTarget} i divisionen ved planens afslutning`
          : `Top ${youthRankingTarget} i divisionen`,
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "stage_wins",
        target: youthStageWinsTarget,
        label: isMultiYear
          ? `Mindst ${youthStageWinsTarget} etapesejre over planperioden`
          : `Mindst ${youthStageWinsTarget} etapesejr${youthStageWinsTarget !== 1 ? "er" : ""}`,
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
        target: starRankingTarget,
        label: isMultiYear
          ? `Top ${starRankingTarget} i divisionen ved planens afslutning`
          : `Top ${starRankingTarget} i divisionen`,
        satisfaction_bonus: 20,
        satisfaction_penalty: 15,
      },
      {
        type: "gc_wins",
        target: starGcWinsTarget,
        label: isMultiYear
          ? `Mindst ${starGcWinsTarget} samlede sejre over planperioden`
          : starGcWinsTarget === 1
            ? "Mindst 1 samlet sejr"
            : `Mindst ${starGcWinsTarget} samlede sejre`,
        cumulative: isMultiYear,
        satisfaction_bonus: 25,
        satisfaction_penalty: 10,
      },
      {
        type: "min_riders",
        target: starMinRidersTarget,
        label: `Hold pa min. ${starMinRidersTarget} ryttere`,
        min_target: squadLimits?.min ?? 5,
        max_target: squadLimits?.max ?? null,
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "sponsor_growth",
        target: sponsorGrowthTarget,
        label: isMultiYear
          ? `Sponsor-indkomst vokset med ${sponsorGrowthTarget}% over planperioden`
          : `Sponsor-indkomst vokset med ${sponsorGrowthTarget}%`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
    ],
    balanced: [
      {
        type: "top_n_finish",
        target: balancedRankingTarget,
        label: isMultiYear
          ? `Top ${balancedRankingTarget} i divisionen ved planens afslutning`
          : `Top ${balancedRankingTarget} i divisionen`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 8,
      },
      balancedNationalIdentityGoal || {
        type: "min_riders",
        target: balancedMinRidersTarget,
        label: `Hold pa min. ${balancedMinRidersTarget} ryttere`,
        min_target: squadLimits?.min ?? 5,
        max_target: squadLimits?.max ?? null,
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "stage_wins",
        target: balancedStageTarget,
        label: isMultiYear
          ? `Mindst ${balancedStageTarget} etapesejre over planperioden`
          : `Mindst ${balancedStageTarget} etapesejr${balancedStageTarget !== 1 ? "er" : ""}`,
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
    case "min_national_riders": {
      const target = Math.max(2, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_riders": {
      const target = Math.max(enrichedGoal.min_target ?? 5, enrichedGoal.target - 3);
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

export function buildBoardProposal({
  focus = "balanced",
  planType = "1yr",
  team = null,
  riders = [],
  standing = null,
} = {}) {
  const goals = generateBoardGoals({ focus, planType, team, riders, standing });
  const personality = deriveBoardPersonality({ focus, planType });
  const identityProfile = deriveTeamIdentityProfile({ team, riders, standing });

  return {
    focus,
    plan_type: planType,
    personality,
    identity_profile: identityProfile,
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
    case "min_national_riders":
      return (team?.riders || [])
        .filter((rider) => normalizeBoardRider(rider).nationality_code === enrichedGoal.nationality_code)
        .length >= enrichedGoal.target;
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
    case "min_national_riders":
      actual = riders
        .filter((rider) => normalizeBoardRider(rider).nationality_code === enrichedGoal.nationality_code)
        .length;
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
    identity_profile: performance.identityProfile,
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
    identityProfile: performance.identityProfile,
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

export function deriveTeamIdentityProfile({ team = null, riders = [], standing = null } = {}) {
  const riderPool = Array.isArray(riders) && riders.length
    ? riders
    : Array.isArray(team?.riders)
      ? team.riders
      : [];
  const division = normalizeDivision(team?.division ?? standing?.division) ?? 3;
  const squadLimits = getDivisionSquadLimits(division);
  const normalizedRiders = riderPool.map((rider) => normalizeBoardRider(rider));
  const riderCount = normalizedRiders.length;
  const u25Count = normalizedRiders.filter((rider) => rider.is_u25).length;
  const u25Share = riderCount > 0 ? u25Count / riderCount : 0;
  const youthLevel = u25Share >= 0.45 ? "high" : u25Share >= 0.25 ? "medium" : "low";
  const squadStatus = riderCount <= squadLimits.min
    ? "thin"
    : riderCount >= Math.max(squadLimits.max - 1, squadLimits.min)
      ? "full"
      : "healthy";
  const competitiveTier = deriveCompetitiveTier({ division, standing });
  const specializationScores = calculateTeamSpecializationScores(normalizedRiders, u25Share);
  const nationalCore = calculateNationalCore(normalizedRiders);
  const starProfile = calculateStarProfile(normalizedRiders);
  const [primaryEntry, secondaryEntry] = Object.entries(specializationScores)
    .sort((a, b) => b[1] - a[1]);
  const primarySpecialization = riderCount === 0 ? "balanced" : (primaryEntry?.[0] || "balanced");
  const secondarySpecialization = riderCount === 0 ? "youth" : (secondaryEntry?.[0] || "balanced");

  return {
    division,
    squad_limits: squadLimits,
    rider_count: riderCount,
    u25_count: u25Count,
    u25_share_pct: Math.round(u25Share * 100),
    youth_level: youthLevel,
    squad_status: squadStatus,
    squad_status_label: SQUAD_STATUS_LABELS[squadStatus] || SQUAD_STATUS_LABELS.healthy,
    competitive_tier: competitiveTier,
    competitive_tier_label: COMPETITIVE_TIER_LABELS[competitiveTier] || COMPETITIVE_TIER_LABELS.competitive,
    primary_specialization: primarySpecialization,
    primary_specialization_label: SPECIALIZATION_LABELS[primarySpecialization] || SPECIALIZATION_LABELS.balanced,
    secondary_specialization: secondarySpecialization,
    secondary_specialization_label: SPECIALIZATION_LABELS[secondarySpecialization] || SPECIALIZATION_LABELS.balanced,
    national_core: nationalCore,
    star_profile: starProfile,
    summary: buildIdentityProfileSummary({
      primarySpecialization,
      secondarySpecialization,
      youthLevel,
      squadStatus,
      nationalCore,
      starProfile,
    }),
  };
}

function normalizeDivision(division) {
  const normalizedDivision = Number(division);
  return DIVISION_SQUAD_LIMITS[normalizedDivision] ? normalizedDivision : null;
}

function getDivisionSquadLimits(division) {
  return DIVISION_SQUAD_LIMITS[normalizeDivision(division) ?? 3];
}

function deriveCompetitiveTier({ division, standing } = {}) {
  const rank = standing?.rank_in_division;
  if (rank != null) {
    if (rank <= 2) return "contender";
    if (rank <= 4) return "competitive";
    return "rebuilding";
  }

  return (division ?? 3) === 1 ? "competitive" : "rebuilding";
}

function normalizeBoardRider(rider = {}) {
  const numericKeys = [
    "uci_points",
    "popularity",
    "stat_fl",
    "stat_bj",
    "stat_kb",
    "stat_bk",
    "stat_tt",
    "stat_bro",
    "stat_sp",
    "stat_acc",
    "stat_udh",
    "stat_mod",
    "stat_res",
    "stat_ftr",
  ];

  const normalizedRider = {
    is_u25: Boolean(rider.is_u25),
    nationality_code: typeof rider.nationality_code === "string"
      ? rider.nationality_code.trim().toUpperCase()
      : null,
  };

  numericKeys.forEach((key) => {
    normalizedRider[key] = Number(rider?.[key] || 0);
  });

  return normalizedRider;
}

function calculateNationalCore(riders = []) {
  if (!riders.length) {
    return {
      code: null,
      count: 0,
      share_pct: 0,
      strength: "none",
      established: false,
      label: "Blandet trup",
    };
  }

  const nationalityCounts = new Map();
  riders.forEach((rider) => {
    if (!rider.nationality_code) return;
    nationalityCounts.set(
      rider.nationality_code,
      (nationalityCounts.get(rider.nationality_code) || 0) + 1
    );
  });

  const [code, count] = [...nationalityCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0] || [];

  if (!code || !count) {
    return {
      code: null,
      count: 0,
      share_pct: 0,
      strength: "none",
      established: false,
      label: "Blandet trup",
    };
  }

  const share = count / Math.max(riders.length, 1);
  const strength = share >= 0.55 ? "high" : share >= 0.40 ? "medium" : share >= 0.30 ? "low" : "none";
  const established = count >= 4 && share >= 0.35;

  return {
    code,
    count,
    share_pct: Math.round(share * 100),
    strength,
    established,
    label: established
      ? strength === "high"
        ? `Tydelig ${code}-kerne`
        : `${code}-kerne`
      : "Blandet trup",
  };
}

function calculateStarProfile(riders = []) {
  if (!riders.length) {
    return {
      level: "low",
      label: "Ukendt",
      headline_score: 0,
      star_rider_count: 0,
      share_pct: 0,
    };
  }

  const starScores = riders.map((rider) => calculateRiderStarScore(rider));
  const headlineScores = [...starScores]
    .sort((a, b) => b - a)
    .slice(0, Math.min(3, starScores.length));
  const headlineScore = averageNumbers(headlineScores);
  const starRiderCount = starScores.filter((score) => score >= 68).length;
  const sharePct = Math.round((starRiderCount / riders.length) * 100);

  let level = "low";
  if (headlineScore >= 82 || starRiderCount >= 3) {
    level = "elite";
  } else if (headlineScore >= 68 || starRiderCount >= 2) {
    level = "high";
  } else if (headlineScore >= 52 || starRiderCount >= 1) {
    level = "medium";
  }

  return {
    level,
    label: {
      low: "Ukendt",
      medium: "Lokalkendt",
      high: "Nationalt kendt",
      elite: "Verdenskendt",
    }[level] || "Ukendt",
    headline_score: Math.round(headlineScore),
    star_rider_count: starRiderCount,
    share_pct: sharePct,
  };
}

function calculateRiderStarScore(rider = {}) {
  const popularityScore = clamp(Number(rider.popularity || 0), 0, 100);
  const uciScore = clamp(Math.round(Number(rider.uci_points || 0) / 4.5), 0, 100);
  return roundNumber((popularityScore * 0.70) + (uciScore * 0.30));
}

function getNationalCoreIdentityBonus(nationalCore = null, hasExplicitNationalGoal = false) {
  if (!nationalCore?.established) return 0;

  const baseBonus = NATIONAL_CORE_IDENTITY_BONUS_BY_STRENGTH[nationalCore.strength || "none"] || 0;
  return roundNumber(hasExplicitNationalGoal ? (baseBonus * 0.5) : baseBonus);
}

function getStarProfilePrestigeBonus(starProfile = null) {
  return STAR_PROFILE_PRESTIGE_BONUS_BY_LEVEL[starProfile?.level || "low"] || 0;
}

function getStarProfileGoalPressure(starProfile = null) {
  return STAR_PROFILE_GOAL_PRESSURE_BY_LEVEL[starProfile?.level || "low"] || 0;
}

function getStarProfileSponsorPressure(starProfile = null) {
  return STAR_PROFILE_SPONSOR_PRESSURE_BY_LEVEL[starProfile?.level || "low"] || 0;
}

function hasStrongNationalCore(identityProfile = null) {
  return Boolean(
    identityProfile?.national_core?.established
    && ["medium", "high"].includes(identityProfile?.national_core?.strength)
  );
}

function hasStrongStarProfile(identityProfile = null) {
  return ["high", "elite"].includes(identityProfile?.star_profile?.level);
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

function calculateTeamSpecializationScores(riders = [], u25Share = 0) {
  if (!riders.length) {
    return {
      gc: 0,
      sprint: 0,
      classics: 0,
      breakaway: 0,
      youth: roundNumber(u25Share * 100),
      balanced: 1,
    };
  }

  const scoreByKeys = (keys) => averageTopScores(
    riders,
    (rider) => averageNumbers(keys.map((key) => rider[key] || 0))
  );

  return {
    gc: scoreByKeys(["stat_bj", "stat_kb", "stat_tt", "stat_mod", "stat_res"]),
    sprint: scoreByKeys(["stat_fl", "stat_sp", "stat_acc", "stat_res"]),
    classics: scoreByKeys(["stat_fl", "stat_bk", "stat_bro", "stat_mod"]),
    breakaway: scoreByKeys(["stat_bj", "stat_kb", "stat_ftr", "stat_udh"]),
    youth: roundNumber((u25Share * 100) + (scoreByKeys(["stat_kb", "stat_udh", "stat_res"]) * 0.15)),
    balanced: roundNumber(scoreByKeys(["stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_sp"]) * 0.92),
  };
}

function averageTopScores(items = [], scorer) {
  const scores = (items || [])
    .map((item) => scorer(item))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
    .slice(0, Math.min(5, items.length));

  if (!scores.length) return 0;

  return roundNumber(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

function averageNumbers(values = []) {
  const safeValues = (values || []).filter((value) => Number.isFinite(value));
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function buildIdentityProfileSummary({
  primarySpecialization = "balanced",
  secondarySpecialization = "balanced",
  youthLevel = "medium",
  squadStatus = "healthy",
  nationalCore = null,
  starProfile = null,
} = {}) {
  const youthLabel = {
    high: "starkt ungdomsaftryk",
    medium: "moderat ungdomsandel",
    low: "lav ungdomsandel",
  }[youthLevel] || "moderat ungdomsandel";
  const squadLabel = {
    thin: "en tynd trup",
    healthy: "en sund trup",
    full: "en bred trup",
  }[squadStatus] || "en sund trup";
  const primaryLabel = SPECIALIZATION_LABELS[primarySpecialization] || SPECIALIZATION_LABELS.balanced;
  const secondaryLabel = (SPECIALIZATION_LABELS[secondarySpecialization] || SPECIALIZATION_LABELS.balanced).toLowerCase();
  const nationalLabel = nationalCore?.established && nationalCore?.code
    ? `${nationalCore.code}-kerne pa ${nationalCore.share_pct}%`
    : "blandet national profil";
  const starLabel = starProfile?.label
    ? `stjerneprofil: ${starProfile.label.toLowerCase()}`
    : "ingen tydelig stjerneprofil";

  return `${primaryLabel} med sekundar ${secondaryLabel}-retning, ${youthLabel}, ${squadLabel}, ${nationalLabel} og ${starLabel}.`;
}

function getDynamicRankingTarget({ baseTarget, focus, division, standing, identityProfile } = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (division === 2) target += 1;
  if (division === 3) target += 1;

  if (standing?.rank_in_division != null) {
    if (standing.rank_in_division <= 2) target -= 1;
    if (standing.rank_in_division >= 6) target += 1;
  }

  if (focus === "star_signing" && identityProfile?.competitive_tier === "contender") {
    target -= 1;
  }

  if (focus === "star_signing" && starPressure > 0) {
    target -= starPressure;
  } else if (
    focus === "balanced"
    && starPressure > 0
    && identityProfile?.competitive_tier !== "rebuilding"
  ) {
    target -= 1;
  }

  if (focus === "youth_development" && identityProfile?.squad_status === "thin") {
    target += 1;
  }

  return clamp(target, 2, 8);
}

function getDynamicStageWinsTarget({
  baseTarget,
  focus,
  planDuration,
  isMultiYear,
  standing,
  identityProfile,
} = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (["sprint", "classics", "breakaway"].includes(identityProfile?.primary_specialization)) {
    target += 1;
  }

  if (identityProfile?.competitive_tier === "contender" && focus !== "youth_development") {
    target += 1;
  }

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  if (focus === "youth_development" && identityProfile?.youth_level === "high" && isMultiYear) {
    target += 1;
  }

  if (standing?.rank_in_division >= 6 && focus === "youth_development") {
    target = Math.max(1, target - 1);
  }

  if (focus === "balanced" && starPressure > 0 && identityProfile?.competitive_tier !== "rebuilding") {
    target += 1;
  }

  return clamp(target, 1, isMultiYear ? planDuration + 3 : 4);
}

function getDynamicGcWinsTarget({ baseTarget, planDuration, isMultiYear, identityProfile } = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (identityProfile?.primary_specialization === "gc") {
    target += 1;
  } else if (identityProfile?.secondary_specialization === "gc" && isMultiYear) {
    target += 1;
  }

  target += starPressure;

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  return clamp(target, 1, isMultiYear ? planDuration + 2 : 3);
}

function getDynamicU25Target({ planDuration, division, identityProfile } = {}) {
  let target = division === 1 ? 6 : division === 2 ? 5 : 4;

  if (identityProfile?.youth_level === "high") {
    target += 1;
  }

  if (identityProfile?.competitive_tier === "rebuilding" && planDuration > 1) {
    target += 1;
  }

  const upperBound = Math.max(3, Math.min((identityProfile?.squad_limits?.max ?? 12) - 1, 8));
  return clamp(target, 3, upperBound);
}

function getDynamicNationalRiderTarget({ identityProfile } = {}) {
  const nationalCore = identityProfile?.national_core;
  if (!nationalCore?.established) return null;

  const upperBound = Math.min(
    identityProfile?.squad_limits?.max ?? nationalCore.count,
    nationalCore.count
  );
  const target = Math.max(3, Math.round(nationalCore.count * 0.75));
  return clamp(target, 3, upperBound);
}

function buildNationalIdentityGoal({ identityProfile } = {}) {
  const nationalCore = identityProfile?.national_core;
  const target = getDynamicNationalRiderTarget({ identityProfile });

  if (!nationalCore?.established || !nationalCore?.code || !target) {
    return null;
  }

  return addGoalMetadata({
    type: "min_national_riders",
    target,
    nationality_code: nationalCore.code,
    label: buildGoalLabel({
      type: "min_national_riders",
      target,
      nationality_code: nationalCore.code,
    }),
    satisfaction_bonus: 8,
    satisfaction_penalty: 8,
  });
}

function getDynamicMinRiderTarget({ focus, identityProfile } = {}) {
  const squadLimits = identityProfile?.squad_limits || getDivisionSquadLimits(identityProfile?.division);
  const range = Math.max(squadLimits.max - squadLimits.min, 0);
  let target = focus === "star_signing"
    ? squadLimits.min + Math.max(1, Math.ceil(range * 0.5))
    : squadLimits.min + Math.max(1, Math.ceil(range * 0.25));

  if (identityProfile?.competitive_tier === "contender" && focus === "star_signing") {
    target += 1;
  }

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  return clamp(target, squadLimits.min, squadLimits.max);
}

function getDynamicSponsorGrowthTarget({
  baseTarget,
  focus,
  planDuration,
  division,
  standing,
  team,
  identityProfile,
} = {}) {
  let target = baseTarget;
  const sponsorPressure = getStarProfileSponsorPressure(identityProfile?.star_profile);

  if (division === 3) {
    target -= 5;
  }

  if (standing?.rank_in_division != null && standing.rank_in_division <= 2) {
    target += 5;
  }

  if ((team?.balance ?? 0) < 0) {
    target -= 5;
  }

  if (focus === "star_signing" && identityProfile?.competitive_tier === "contender") {
    target += 5;
  }

  target += sponsorPressure;

  return clampToStep(target, 5, 5, planDuration > 1 ? 30 : 20);
}

function clampToStep(value, min, step, max) {
  const steppedValue = Math.round(value / step) * step;
  return clamp(steppedValue, min, max);
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
    case "min_national_riders":
      return `Min. ${goal.target} ryttere fra ${goal.nationality_code || "holdets kerne"}`;
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
  const identityProfile = deriveTeamIdentityProfile({
    team,
    riders: team?.riders || [],
    standing,
  });
  const personality = deriveBoardPersonality({
    focus: board?.focus,
    planType: board?.plan_type,
  });

  const goalEvaluations = goals.map((goal) => evaluateGoalProgress(goal, standing, team, context));
  const scoreBreakdown = calculatePerformanceBreakdown(goalEvaluations, personality, identityProfile);
  const historyAdjustment = applyBoardMemory(scoreBreakdown.overall_score, context.recentSnapshots || []);
  const adjustedOverallScore = clamp(historyAdjustment.adjusted_score, 0, 1.15);
  const feedback = buildBoardFeedback({
    scoreBreakdown: {
      ...scoreBreakdown,
      adjusted_overall_score: adjustedOverallScore,
      recent_history_score: historyAdjustment.recent_score,
      momentum_modifier: historyAdjustment.momentum_modifier,
    },
    identityProfile,
    personality,
    context,
  });

  return {
    adjustedOverallScore,
    feedback,
    goalEvaluations,
    goals,
    identityProfile,
    personality,
    scoreBreakdown: {
      ...scoreBreakdown,
      adjusted_overall_score: adjustedOverallScore,
      recent_history_score: historyAdjustment.recent_score,
      momentum_modifier: historyAdjustment.momentum_modifier,
    },
  };
}

function calculatePerformanceBreakdown(goalEvaluations, personality, identityProfile = null) {
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

  const baseCategories = Object.fromEntries(categoryEntries.filter(([, value]) => value));
  const { categories, signalAdjustments } = applyIdentitySignalsToBreakdown({
    categories: baseCategories,
    goalEvaluations,
    identityProfile,
  });
  const availableWeight = Object.values(categories).reduce((sum, category) => sum + category.weight, 0);
  const weightedScore = availableWeight > 0
    ? Object.values(categories).reduce((sum, category) => sum + (category.score * category.weight), 0) / availableWeight
    : 0.6;

  return {
    categories,
    signal_adjustments: signalAdjustments,
    overall_score: roundNumber(weightedScore),
    overall_pct: Math.round(weightedScore * 100),
  };
}

function applyIdentitySignalsToBreakdown({ categories = {}, goalEvaluations = [], identityProfile = null } = {}) {
  const hasExplicitNationalGoal = goalEvaluations.some((goal) => goal.type === "min_national_riders");
  const signalAdjustments = {
    identity: getNationalCoreIdentityBonus(identityProfile?.national_core, hasExplicitNationalGoal),
    economy: getStarProfilePrestigeBonus(identityProfile?.star_profile),
  };

  const nextCategories = Object.fromEntries(
    Object.entries(categories).map(([key, category]) => {
      const signalBonus = signalAdjustments[key] || 0;
      if (!category || signalBonus <= 0) {
        return [key, category];
      }

      const adjustedScore = clamp(category.score + signalBonus, 0, 1.15);
      return [key, {
        ...category,
        score: roundNumber(adjustedScore),
        score_pct: Math.round(adjustedScore * 100),
        signal_bonus: roundNumber(signalBonus),
      }];
    })
  );

  return {
    categories: nextCategories,
    signalAdjustments,
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

function buildBoardSignalHint(identityProfile, overallScore) {
  const hints = [];
  const nationalCore = identityProfile?.national_core;
  const starProfile = identityProfile?.star_profile;

  if (nationalCore?.established && nationalCore?.code) {
    hints.push(
      overallScore >= 0.72
        ? `Den ${nationalCore.code}-praegede kerne giver holdet en tydelig identitet i boardets oejne.`
        : `Den ${nationalCore.code}-praegede kerne giver stadig holdet en tydelig identitet, som bestyrelsen ikke slipper let.`
    );
  }

  if (["high", "elite"].includes(starProfile?.level)) {
    hints.push(
      overallScore >= 0.72
        ? "Store profiler styrker sponsorprojektet, men de holder ogsa forventningerne hoje."
        : "Store profiler holder sponsorernes interesse oppe, men de faar ogsa boardet til at forlange mere output."
    );
  } else if (starProfile?.level === "medium" && overallScore >= 0.90) {
    hints.push("Holdets profiler giver sponsorprojektet lidt ekstra tyngde.");
  }

  return hints.join(" ");
}

function appendBoardSignalHint(summary, identityProfile, overallScore) {
  const signalHint = buildBoardSignalHint(identityProfile, overallScore);
  return signalHint ? `${summary} ${signalHint}` : summary;
}

function buildBoardFeedback({ scoreBreakdown, personality, identityProfile, context = {} } = {}) {
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
    const profileHint = identityProfile?.summary
      ? ` Holdet laeser de som ${identityProfile.summary.toLowerCase()}.`
      : "";
    return {
      headline: "Bestyrelsen afventer saesonens forste markorer",
      summary: appendBoardSignalHint(
        `${personality.summary} Indtil videre er forventningerne intakte, men de sportslige svar kommer forst nar saesonen tager form.${profileHint}`,
        identityProfile,
        overallScore
      ),
      tone: "neutral",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.90) {
    return {
      headline: "Bestyrelsen er meget tilfreds",
      summary: appendBoardSignalHint(
        `${strongestCategory.label} driver planen frem, og ${weakestCategory.label.toLowerCase()} er stadig under kontrol.`,
        identityProfile,
        overallScore
      ),
      tone: "positive",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.72) {
    return {
      headline: "Bestyrelsen ser stabil fremgang",
      summary: appendBoardSignalHint(
        `${strongestCategory.label} er pa sporet, men ${weakestCategory.label.toLowerCase()} kraever mere fokus for at holde planen sund.`,
        identityProfile,
        overallScore
      ),
      tone: "steady",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  if (overallScore >= 0.55) {
    return {
      headline: "Bestyrelsen afventer naeste skridt",
      summary: appendBoardSignalHint(
        `${weakestCategory.label} halter efter planen, og presset stiger hvis udviklingen ikke vender snart.`,
        identityProfile,
        overallScore
      ),
      tone: "warning",
      strongest_category: strongestCategory.key,
      weakest_category: weakestCategory.key,
    };
  }

  return {
    headline: "Bestyrelsen er bekymret",
    summary: appendBoardSignalHint(
      `${weakestCategory.label} ligger klart under forventning, og holdet mangler tydelig fremgang i den nuvaerende plan.`,
      identityProfile,
      overallScore
    ),
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
    nationality_code: enrichedGoal?.nationality_code ?? null,
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
