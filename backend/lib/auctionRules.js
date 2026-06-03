import { SQUAD_FINE_AMOUNT, SQUAD_PENALTY_POINTS } from "./squadEnforcement.js";

// Hard block: ny auktion på rytter der har vundet en tidligere auktion og
// afventer overførsel (pending_team_id sat). Uden denne gate kunne enhver
// re-auktionere en rytter der allerede er på vej til et andet hold —
// finalize-steget ville senere annullere den nye auktion via stale-owner-tjek
// i auctionFinalization.js, men UX'en er ødelagt: bud afgivet, leder
// notificeres "auktion annulleret", penge bundet i mellemtiden.
//
// Rammer alle managers (også winneren selv) — rytteren er ikke fysisk på noget
// hold endnu og kan ikke sælges videre før transfervinduet flusher pending → team_id.
export function getAuctionStartIssue({ rider } = {}) {
  if (rider?.is_retired) {
    return { code: "rider_retired" };
  }
  if (rider?.pending_team_id) {
    return { code: "rider_pending_transfer" };
  }
  return null;
}

// Startpris-gate for ny auktion (POST /api/auctions).
// - Egen rytter: pris skal være mellem 0 og Værdi (sælg billigt hvis du vil, men
//   ingen kunstig inflation over rytterens Værdi).
// - AI/fri rytter: pris skal mindst matche Værdi (markedsgulv mod low-balling).
// Tom/udeladt pris = intet issue (route defaulter til Værdi).
export function getAuctionStartPriceIssue({ startingPrice, riderValue, isOwnRider = false } = {}) {
  if (startingPrice === null || startingPrice === undefined || startingPrice === "") {
    return null;
  }
  const price = Number(startingPrice);
  const value = Number(riderValue) || 0;
  if (!Number.isFinite(price)) {
    return { code: "invalid_start_price" };
  }
  if (isOwnRider) {
    if (price < 0 || price > value) {
      return { code: "own_price_out_of_range", riderValue: value };
    }
  } else if (price < value) {
    return { code: "below_value_floor", riderValue: value };
  }
  return null;
}

// Min-step = +1 CZ$ over current price når der allerede er bud.
// Hvis ingen har budt endnu (asking-price på egen-rytter-salg), tillad match-bud.
export function getMinimumAuctionBid(currentPrice, { hasActiveBid = true } = {}) {
  const price = Number(currentPrice) || 0;
  return hasActiveBid ? price + 1 : price;
}

export function getAuctionInitialBidderId({
  riderTeamId,
  managerTeamId,
} = {}) {
  if (!managerTeamId || riderTeamId === managerTeamId) {
    return null;
  }

  return managerTeamId;
}

// Hard blocks: bud afvises hvis disse rammer.
// Squad-cap håndteres separat som warning — gameplay-reglen tillader at gå over max
// MIDT i transfervinduet (squadEnforcement-cron auto-sælger + bøder ved vindue-luk).
//
// reservedBalance = worst-case commitment EXKL. denne auktion (kalderen ekskluderer
// auctionId før den kalder computeWorstCaseCommitment).
// proxyMax (optional) = proxy-loft som indsendes med buddet. Hvis sat, gates
// MAX(amount, proxyMax) mod balancen — så et 50K-bud med proxy 600K kun accepteres
// hvis manageren også har råd til 600K.
export function getAuctionBidIssue({
  amount,
  proxyMax = null,
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

  const numericProxyMax = Number(proxyMax) || 0;
  const thisAuctionWorstCase = Math.max(numericAmount, numericProxyMax);
  const totalCommitment = reservedBalance + thisAuctionWorstCase;
  if ((Number(teamBalance) || 0) < totalCommitment) {
    return { code: "insufficient_available_balance", totalCommitment };
  }

  return null;
}

// Gate for PATCH /api/auctions/:id/proxy. Worst-case commitment hvis proxy sættes:
// - Hvis manageren leder den auktion: MAX(current_price, new_proxy_max)
// - Hvis ikke leder: new_proxy_max (proxy kan trigger til fulde beløb)
// otherCommitment = worst-case commitment EXKL. denne auktion.
export function getProxyMaxIssue({
  proxyMax,
  currentPrice,
  isLeading = false,
  teamBalance,
  otherCommitment = 0,
} = {}) {
  const numericMax = Number(proxyMax);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return { code: "invalid_proxy_max" };
  }

  const thisAuctionContribution = isLeading
    ? Math.max(Number(currentPrice) || 0, numericMax)
    : numericMax;

  const totalCommitment = (Number(otherCommitment) || 0) + thisAuctionContribution;
  if ((Number(teamBalance) || 0) < totalCommitment) {
    return {
      code: "insufficient_available_balance",
      availableBalance: computeAvailableBalance({
        teamBalance,
        commitment: otherCommitment,
      }),
    };
  }

  return null;
}

