import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuctionInitialBidderId,
  getAuctionBidIssue,
  getMinimumAuctionBid,
} from "./auctionRules.js";

test("getMinimumAuctionBid requires 10 percent over current price rounded up to 1,000 CZ$", () => {
  assert.equal(getMinimumAuctionBid(100000), 110000);
  assert.equal(getMinimumAuctionBid(100001), 111000);
});

test("getAuctionInitialBidderId treats non-owned auction creation as the first bid", () => {
  assert.equal(getAuctionInitialBidderId({
    riderTeamId: "ai-team",
    managerTeamId: "manager-team",
  }), "manager-team");

  assert.equal(getAuctionInitialBidderId({
    riderTeamId: null,
    managerTeamId: "manager-team",
  }), "manager-team");

  assert.equal(getAuctionInitialBidderId({
    riderTeamId: "manager-team",
    managerTeamId: "manager-team",
  }), null);

  assert.equal(getAuctionInitialBidderId({
    riderTeamId: "manager-team",
    managerTeamId: "manager-team",
    isGuaranteedSale: true,
  }), null);
});

test("getAuctionBidIssue blocks bids below the rounded 10 percent minimum", () => {
  const issue = getAuctionBidIssue({
    amount: 110999,
    currentPrice: 100001,
    teamBalance: 500000,
    teamState: { total_count: 5, squad_limits: { max: 10 } },
  });

  assert.equal(issue?.code, "bid_below_minimum");
  assert.equal(issue?.minimumBid, 111000);
});

test("getAuctionBidIssue counts existing leading bids against available balance", () => {
  const issue = getAuctionBidIssue({
    amount: 400000,
    currentPrice: 300000,
    teamBalance: 500000,
    reservedBalance: 200000,
    teamState: { total_count: 5, squad_limits: { max: 10 } },
  });

  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.totalCommitment, 600000);
});

test("getAuctionBidIssue reserves active auction leads against squad capacity", () => {
  const issue = getAuctionBidIssue({
    amount: 120000,
    currentPrice: 100000,
    teamBalance: 500000,
    teamState: { total_count: 9, squad_limits: { max: 10 } },
    activeLeadingCount: 1,
  });

  assert.equal(issue?.code, "squad_capacity_reserved");
  assert.equal(issue?.maxRiders, 10);
});
