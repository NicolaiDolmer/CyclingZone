// Helpers for /api/admin/economy-overview (slice 07e).
// Holdes ude af api.js så logikken kan unit-testes uden HTTP/Supabase.

export const SUSTAINABILITY_YELLOW_THRESHOLD = 0.5;
export const SUSTAINABILITY_RED_THRESHOLD = 0.8;

export function computeSustainabilityTier(totalDebt, debtCeiling) {
  if (!debtCeiling || debtCeiling <= 0) return "green";
  const ratio = totalDebt / debtCeiling;
  if (ratio >= SUSTAINABILITY_RED_THRESHOLD) return "red";
  if (ratio >= SUSTAINABILITY_YELLOW_THRESHOLD) return "yellow";
  return "green";
}

export function computeDebtRatio(totalDebt, debtCeiling) {
  if (!debtCeiling || debtCeiling <= 0) return 0;
  return Math.round((totalDebt / debtCeiling) * 1000) / 1000;
}
