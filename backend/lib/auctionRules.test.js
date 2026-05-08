import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAvailableBalance,
  computeReservedBalance,
  computeWorstCaseCommitment,
  getAuctionInitialBidderId,
  getAuctionBidIssue,
  getAuctionBidWarnings,
  getMinimumAuctionBid,
  getProxyMaxIssue,
  getProxyOpeningBidAmount,
  getSpendIssue,
  isExpectedPriceStale,
} from "./auctionRules.js";
import {
  SQUAD_FINE_AMOUNT,
  SQUAD_PENALTY_POINTS,
} from "./squadEnforcement.js";

test("getMinimumAuctionBid is currentPrice + 1 when there is an active bidder", () => {
  assert.equal(getMinimumAuctionBid(100000), 100001);
  assert.equal(getMinimumAuctionBid(50000, { hasActiveBid: true }), 50001);
});

test("getMinimumAuctionBid allows match-bid on asking-price when no active bidder", () => {
  // Guaranteed-sale at asking price 50.000 CZ$, no bids yet — manager can match.
  assert.equal(getMinimumAuctionBid(50000, { hasActiveBid: false }), 50000);
  assert.equal(getMinimumAuctionBid(0, { hasActiveBid: false }), 0);
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

test("getAuctionBidIssue blocks bids below currentPrice + 1 when active bidder exists", () => {
  const issue = getAuctionBidIssue({
    amount: 100000,
    currentPrice: 100000,
    currentBidderId: "team-a",
    teamBalance: 500000,
  });

  assert.equal(issue?.code, "bid_below_minimum");
  assert.equal(issue?.minimumBid, 100001);
});

test("getAuctionBidIssue allows match-bid on asking-price when no active bidder", () => {
  // Guaranteed-sale, no bids yet — match-bid at asking price is allowed.
  const issue = getAuctionBidIssue({
    amount: 50000,
    currentPrice: 50000,
    currentBidderId: null,
    teamBalance: 500000,
  });

  assert.equal(issue, null);
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

test("computeReservedBalance uses proxy_max when proxy >= current_price", () => {
  // Auktion 1 fra issue #193: current=50K, proxy=200K → reserved 200K (proxy vinder)
  const reserved = computeReservedBalance({
    leadingAuctions: [{ id: "a1", current_price: 50000 }],
    proxiesByAuctionId: { a1: { max_amount: 200000 } },
  });
  assert.equal(reserved, 200000);
});

test("computeReservedBalance uses current_price when no proxy exists", () => {
  // Auktion 2 fra issue #193: current=80K, ingen proxy → reserved 80K
  const reserved = computeReservedBalance({
    leadingAuctions: [{ id: "a2", current_price: 80000 }],
    proxiesByAuctionId: {},
  });
  assert.equal(reserved, 80000);
});

test("computeReservedBalance uses current_price when proxy is stale (max < current)", () => {
  // Auktion 3 fra issue #193: current=30K, proxy=20K (stale) → reserved 30K
  // Stale proxy kan ikke længere overbyde manuelt-budt pris, så manageren har
  // reelt forpligtet current_price på den auktion.
  const reserved = computeReservedBalance({
    leadingAuctions: [{ id: "a3", current_price: 30000 }],
    proxiesByAuctionId: { a3: { max_amount: 20000 } },
  });
  assert.equal(reserved, 30000);
});

test("computeReservedBalance sums combined scenario from issue #193", () => {
  // Kombineret eksempel fra issue body: 200K + 80K + 30K = 310K reserved.
  const reserved = computeReservedBalance({
    leadingAuctions: [
      { id: "a1", current_price: 50000 },
      { id: "a2", current_price: 80000 },
      { id: "a3", current_price: 30000 },
    ],
    proxiesByAuctionId: {
      a1: { max_amount: 200000 },
      a3: { max_amount: 20000 },
    },
  });
  assert.equal(reserved, 310000);
});

test("computeReservedBalance returns 0 for empty input", () => {
  assert.equal(computeReservedBalance({}), 0);
  assert.equal(computeReservedBalance({ leadingAuctions: [] }), 0);
});

test("getAuctionBidIssue returns correct available when proxy bumps reservedBalance", () => {
  // Integration: bud-endpoint får reservedBalance=310K (fra computeReservedBalance);
  // bud på 250K mod balance 500K skal afvises (310K + 250K = 560K > 500K).
  const issue = getAuctionBidIssue({
    amount: 250000,
    currentPrice: 100000,
    currentBidderId: "team-other",
    teamBalance: 500000,
    reservedBalance: 310000,
  });
  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.totalCommitment, 560000);
});

// ── #44 worst-case-commitment helpers ────────────────────────────────────────

test("computeWorstCaseCommitment sums leading + non-leading proxy commitments", () => {
  // Leading uden proxy = current_price (60K)
  // Leading med proxy = MAX(current_price, proxy_max) (200K)
  // Ikke-leading med proxy = proxy_max (300K)
  const total = computeWorstCaseCommitment({
    leadingAuctions: [
      { id: "a1", current_price: 60000 },
      { id: "a2", current_price: 50000 },
    ],
    allMyProxies: [
      { auction_id: "a2", max_amount: 200000 },
      { auction_id: "a3", max_amount: 300000 },
    ],
  });
  assert.equal(total, 60000 + 200000 + 300000);
});

test("computeWorstCaseCommitment ignores stale leading proxy (max < current_price)", () => {
  // Stale proxy: current_price 100K, proxy_max 50K → contribution 100K (proxy kan ikke
  // overbyde det manuelt-budte). Samme regel som computeReservedBalance.
  const total = computeWorstCaseCommitment({
    leadingAuctions: [{ id: "a1", current_price: 100000 }],
    allMyProxies: [{ auction_id: "a1", max_amount: 50000 }],
  });
  assert.equal(total, 100000);
});

test("computeWorstCaseCommitment dedupes when proxy and lead are on same auction", () => {
  // Hvis manageren både leder og har proxy på samme auktion, må vi ikke dobbelttælle.
  const total = computeWorstCaseCommitment({
    leadingAuctions: [{ id: "a1", current_price: 50000 }],
    allMyProxies: [{ auction_id: "a1", max_amount: 200000 }],
  });
  assert.equal(total, 200000);
});

test("computeWorstCaseCommitment returns 0 for empty input", () => {
  assert.equal(computeWorstCaseCommitment({}), 0);
  assert.equal(computeWorstCaseCommitment({ leadingAuctions: [], allMyProxies: [] }), 0);
});

test("computeAvailableBalance subtracts commitment and clamps to 0", () => {
  assert.equal(computeAvailableBalance({ teamBalance: 500000, commitment: 200000 }), 300000);
  assert.equal(computeAvailableBalance({ teamBalance: 100000, commitment: 200000 }), 0);
  assert.equal(computeAvailableBalance({ teamBalance: 0, commitment: 0 }), 0);
});

// ── #44 gates ────────────────────────────────────────────────────────────────

test("getAuctionBidIssue gates MAX(amount, proxyMax) mod available balance", () => {
  // Manager har 500K balance, 0 reserved. Byder 50K med proxy_max 600K.
  // Pre-#44: 50K < 500K ✓ pass, men proxy 600K committer mere end balance.
  // Post-#44: MAX(50K, 600K) = 600K mod 500K → afvist.
  const issue = getAuctionBidIssue({
    amount: 50000,
    proxyMax: 600000,
    currentPrice: 40000,
    currentBidderId: "team-other",
    teamBalance: 500000,
    reservedBalance: 0,
  });
  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.totalCommitment, 600000);
});

test("getAuctionBidIssue without proxyMax behaves som før (backwards-compat)", () => {
  const issue = getAuctionBidIssue({
    amount: 100000,
    currentPrice: 50000,
    currentBidderId: "team-other",
    teamBalance: 500000,
    reservedBalance: 0,
  });
  assert.equal(issue, null);
});

test("getAuctionBidIssue accepts when proxyMax er <= amount", () => {
  // proxyMax 30K på et 50K-bud betyder proxy ikke vil trigger højere — ingen ekstra commitment.
  const issue = getAuctionBidIssue({
    amount: 50000,
    proxyMax: 30000,
    currentPrice: 40000,
    currentBidderId: "team-other",
    teamBalance: 500000,
    reservedBalance: 100000,
  });
  assert.equal(issue, null);
});

test("getProxyMaxIssue blocks proxy > available balance på ikke-leading auktion", () => {
  // Manager har 500K balance, 200K commitment fra andre auktioner. Sætter proxy 400K
  // på en auktion de ikke leder. Worst case: proxy trigger fuldt → 200K + 400K = 600K
  // > 500K → afvist.
  const issue = getProxyMaxIssue({
    proxyMax: 400000,
    currentPrice: 50000,
    isLeading: false,
    teamBalance: 500000,
    otherCommitment: 200000,
  });
  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.availableBalance, 300000);
});

test("getProxyMaxIssue accepts proxy som lige passer i available", () => {
  // 500K balance, 200K commitment, sætter proxy 300K → 500K ≥ 500K total → accepteret.
  const issue = getProxyMaxIssue({
    proxyMax: 300000,
    currentPrice: 50000,
    isLeading: false,
    teamBalance: 500000,
    otherCommitment: 200000,
  });
  assert.equal(issue, null);
});

test("getProxyMaxIssue bruger MAX(current_price, proxy_max) når isLeading=true", () => {
  // Leading på auktion med current_price 100K. Sætter proxy 80K (under current_price).
  // Worst case = current_price 100K (proxy kan ikke gå lavere). otherCommitment=0,
  // balance=150K → 150K ≥ 100K → accepteret.
  const ok = getProxyMaxIssue({
    proxyMax: 80000,
    currentPrice: 100000,
    isLeading: true,
    teamBalance: 150000,
    otherCommitment: 0,
  });
  assert.equal(ok, null);

  // Samme manager prøver proxy 200K → worst case 200K, 150K balance → afvist.
  const bad = getProxyMaxIssue({
    proxyMax: 200000,
    currentPrice: 100000,
    isLeading: true,
    teamBalance: 150000,
    otherCommitment: 0,
  });
  assert.equal(bad?.code, "insufficient_available_balance");
});

test("getProxyMaxIssue afviser ugyldige værdier", () => {
  assert.equal(getProxyMaxIssue({ proxyMax: 0, teamBalance: 1000 })?.code, "invalid_proxy_max");
  assert.equal(getProxyMaxIssue({ proxyMax: -5, teamBalance: 1000 })?.code, "invalid_proxy_max");
  assert.equal(getProxyMaxIssue({ proxyMax: NaN, teamBalance: 1000 })?.code, "invalid_proxy_max");
  assert.equal(getProxyMaxIssue({ proxyMax: "abc", teamBalance: 1000 })?.code, "invalid_proxy_max");
});

test("getProxyOpeningBidAmount placerer autobud som første bud på asking price", () => {
  const bidAmount = getProxyOpeningBidAmount({
    proxyMax: 50000,
    currentPrice: 20000,
    currentBidderId: null,
    isLeading: false,
  });
  assert.equal(bidAmount, 20000);
});

test("getProxyOpeningBidAmount placerer autobud som minimum over aktiv leder", () => {
  const bidAmount = getProxyOpeningBidAmount({
    proxyMax: 50000,
    currentPrice: 20000,
    currentBidderId: "team-other",
    isLeading: false,
  });
  assert.equal(bidAmount, 20001);
});

test("getProxyOpeningBidAmount no-op når manager allerede fører", () => {
  const bidAmount = getProxyOpeningBidAmount({
    proxyMax: 50000,
    currentPrice: 20000,
    currentBidderId: "team-me",
    isLeading: true,
  });
  assert.equal(bidAmount, null);
});

test("getSpendIssue gates loan-repay/transfer/buyout mod available balance", () => {
  // jeppek-eksemplet: 500K balance, 200K gæld, 400K i bud (commitment).
  // Tilgængelig = 500K - 400K = 100K. Forsøg at betale 200K af gæld → afvist (kun 100K muligt).
  const issue = getSpendIssue({
    teamBalance: 500000,
    commitment: 400000,
    attemptedSpend: 200000,
  });
  assert.equal(issue?.code, "insufficient_available_balance");
  assert.equal(issue?.availableBalance, 100000);

  // Repay på 100K passerer.
  const ok = getSpendIssue({
    teamBalance: 500000,
    commitment: 400000,
    attemptedSpend: 100000,
  });
  assert.equal(ok, null);

  // Repay på 100001 afvises (1 CZ$ for meget).
  const tight = getSpendIssue({
    teamBalance: 500000,
    commitment: 400000,
    attemptedSpend: 100001,
  });
  assert.equal(tight?.code, "insufficient_available_balance");
});

test("getSpendIssue accepts spend uden commitment", () => {
  // Ingen aktive bud → fuld balance er tilgængelig.
  const ok = getSpendIssue({
    teamBalance: 500000,
    commitment: 0,
    attemptedSpend: 500000,
  });
  assert.equal(ok, null);
});

test("isExpectedPriceStale returns false when expected matches current", () => {
  assert.equal(isExpectedPriceStale(50000, 50000), false);
  assert.equal(isExpectedPriceStale(0, 0), false);
});

test("isExpectedPriceStale returns true when expected differs from current", () => {
  assert.equal(isExpectedPriceStale(50000, 60000), true);
  assert.equal(isExpectedPriceStale(60000, 50000), true);
});

test("isExpectedPriceStale returns false when expected is undefined or invalid (bagudkompat)", () => {
  assert.equal(isExpectedPriceStale(undefined, 50000), false);
  assert.equal(isExpectedPriceStale(null, 50000), false);
  assert.equal(isExpectedPriceStale("notanumber", 50000), false);
});
