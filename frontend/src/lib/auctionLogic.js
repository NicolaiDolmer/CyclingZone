// Delte derivations + warning-formattering for auction-UI.
// Bruges af både AuctionsPage (table-row + card) og RiderStatsPage (rytter-profil bid-panel)
// så der er én kilde til sandhed for "hvem leder", "er jeg sælger", warnings osv.

import { formatNumber } from "./intl.js";

// #1886: seller_team_id = auktionens INITIATOR (api.js), ikke nødvendigvis den
// økonomiske sælger. Når man starter en auktion for at KØBE en free agent/AI-
// rytter, bliver man selv seller_team_id OG current_bidder_id. Efter man vinder
// bliver rytteren ens (rider.team_id===mig), så de to første betingelser bliver
// sande — men man er KØBEREN. En ægte sælger byder aldrig på sin egen rytter, så
// current_bidder_id===teamId afslører entydigt en vundet købs-auktion.
export function isManagerSeller(auction, teamId) {
  return auction?.seller_team_id === teamId
    && auction?.rider?.team_id === teamId
    && auction?.current_bidder_id !== teamId;
}

export function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
}

export function getAuctionLeaderName(auction) {
  if (auction?.current_bidder?.name) return auction.current_bidder.name;
  if (getAuctionLeaderId(auction) === auction?.seller_team_id) return auction?.seller?.name;
  return null;
}

export function getAuctionSellerLabel(auction) {
  // #1886: udeluk vundne købs-auktioner (initiator===vinder) — se isManagerSeller.
  // Rytteren kom fra en fri agent/AI, så sælger-kolonnen skal vise "AI", ikke
  // køberens eget holdnavn.
  if (
    auction?.seller_team_id
    && auction?.rider?.team_id === auction.seller_team_id
    && auction?.current_bidder_id !== auction.seller_team_id
  ) {
    return auction?.seller?.name || "Manager";
  }
  return "AI";
}

// #44/#1184: klient-spejl af backendens worst-case commitment (auctionRules.js
// computeWorstCaseCommitment): leading auktion tæller MAX(current_price, eget
// autobud-loft); ikke-leading med autobud tæller loftet. `auctions` skal have
// myProxyMax mappet på forhånd.
export function computeWorstCaseReservation(auctions, myTeamId) {
  let total = 0;
  for (const a of auctions || []) {
    if (getAuctionLeaderId(a) === myTeamId) {
      total += Math.max(a.current_price || 0, a.myProxyMax || 0);
    } else if (a.myProxyMax) {
      total += a.myProxyMax;
    }
  }
  return total;
}

// #1184: tilgængelig saldo for et NYT bud på netop denne auktion. Spejler
// backend-gaten (POST /bid): reservationen EKSKLUDERER denne auktions egen
// andel — buddet selv erstatter den (man betaler kun én gang pr. auktion).
export function computeAvailableForBid({ balance, reservedBalance, auction, myTeamId }) {
  const myShareThisAuction = getAuctionLeaderId(auction) === myTeamId
    ? Math.max(auction?.current_price || 0, auction?.myProxyMax || 0)
    : (auction?.myProxyMax || 0);
  const reservedExclThis = Math.max(0, (Number(reservedBalance) || 0) - myShareThisAuction);
  return Math.max(0, (Number(balance) || 0) - reservedExclThis);
}

// Bug #29 — squad-cap er warning, ikke block. Manager må gå over max under transfer-vinduet;
// squadEnforcement-cron auto-sælger + bøder først ved vindue-luk hvis stadig over max.
// #1170: teksten resolves via i18n (var hardcodet dansk — lækkede i EN-mode).
export function formatBidWarning(warning, t) {
  if (warning?.code === "squad_capacity_exceeded" && typeof t === "function") {
    const fine = warning.finePerRider * warning.exceedBy;
    const points = warning.penaltyPointsPerRider * warning.exceedBy;
    return t("auctions:warning.squadCapacity", {
      totalAfter: warning.totalAfter,
      maxRiders: warning.maxRiders,
      exceedBy: warning.exceedBy,
      fine: formatNumber(fine),
      points,
    });
  }
  return null;
}
