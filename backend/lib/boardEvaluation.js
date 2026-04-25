import {
  CATEGORY_LABELS,
  BASE_CATEGORY_WEIGHTS,
} from "./boardConstants.js";
import {
  deriveTeamIdentityProfile,
  deriveBoardPersonality,
  getNationalCoreIdentityBonus,
  getStarProfilePrestigeBonus,
} from "./boardIdentity.js";
import {
  parseBoardGoals,
  evaluateGoalProgress,
  countGoalsMet,
} from "./boardGoals.js";
import { clamp, clampSatisfaction, roundNumber } from "./boardUtils.js";

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

export function calculateBoardPerformance({ board, standing, team, context = {} } = {}) {
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
