/**
 * Board utility functions — used in both frontend and backend.
 * Kept as pure functions with no side effects.
 */

export function generateBoardGoals(focus, planType) {
  const baseGoals = {
    youth_development: [
      { type: "min_u25_riders", target: 5, label: "Min. 5 U25-ryttere på holdet",
        satisfaction_bonus: 15, satisfaction_penalty: 10 },
      { type: "top_n_finish", target: 5, label: "Top 5 i divisionen",
        satisfaction_bonus: 10, satisfaction_penalty: 5 },
      { type: "stage_wins", target: 1, label: "Mindst 1 etapesejr",
        satisfaction_bonus: 20, satisfaction_penalty: 0 },
    ],
    star_signing: [
      { type: "top_n_finish", target: 3, label: "Top 3 i divisionen",
        satisfaction_bonus: 20, satisfaction_penalty: 15 },
      { type: "gc_wins", target: 1, label: "Mindst 1 samlet sejr",
        satisfaction_bonus: 25, satisfaction_penalty: 10 },
      { type: "min_riders", target: 20, label: "Hold på min. 20 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
    ],
    balanced: [
      { type: "top_n_finish", target: 4, label: "Top 4 i divisionen",
        satisfaction_bonus: 15, satisfaction_penalty: 8 },
      { type: "min_riders", target: 15, label: "Hold på min. 15 ryttere",
        satisfaction_bonus: 5, satisfaction_penalty: 10 },
      { type: "stage_wins", target: 2, label: "Mindst 2 etapesejre",
        satisfaction_bonus: 10, satisfaction_penalty: 5 },
    ],
  };

  const planModifier = { "1yr": 1.0, "3yr": 0.8, "5yr": 0.6 };
  const mod = planModifier[planType] || 1.0;
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
