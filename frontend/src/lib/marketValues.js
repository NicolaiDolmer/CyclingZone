import { formatNumber } from "./intl.js";

export const RIDER_VALUE_FACTOR = 4000;
export const MIN_RIDER_UCI_POINTS = 5;

export function getRiderBaseValue(rider = {}) {
  const uciPoints = Math.max(Number(rider?.uci_points) || 0, MIN_RIDER_UCI_POINTS);
  return Number(rider?.price) || uciPoints * RIDER_VALUE_FACTOR;
}

export function getRiderMarketValue(rider = {}) {
  if (Number.isFinite(Number(rider?.market_value))) return Number(rider.market_value);
  return getRiderBaseValue(rider) + (Number(rider?.prize_earnings_bonus) || 0);
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
