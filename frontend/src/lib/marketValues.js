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
  return `${Number(value).toLocaleString("da-DK")} CZ$`;
}

export function roundUpToNearest(value, step) {
  return Math.ceil(value / step) * step;
}

export function getMinimumAuctionBid(currentPrice) {
  const price = Number(currentPrice) || 0;
  return roundUpToNearest(price + Math.ceil(price / 10), 1000);
}
