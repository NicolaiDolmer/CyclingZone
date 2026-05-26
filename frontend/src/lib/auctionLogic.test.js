import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBidWarning,
  getAuctionLeaderId,
  getAuctionLeaderName,
  getAuctionSellerLabel,
  isManagerSeller,
} from "./auctionLogic.js";

const SELLER = "team-seller";
const BUYER = "team-buyer";
const RIVAL = "team-rival";

function auction(overrides = {}) {
  return {
    seller_team_id: SELLER,
    is_guaranteed_sale: false,
    rider: { team_id: SELLER },
    seller: { name: "Seller Team" },
    current_bidder_id: null,
    current_bidder: null,
    ...overrides,
  };
}

test("isManagerSeller — kræver både seller_team_id og rider.team_id match", () => {
  assert.equal(isManagerSeller(auction(), SELLER), true);
  assert.equal(isManagerSeller(auction({ rider: { team_id: RIVAL } }), SELLER), false);
  assert.equal(isManagerSeller(auction({ seller_team_id: null }), SELLER), false);
  assert.equal(isManagerSeller(null, SELLER), false);
});

test("getAuctionLeaderId — aktiv bidder vinder over seller fallback", () => {
  assert.equal(
    getAuctionLeaderId(auction({ current_bidder_id: BUYER })),
    BUYER,
  );
});

test("getAuctionLeaderId — seller fallback gælder kun non-guaranteed listing hvor rider har forladt seller", () => {
  assert.equal(
    getAuctionLeaderId(auction({ rider: { team_id: RIVAL } })),
    SELLER,
  );
  assert.equal(
    getAuctionLeaderId(auction({ is_guaranteed_sale: true, rider: { team_id: RIVAL } })),
    null,
  );
  assert.equal(
    getAuctionLeaderId(auction({ rider: { team_id: SELLER } })),
    null,
  );
});

test("getAuctionLeaderName — bidder-navn prioriteres, ellers seller-navn ved fallback", () => {
  assert.equal(
    getAuctionLeaderName(auction({
      current_bidder_id: BUYER,
      current_bidder: { name: "Buyer Team" },
      rider: { team_id: RIVAL },
    })),
    "Buyer Team",
  );
  assert.equal(
    getAuctionLeaderName(auction({ rider: { team_id: RIVAL } })),
    "Seller Team",
  );
  assert.equal(getAuctionLeaderName(auction()), null);
});

test("getAuctionSellerLabel — manager-listing viser holdnavn, ellers AI", () => {
  assert.equal(getAuctionSellerLabel(auction()), "Seller Team");
  assert.equal(getAuctionSellerLabel(auction({ seller: null })), "Manager");
  assert.equal(getAuctionSellerLabel(auction({ rider: { team_id: RIVAL } })), "AI");
  assert.equal(getAuctionSellerLabel(auction({ seller_team_id: null })), "AI");
});

test("formatBidWarning — squad-cap warning beregner total bøde og point", () => {
  const message = formatBidWarning({
    code: "squad_capacity_exceeded",
    totalAfter: 32,
    maxRiders: 30,
    exceedBy: 2,
    finePerRider: 1500,
    penaltyPointsPerRider: 4,
  });

  assert.match(message, /leder nu auktioner svarende til 32 ryttere \(max 30\)/);
  assert.match(message, /2 over ved vindue-luk/);
  assert.match(message, /3,000 CZ\$ bøde/);
  assert.match(message, /8 fradrag-points/);
});

test("formatBidWarning — ignorerer ukendte warning-koder", () => {
  assert.equal(formatBidWarning({ code: "other_warning" }), null);
  assert.equal(formatBidWarning(null), null);
});
