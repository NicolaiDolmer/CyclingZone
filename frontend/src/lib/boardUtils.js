/**
 * Board utility functions — used in both frontend and backend.
 * Kept as pure functions with no side effects.
 */

export function getPlanDuration(planType) {
  return { "1yr": 1, "3yr": 3, "5yr": 5 }[planType] ?? 1;
}

export function isMidPlanReview(seasonsCompleted, planType) {
  const d = getPlanDuration(planType);
  return d > 1 && seasonsCompleted === Math.floor(d / 2);
}

export function generateBoardGoals(focus, planType) {
  const planDuration = getPlanDuration(planType);
  const isMultiYear = planDuration > 1;

  const planModifier = { "1yr": 1.0, "3yr": 0.8, "5yr": 0.6 };
  const mod = planModifier[planType] || 1.0;

  const stageWinsTarget = isMultiYear ? Math.round(1 * planDuration * 0.8) : 1;
  const gcWinsTarget = isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1;
  const balancedStageTarget = isMultiYear ? Math.round(2 * planDuration * 0.7) : 2;

  const baseGoals = {
    youth_development: [
      {
        type: "min_u25_riders",
        target: 5,
        label: "Min. 5 U25-ryttere på holdet",
        satisfaction_bonus: 15, satisfaction_penalty: 10,
      },
      {
        type: "top_n_finish",
        target: 5,
        label: isMultiYear ? "Top 5 i divisionen ved planens afslutning" : "Top 5 i divisionen",
        satisfaction_bonus: 10, satisfaction_penalty: 5,
      },
      {
        type: "stage_wins",
        target: stageWinsTarget,
        label: isMultiYear
          ? `Mindst ${stageWinsTarget} etapesejre over planperioden`
          : "Mindst 1 etapesejr",
        cumulative: isMultiYear,
        satisfaction_bonus: 20, satisfaction_penalty: 0,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestående gæld ved sæsonslut",
        satisfaction_bonus: 12, satisfaction_penalty: 8,
      },
    ],
    star_signing: [
      {
        type: "top_n_finish",
        target: 3,
        label: isMultiYear ? "Top 3 i divisionen ved planens afslutning" : "Top 3 i divisionen",
        satisfaction_bonus: 20, satisfaction_penalty: 15,
      },
      {
        type: "gc_wins",
        target: gcWinsTarget,
        label: isMultiYear
          ? `Mindst ${gcWinsTarget} samlede sejre over planperioden`
          : "Mindst 1 samlet sejr",
        cumulative: isMultiYear,
        satisfaction_bonus: 25, satisfaction_penalty: 10,
      },
      {
        type: "min_riders",
        target: 20,
        label: "Hold på min. 20 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10,
      },
      {
        type: "sponsor_growth",
        target: isMultiYear ? planDuration * 5 : 10,
        label: isMultiYear
          ? `Sponsor-indkomst vokset med ${planDuration * 5}% over planperioden`
          : "Sponsor-indkomst vokset med 10%",
        satisfaction_bonus: 15, satisfaction_penalty: 10,
      },
    ],
    balanced: [
      {
        type: "top_n_finish",
        target: 4,
        label: isMultiYear ? "Top 4 i divisionen ved planens afslutning" : "Top 4 i divisionen",
        satisfaction_bonus: 15, satisfaction_penalty: 8,
      },
      {
        type: "min_riders",
        target: 15,
        label: "Hold på min. 15 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10,
      },
      {
        type: "stage_wins",
        target: balancedStageTarget,
        label: isMultiYear
          ? `Mindst ${balancedStageTarget} etapesejre over planperioden`
          : "Mindst 2 etapesejre",
        cumulative: isMultiYear,
        satisfaction_bonus: 10, satisfaction_penalty: 5,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestående gæld ved sæsonslut",
        satisfaction_bonus: 12, satisfaction_penalty: 8,
      },
    ],
  };

  const goals = baseGoals[focus] || baseGoals.balanced;
  return goals.map(g => ({
    ...g,
    satisfaction_penalty: Math.round(g.satisfaction_penalty * mod),
  }));
}

export function satisfactionToModifier(satisfaction) {
  if (satisfaction >= 80) return 1.20;
  if (satisfaction >= 60) return 1.10;
  if (satisfaction >= 40) return 1.00;
  if (satisfaction >= 20) return 0.90;
  return 0.80;
}
