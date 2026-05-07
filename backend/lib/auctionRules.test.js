import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuctionInitialBidderId,
  getAuctionBidIssue,
  getAuctionBidWarnings,
  getMinimumAuctionBid,
} from "./auctionRules.js";
import {
  SQUAD_FINE_AMOUNT,
  SQUAD_PENALTY_POINTS,
} from "./squadEnforcement.js";

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
  });

  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.totalCommitment, 600000);
});

test("getAuctionBidIssue allows bids that would exceed squad cap (warning only)", () => {
  // Squad-cap er ikke længere en hard block — håndhæves ved vindue-luk via squadEnforcement-cron.
  // Bug #29 (cybersimon, 2026-05-03): manager med 10 ryttere + 1 garanteret salg
  // kunne ikke byde, fordi blokken ignorerede pending-salg. Vi fjerner blokken helt.
  const issue = getAuctionBidIssue({
    amount: 120000,
    currentPrice: 100000,
    teamBalance: 500000,
  });

  assert.equal(issue, null);
});

test("getAuctionBidWarnings reports squad_capacity_exceeded when leads + count exceed max", () => {
  const [warning, ...rest] = getAuctionBidWarnings({
    teamState: { total_count: 9, squad_limits: { max: 10 } },
    activeLeadingCount: 1,
  });

  assert.equal(rest.length, 0);
  assert.equal(warning?.code, "squad_capacity_exceeded");
  assert.equal(warning?.totalAfter, 11);
  assert.equal(warning?.maxRiders, 10);
  assert.equal(warning?.exceedBy, 1);
  assert.equal(warning?.finePerRider, SQUAD_FINE_AMOUNT);
  assert.equal(warning?.penaltyPointsPerRider, SQUAD_PENALTY_POINTS);
});

test("getAuctionBidWarnings does not double-count when already leading this auction", () => {
  // Hæv-bud scenarie: total_count=9, leder allerede 1 (inkl. denne) → totalAfter=10 = max, ingen warning.
  // Uden alreadyLeadingThisAuction-dedup ville reservedWins blive 2 og udløse en falsk warning.
  const warnings = getAuctionBidWarnings({
    teamState: { total_count: 9, squad_limits: { max: 10 } },
    activeLeadingCount: 1,
    alreadyLeadingThisAuction: true,
  });

  assert.equal(warnings.length, 0);
});

test("getAuctionBidWarnings returns empty when within squad cap", () => {
  const warnings = getAuctionBidWarnings({
    teamState: { total_count: 5, squad_limits: { max: 10 } },
    activeLeadingCount: 2,
  });

  assert.equal(warnings.length, 0);
});
