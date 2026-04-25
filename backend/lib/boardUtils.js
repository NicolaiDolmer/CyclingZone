export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampSatisfaction(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function roundNumber(value) {
  return Math.round(value * 1000) / 1000;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

export function averageNumbers(values = []) {
  const safeValues = (values || []).filter((value) => Number.isFinite(value));
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

export function averageTopScores(items = [], scorer) {
  const scores = (items || [])
    .map((item) => scorer(item))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
    .slice(0, Math.min(5, items.length));

  if (!scores.length) return 0;

  return roundNumber(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

export function clampToStep(value, min, step, max) {
  const steppedValue = Math.round(value / step) * step;
  return clamp(steppedValue, min, max);
}

export function scoreHigherBetter(actual, target) {
  if (actual == null) return 0.6;

  const safeTarget = target > 0 ? target : 1;
  if (target <= 0) return actual <= 0 ? 1.05 : 1.15;

  const ratio = actual / safeTarget;
  if (ratio >= 1) {
    return clamp(1 + Math.min(0.15, (ratio - 1) * 0.25), 0, 1.15);
  }

  return clamp(Math.pow(Math.max(ratio, 0), 0.70), 0, 1.0);
}

export function scoreLowerBetter(actual, target) {
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

export function scoreDebtGoal(activeLoanCount, isFinalSeason) {
  if (activeLoanCount === 0) return isFinalSeason ? 1.05 : 1.0;
  if (activeLoanCount === 1) return 0.65;
  if (activeLoanCount === 2) return 0.35;
  return 0.15;
}
