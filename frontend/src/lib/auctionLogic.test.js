import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAvailableForBid,
  computeWorstCaseReservation,
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

test("formatBidWarning — squad-cap warning resolver i18n-key med beregnet bøde og point (#1170)", () => {
  const calls = [];
  const t = (key, params) => { calls.push({ key, params }); return `[${key}]`; };
  const message = formatBidWarning({
    code: "squad_capacity_exceeded",
    totalAfter: 32,
    maxRiders: 30,
    exceedBy: 2,
    finePerRider: 1500,
    penaltyPointsPerRider: 4,
  }, t);

  assert.equal(message, "[auctions:warning.squadCapacity]");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.totalAfter, 32);
  assert.equal(calls[0].params.maxRiders, 30);
  assert.equal(calls[0].params.exceedBy, 2);
  assert.equal(calls[0].params.fine, "3,000"); // formatNumber(1500 * 2)
  assert.equal(calls[0].params.points, 8);     // 4 * 2
});

test("formatBidWarning — ignorerer ukendte warning-koder og manglende t", () => {
  const t = () => "skal-ikke-kaldes";
  assert.equal(formatBidWarning({ code: "other_warning" }, t), null);
  assert.equal(formatBidWarning(null, t), null);
  // Uden t (defensive): ingen crash, bare null.
  assert.equal(formatBidWarning({ code: "squad_capacity_exceeded", exceedBy: 1, finePerRider: 1, penaltyPointsPerRider: 1 }), null);
});

// ── #1184: worst-case reservation + tilgængelig-for-bud (klient-spejl af #44) ──

test("computeWorstCaseReservation — leading tæller MAX(pris, eget loft), ikke-leading tæller loft", () => {
  const auctions = [
    auction({ current_bidder_id: BUYER, current_price: 200_000 }),                       // leading uden proxy → 200k
    auction({ current_bidder_id: BUYER, current_price: 100_000, myProxyMax: 500_000 }),  // leading med proxy → 500k
    auction({ current_bidder_id: RIVAL, current_price: 50_000, myProxyMax: 300_000 }),   // ikke-leading med proxy → 300k
    auction({ current_bidder_id: RIVAL, current_price: 999_999 }),                       // ikke involveret → 0
  ];
  assert.equal(computeWorstCaseReservation(auctions, BUYER), 1_000_000);
  assert.equal(computeWorstCaseReservation([], BUYER), 0);
  assert.equal(computeWorstCaseReservation(null, BUYER), 0);
});

test("computeWorstCaseReservation — egen-rytter-listing uden bud reserverer IKKE penge", () => {
  // getAuctionLeaderId returnerer null for own-rider-listing → ingen finansiel forpligtelse.
  const ownListing = auction({ seller_team_id: BUYER, rider: { team_id: BUYER }, current_price: 400_000 });
  assert.equal(computeWorstCaseReservation([ownListing], BUYER), 0);
});

test("computeAvailableForBid — ny auktion: saldo minus hele reservationen", () => {
  const target = auction({ current_bidder_id: RIVAL, current_price: 100_000 });
  assert.equal(
    computeAvailableForBid({ balance: 1_000_000, reservedBalance: 300_000, auction: target, myTeamId: BUYER }),
    700_000,
  );
});

test("computeAvailableForBid — hæv eget førende bud: egen andel på DENNE auktion ekskluderes (backend-semantik)", () => {
  // Leder selv target-auktionen på 200k; reservation 300k inkluderer de 200k.
  // Et nyt bud erstatter de 200k — så kun 100k (andre auktioner) trækkes fra.
  const target = auction({ current_bidder_id: BUYER, current_price: 200_000 });
  assert.equal(
    computeAvailableForBid({ balance: 1_000_000, reservedBalance: 300_000, auction: target, myTeamId: BUYER }),
    900_000,
  );
});

test("computeAvailableForBid — eget autobud-loft på target ekskluderes også", () => {
  const target = auction({ current_bidder_id: RIVAL, current_price: 100_000, myProxyMax: 250_000 });
  assert.equal(
    computeAvailableForBid({ balance: 1_000_000, reservedBalance: 250_000, auction: target, myTeamId: BUYER }),
    1_000_000,
  );
});

test("computeAvailableForBid — klamper til 0 og tåler manglende input", () => {
  const target = auction({ current_bidder_id: RIVAL });
  assert.equal(
    computeAvailableForBid({ balance: 100_000, reservedBalance: 500_000, auction: target, myTeamId: BUYER }),
    0,
  );
  assert.equal(
    computeAvailableForBid({ balance: null, reservedBalance: null, auction: target, myTeamId: BUYER }),
    0,
  );
});
