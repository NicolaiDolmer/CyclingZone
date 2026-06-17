import { formatNumber } from "./intl.js";

// #1101 cutover: DB-kolonnen market_value (GENERATED fra base_value + bonus) er
// sandheden. Fallback spejler DB'ens COALESCE(base_value, 1000). Aldrig uci_points.
const RIDER_BASE_VALUE_FALLBACK = 1000;

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  const base = Number(rider?.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider?.prize_earnings_bonus) || 0);
}

// #1309: frossen kontrakt-løn hvis sat; ellers estimat (SALARY_RATE af market_value)
// til VISNING af free agents. Spejler backend's resolveRiderSalary i marketUtils.js
// + economyConstants.SALARY_RATE — SKAL holdes i sync (E2 strict_fair_v1: 0.067).
// salary:0 er en gyldig (gratis) kontrakt og bevares som 0.
const SALARY_RATE = 0.067;
export function getRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(getRiderMarketValue(rider) * SALARY_RATE));
}

export function formatCz(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${formatNumber(Number(value))} CZ$`;
}

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på guaranteed sale), tillad match-bud.
// Spejl af backend/lib/auctionRules.js — droppet 10%/1000-afrunding 2026-05-07 (#178).
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
}
