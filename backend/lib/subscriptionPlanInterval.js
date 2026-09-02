// #4541 — Aluntas `plan_interval` er et TAL: måneder pr. periode (1 = månedlig,
// 6 = halvårlig). Målt live 2/9 mod GET /subscriptions via dry-run af
// backend/scripts/reconcileAluntaSubscriptions.js. Vores skema
// (database/2026-06-26-cz-pro-subscriptions.sql: "monthly | semiannual") og
// alle forbrugere (LTV-estimat, admin-UI, compute_daily_growth_snapshot)
// forventer ord, ikke tal. Prod havde derfor '1' stående på den første kunde
// fra 25/7 til 2/9, og en halvårs-kunde ville blive prissat som månedlig.
//
// Én fælles normalisering, brugt af webhook + reconcile + LTV-estimat, så rå
// tal aldrig igen lander i DB'en. Ukendte værdier returneres som streng
// (ikke null): bedre at kunne SE '12' i admin-tabellen end at miste den.
export const PLAN_INTERVAL_MONTHLY = "monthly";
export const PLAN_INTERVAL_SEMIANNUAL = "semiannual";

const MONTHLY_ALIASES = new Set(["1", "monthly", "month", "1m", "p1m"]);
const SEMIANNUAL_ALIASES = new Set(["6", "semiannual", "semi-annual", "half-yearly", "halfyearly", "6m", "p6m"]);

export function normalizePlanInterval(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  if (MONTHLY_ALIASES.has(s)) return PLAN_INTERVAL_MONTHLY;
  if (SEMIANNUAL_ALIASES.has(s)) return PLAN_INTERVAL_SEMIANNUAL;
  return s;
}
