import { SQUAD_FINE_AMOUNT, SQUAD_PENALTY_POINTS } from "./squadEnforcement.js";

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på guaranteed sale), tillad match-bud.
// Tidligere: 10%-increment afrundet op til 1000 — droppet 2026-05-07 (#178 polish-sprint).
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
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
  currentBidderId = null,
  teamBalance,
  reservedBalance = 0,
} = {}) {
  const numericAmount = Number(amount);
  const minimumBid = getMinimumAuctionBid(currentPrice, {
    hasActiveBid: Boolean(currentBidderId),
  });

  if (!Number.isFinite(numericAmount) || numericAmount < minimumBid) {
    return { code: "bid_below_minimum", minimumBid };
  }

  const totalCommitment = reservedBalance + numericAmount;
  if ((Number(teamBalance) || 0) < totalCommitment) {
    return { code: "insufficient_available_balance", totalCommitment };
  }

  return null;
}

// Reserved balance per auktion = MAX(current_price, eget proxy_max).
// Stale proxies (max < current_price) regner med current_price — proxy'en kan ikke
// længere overbyde den manuelt-budte pris, så manageren har reelt forpligtet
// current_price på den auktion. Uden proxy: current_price (manageren leder).
export function computeReservedBalance({
  leadingAuctions = [],
  proxiesByAuctionId = {},
} = {}) {
  return leadingAuctions.reduce((sum, row) => {
    const currentPrice = Number(row.current_price) || 0;
    const proxyMax = Number(proxiesByAuctionId[row.id]?.max_amount) || 0;
    return sum + Math.max(currentPrice, proxyMax);
  }, 0);
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
