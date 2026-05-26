// Delte derivations + warning-formattering for auction-UI.
// Bruges af både AuctionsPage (table-row + card) og RiderStatsPage (rytter-profil bid-panel)
// så der er én kilde til sandhed for "hvem leder", "er jeg sælger", warnings osv.

import { formatNumber } from "./intl";

export function isManagerSeller(auction, teamId) {
  return auction?.seller_team_id === teamId && auction?.rider?.team_id === teamId;
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
  if (auction?.seller_team_id && auction?.rider?.team_id === auction.seller_team_id) {
    return auction?.seller?.name || "Manager";
  }
  return "AI";
}

// Bug #29 — squad-cap er warning, ikke block. Manager må gå over max under transfer-vinduet;
// squadEnforcement-cron auto-sælger + bøder først ved vindue-luk hvis stadig over max.
export function formatBidWarning(warning) {
  if (warning?.code === "squad_capacity_exceeded") {
    const fine = warning.finePerRider * warning.exceedBy;
    const points = warning.penaltyPointsPerRider * warning.exceedBy;
    return `OBS: leder nu auktioner svarende til ${warning.totalAfter} ryttere (max ${warning.maxRiders}). ` +
      `Hvis du stadig er ${warning.exceedBy} over ved vindue-luk: auto-salg + ${formatNumber(fine)} CZ$ bøde + ${points} fradrag-points.`;
  }
  return null;
}
