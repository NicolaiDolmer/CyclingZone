import {
  PLAN_DURATIONS,
  PLAN_PENALTY_MODIFIERS,
  GOAL_METADATA_BY_TYPE,
  DIVISION_SQUAD_LIMITS,
} from "./boardConstants.js";
import {
  deriveTeamIdentityProfile,
  deriveBoardPersonality,
  getDivisionSquadLimits,
  normalizeBoardRider,
  getStarProfileGoalPressure,
  getStarProfileSponsorPressure,
} from "./boardIdentity.js";
import {
  clamp,
  clampToStep,
  roundNumber,
  safeJsonParse,
  scoreHigherBetter,
  scoreLowerBetter,
  scoreDebtGoal,
} from "./boardUtils.js";

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
  const division = normalizeDivisionForGoals(team?.division ?? standing?.division);
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

export function addGoalMetadata(goal = {}) {
  const metadata = GOAL_METADATA_BY_TYPE[goal.type] || {};
  return {
    ...goal,
    category: goal.category ?? metadata.category ?? "results",
    importance: goal.importance ?? metadata.importance ?? "required",
    weight: goal.weight ?? metadata.weight ?? 1.0,
  };
}

export function normalizeComparableGoal(goal) {
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

export function buildGoalLabel(goal = {}) {
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

function normalizeDivisionForGoals(division) {
  const n = Number(division);
  return DIVISION_SQUAD_LIMITS[n] ? n : null;
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
