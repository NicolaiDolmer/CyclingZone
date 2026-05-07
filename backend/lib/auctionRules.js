import { SQUAD_FINE_AMOUNT, SQUAD_PENALTY_POINTS } from "./squadEnforcement.js";

export function roundUpToNearest(value, step) {
  return Math.ceil(value / step) * step;
}

export function getMinimumAuctionBid(currentPrice) {
  const price = Number(currentPrice) || 0;
  return roundUpToNearest(price + Math.ceil(price / 10), 1000);
}

export function getAuctionInitialBidderId({
  riderTeamId,
  managerTeamId,
  isGuaranteedSale = false,
} = {}) {
  if (!managerTeamId || isGuaranteedSale || riderTeamId === managerTeamId) {
    return null;
  }

  return managerTeamId;
}

// Hard blocks: bud afvises hvis disse rammer.
// Squad-cap håndteres separat som warning — gameplay-reglen tillader at gå over max
// MIDT i transfervinduet (squadEnforcement-cron auto-sælger + bøder ved vindue-luk).
export function getAuctionBidIssue({
  amount,
  currentPrice,
  teamBalance,
  reservedBalance = 0,
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

  return null;
}

// Non-blocking advarsler: manager må stadig byde, men UI viser konsekvensen.
export function getAuctionBidWarnings({
  teamState,
  activeLeadingCount = 0,
  alreadyLeadingThisAuction = false,
} = {}) {
  const warnings = [];
  const maxRiders = teamState?.squad_limits?.max;
  if (!maxRiders) return warnings;

  const reservedWins = alreadyLeadingThisAuction
    ? activeLeadingCount
    : activeLeadingCount + 1;
  const totalAfter = (teamState.total_count || 0) + reservedWins;
  if (totalAfter > maxRiders) {
    const exceedBy = totalAfter - maxRiders;
    warnings.push({
      code: "squad_capacity_exceeded",
      totalAfter,
      maxRiders,
      exceedBy,
      finePerRider: SQUAD_FINE_AMOUNT,
      penaltyPointsPerRider: SQUAD_PENALTY_POINTS,
    });
  }
  return warnings;
}
