import test from "node:test";
import assert from "node:assert/strict";

import { resolveProxyBids } from "./proxyBidding.js";

// Bygger en stateful in-memory supabase-mock der dækker præcis de queries
// resolveProxyBids udfører. Hold den minimal — vi tester kun resolver-loopet.
function createMockSupabase({ auction, proxies = [], teams = {} }) {
  const auctionState = { ...auction };
  const bidLog = [];
  const updateLog = [];

  return {
    state: { auction: auctionState, bids: bidLog, updates: updateLog },
    from(table) {
      if (table === "auctions") {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    return Promise.resolve({ data: { ...auctionState }, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                Object.assign(auctionState, payload);
                updateLog.push({ ...payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }
      if (table === "auction_proxy_bids") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: proxies, error: null });
              },
            };
          },
        };
      }
      if (table === "auction_bids") {
        return {
          insert(payload) {
            bidLog.push({ ...payload });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === "teams") {
        return {
          select() {
            return {
              eq(_col, id) {
                return {
                  single() {
                    return Promise.resolve({ data: teams[id] || null, error: null });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const FUTURE_END = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
const BID_TIME = new Date();

test("resolver: A's proxy 100K outbidder B's manuelle bid 80K til 80.001 (Test 1 fra #171)", async () => {
  const auction = {
    id: "auc-1",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    // B har INGEN proxy
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-1",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 1);
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 80001);
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.auction.current_price, 80001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
});

test("resolver: A 100K vs B 200K opløses til B leder ved 100.001 (Test 2 fra #171)", async () => {
  const auction = {
    id: "auc-2",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 11000, // B lige bidet 11K manuelt
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-2",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Forventet: B's proxy slår A's max — B byder på 100.001 (A.max + 1) og loopet stopper.
  const lastBid = supabase.state.bids.at(-1);
  assert.equal(lastBid.team_id, "team-b");
  assert.equal(lastBid.amount, 100001);
  assert.equal(supabase.state.auction.current_price, 100001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
});

test("resolver: stale winner-proxy efter eget manuelt bid blokerer ikke counter-bid (#171 rod-årsag)", async () => {
  // B satte proxy 60K tidligere, derefter manuelt bid 80K.
  // A's proxy 100K skal stadig følge med op til 80.001.
  // Pre-fix: resolver brugte winnerProxy.max + 1 = 60.001 < currentPrice → break.
  const auction = {
    id: "auc-3",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 60000 }, // STALE — under currentPrice
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-3",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Forventet: A's proxy outbidder til 80.001 (minBid), loop stopper når intet challenger tilbage.
  assert.equal(supabase.state.bids.length, 1, "skulle place præcis 1 counter-bid (A's proxy)");
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 80001);
  assert.equal(supabase.state.auction.current_price, 80001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
});

test("resolver: ingen challengers (proxies under minBid) → no-op", async () => {
  const auction = {
    id: "auc-4",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-b", max_amount: 50000 }, // under minBid 100.001
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-4",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 0);
  assert.equal(supabase.state.auction.current_price, 100000);
});

test("resolver: ekspireret auktion → no-op", async () => {
  const auction = {
    id: "auc-5",
    status: "active",
    calculated_end: new Date(Date.now() - 60_000).toISOString(), // -1 min
    current_price: 50000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-5",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 0);
});

test("resolver: tre proxies — højeste leder ved næsthøjeste max + 1", async () => {
  // C med max 300K vs A 100K vs B 200K — C skal lede ved B.max + 1 = 200.001.
  // Test verificerer at multi-iteration korrekt opløser pyramiden.
  const auction = {
    id: "auc-6",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-x", // tilfældig ikke-proxy bidder
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
    { team_id: "team-c", max_amount: 300000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-6",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Itr 1: ingen winner-proxy (X), top-challenger C → C byder minBid 50.001
  // Itr 2: C leder, B er challenger, C's proxy 300K >= 200.001 → C byder 200.001
  // Itr 3: ingen challengers > 200.002, break
  const lastBid = supabase.state.bids.at(-1);
  assert.equal(lastBid.team_id, "team-c");
  assert.equal(lastBid.amount, 200001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-c");
  assert.equal(supabase.state.auction.current_price, 200001);
});
