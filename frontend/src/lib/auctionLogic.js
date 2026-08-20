// Delte derivations + warning-formattering for auction-UI.
// Bruges af både AuctionsPage (table-row + card) og RiderStatsPage (rytter-profil bid-panel)
// så der er én kilde til sandhed for "hvem leder", "er jeg sælger", warnings osv.

import { formatNumber } from "./intl.js";

// #1886: seller_team_id = auktionens INITIATOR (api.js), ikke nødvendigvis den
// økonomiske sælger. Når man starter en auktion for at KØBE en free agent/AI-
// rytter, bliver man selv seller_team_id OG current_bidder_id. Efter man vinder
// bliver rytteren ens (rider.team_id===seller_team_id), så en naiv "ejer + lister"-
// test fejllabeler det som et salg. En ægte sælger byder aldrig på sin egen rytter,
// så current_bidder_id===seller_team_id afslører entydigt en vundet købs-auktion.
// Centraliseret her så row-state (isManagerSeller) og sælger-tekst
// (getAuctionSellerLabel) ikke driver fra hinanden hvis auktion-formen ændres.
function isWonBuyAuction(auction) {
  return auction?.seller_team_id
    && auction?.rider?.team_id === auction.seller_team_id
    && auction?.current_bidder_id === auction.seller_team_id;
}

export function isManagerSeller(auction, teamId) {
  return !isWonBuyAuction(auction)
    && auction?.seller_team_id === teamId
    && auction?.rider?.team_id === teamId;
}

export function getAuctionLeaderId(auction) {
  if (auction?.current_bidder_id) return auction.current_bidder_id;
  if (!auction?.is_guaranteed_sale && auction?.seller_team_id && auction?.rider?.team_id !== auction.seller_team_id) {
    return auction.seller_team_id;
  }
  return null;
}

// #vk-auction-signals: persistent "outbid" state — samme diskriminator som
// AuctionsPage's myOverbidAuctions-bucket (Min situation-fanen), centraliseret
// her så rækken/kortet og fane-tælleren aldrig kan drive fra hinanden. Kræver
// at manageren FAKTISK har budt (myHighestBid) og at nogen andre end manageren
// selv fører nu — udelukker sælger (man er aldrig "overbudt" på sin egen
// rytter) og forsvinder automatisk når manageren fører igen eller auktionen
// lukker (raderes fra den aktive liste).
export function isOverbidForMe(auction, teamId) {
  if (!teamId || isManagerSeller(auction, teamId)) return false;
  const leaderId = getAuctionLeaderId(auction);
  return Boolean(auction?.myHighestBid) && leaderId !== null && leaderId !== teamId;
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
    && !isWonBuyAuction(auction)
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

// #3110: klient-spejl af backendens isAuctionExpired (auctionEngine.js) — samme
// >= grænsesemantik, så "udløbet" flipper i samme øjeblik på begge sider.
// Bruges af useAuctionBidding til at deaktivere Byd/autobud-knappen når
// nedtællingen rammer 0, i stedet for at vente på at status-cronen (som kan
// tage et stykke tid) sætter auction.status til "completed". Uden dette
// forblev knappen klikbar i vinduet mellem udløb og finalize (#3110, Sentry
// CYCLINGZONE-3Y — 4 hold ramt på 19 timer).
export function isAuctionTimeExpired(calculatedEnd, now = new Date()) {
  if (!calculatedEnd) return false;
  return new Date(now) >= new Date(calculatedEnd);
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
