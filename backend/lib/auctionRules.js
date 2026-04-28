export function roundUpToNearest(value, step) {
  return Math.ceil(value / step) * step;
}

export function getMinimumAuctionBid(currentPrice) {
  const price = Number(currentPrice) || 0;
  return roundUpToNearest(price + Math.ceil(price / 10), 1000);
}

export function getAuctionBidIssue({
  amount,
  currentPrice,
  teamBalance,
  reservedBalance = 0,
  teamState,
  activeLeadingCount = 0,
  alreadyLeadingThisAuction = false,
} = {}) {
  const numericAmount = Number(amount);
  const minimumBid = getMinimumAuctionBid(currentPrice);

  if (!Number.isFinite(numericAmount) || numericAmount < minimumBid) {
    return { code: "bid_below_minimum", minimumBid };
  }

  const totalCommitment = reservedBalance + numericAmount;
  if ((Number(teamBalance) || 0) < totalCommitment) {
    return { code: "insufficient_available_balance", totalCommitment };
  }

  const maxRiders = teamState?.squad_limits?.max;
  if (maxRiders) {
    const reservedWins = alreadyLeadingThisAuction
      ? activeLeadingCount
      : activeLeadingCount + 1;
    const totalAfter = (teamState.total_count || 0) + reservedWins;
    if (totalAfter > maxRiders) {
      return { code: "squad_capacity_reserved", totalAfter, maxRiders };
    }
  }

  return null;
}