// PATCH /proxy skal fungere som et reelt autobud når manageren ikke allerede
// fører: byd minimumsprisen og gem max-loftet i samme handling.
export function getProxyOpeningBidAmount({
  proxyMax,
  currentPrice,
  currentBidderId = null,
  isLeading = false,
} = {}) {
  if (isLeading) return null;

  const minimumBid = getMinimumAuctionBid(currentPrice, {
    hasActiveBid: Boolean(currentBidderId),
  });
  const numericMax = Number(proxyMax);
  if (!Number.isFinite(numericMax) || numericMax < minimumBid) return null;

  return minimumBid;
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

// Worst-case total commitment across ALL auctions hvor manageren er involveret.
// - Leading uden proxy: current_price (skal betales hvis ingen overbyder)
// - Leading med proxy: MAX(current_price, proxy_max) (proxy kan eskalere)
// - Ikke-leading med proxy: proxy_max (worst case = proxy trigger fuldt)
// - Ikke-leading uden proxy: 0 (manager er ikke involveret)
//
// Bruges som canonical "hvor mange penge skylder jeg potentielt?"-svar.
// Hard-gates på balance-reducerende actions (bud, proxy-set, lån-repay, transfer)
// bruger denne — så manageren aldrig kan committe sig til mere end de har på
// kontoen, og dermed aldrig kan vinde en auktion uden råd til at betale.
export function computeWorstCaseCommitment({
  leadingAuctions = [],
  allMyProxies = [],
} = {}) {
  const proxyByAuctionId = new Map();
  for (const proxy of allMyProxies) {
    if (proxy?.auction_id != null) {
      proxyByAuctionId.set(proxy.auction_id, Number(proxy.max_amount) || 0);
    }
  }

  const seenAuctionIds = new Set();
  let total = 0;

  for (const auction of leadingAuctions) {
    if (auction?.id == null) continue;
    const currentPrice = Number(auction.current_price) || 0;
    const proxyMax = proxyByAuctionId.get(auction.id) ?? 0;
    total += Math.max(currentPrice, proxyMax);
    seenAuctionIds.add(auction.id);
  }

  for (const proxy of allMyProxies) {
    if (proxy?.auction_id == null) continue;
    if (seenAuctionIds.has(proxy.auction_id)) continue;
    total += Number(proxy.max_amount) || 0;
  }

  return total;
}

// Available balance = balance - worst-case commitment, klampet til 0.
// "Hvor mange penge kan jeg bruge på en ny ting uden at bryde mine eksisterende
// auktions-forpligtelser?"
export function computeAvailableBalance({ teamBalance, commitment }) {
  const balance = Number(teamBalance) || 0;
  const reserved = Number(commitment) || 0;
  return Math.max(0, balance - reserved);
}

// Gate for actions der reducerer balance med et fast beløb (lån-repay, peer-loan
// buyout, transfer-køb, swap-cash). Returnerer null = OK, eller fejl-objekt med
// availableBalance så endpoint kan vise dansk fejl.
export function getSpendIssue({
  teamBalance,
  commitment,
  attemptedSpend,
} = {}) {
  const available = computeAvailableBalance({ teamBalance, commitment });
  const spend = Number(attemptedSpend) || 0;
  if (spend > available) {
    return { code: "insufficient_available_balance", availableBalance: available };
  }
  return null;
}

// #194 race-confirm: returner true hvis frontend's expected_current_price ikke
// matcher det server lige har læst. Undefined/null/non-numeric = ingen check
// (bagudkompat med ældre clients der ikke sender feltet — first-commit-wins som før).
export function isExpectedPriceStale(expectedPrice, currentPrice) {
  if (expectedPrice === undefined || expectedPrice === null) return false;
  const expected = Number(expectedPrice);
  if (!Number.isFinite(expected)) return false;
  return expected !== Number(currentPrice);
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
