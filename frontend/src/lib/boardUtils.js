/**
 * Frontend-only board helpers.
 */

export function getPlanDuration(planType) {
  return { "1yr": 1, "3yr": 3, "5yr": 5 }[planType] ?? 1;
}

export function satisfactionToModifier(satisfaction) {
  if (satisfaction >= 80) return 1.20;
  if (satisfaction >= 60) return 1.10;
  if (satisfaction >= 40) return 1.00;
  if (satisfaction >= 20) return 0.90;
  return 0.80;
}
