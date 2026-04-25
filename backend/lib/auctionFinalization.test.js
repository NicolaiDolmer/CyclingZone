import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAuctionSalary,
  finalizeAuctionById,
  finalizeExpiredAuctions,
  sellerOwnsAuctionRider,
} from "./auctionFinalization.js";

test("sellerOwnsAuctionRider is only true when the seller actually owned the rider", () => {
  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: "team-1" },
    }),
    true
  );

  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: null },
    }),
    false
  );

  assert.equal(
    sellerOwnsAuctionRider({
      seller_team_id: "team-1",
      rider: { team_id: "ai-team" },
    }),
    false
  );
});

test("calculateAuctionSalary uses the 15 percent rule with a minimum salary of 1", () => {
  assert.equal(calculateAuctionSalary(1), 1);
  assert.equal(calculateAuctionSalary(9), 1);
  assert.equal(calculateAuctionSalary(10), 2);
  assert.equal(calculateAuctionSalary(11), 2);
});

function createExpiredAuctionsLookupSupabase({ data = [], error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, "auctions");

      return {
        select(columns) {
          assert.equal(columns, "id");

          return {
            in(column, statuses) {
              assert.equal(column, "status");
              assert.deepEqual(statuses, ["active", "extended"]);

              return {
                lte(field, _value) {
                  assert.equal(field, "calculated_end");
                  return Promise.resolve({ data, error });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("finalizeExpiredAuctions can no-op when there are no expired auctions", async () => {
  const results = await finalizeExpiredAuctions({
    supabase: createExpiredAuctionsLookupSupabase(),
    notifyTeamOwner: async () => {},
  });

  assert.deepEqual(results, []);
});

test("finalizeExpiredAuctions surfaces lookup errors before processing auctions", async () => {
  await assert.rejects(
    finalizeExpiredAuctions({
      supabase: createExpiredAuctionsLookupSupabase({
        error: { message: "auction lookup failed" },
      }),
      notifyTeamOwner: async () => {},
    }),
    /auction lookup failed/
  );
});

function createFinalizeAuctionSupabase({
  auction,
  teams = {},
  teamMarketCounts = {},
  transferWindowStatus = "open",
  auctionUpdates,
  teamUpdates = [],
  riderUpdates = [],
  financeInserts = [],
} = {}) {
  const bankTeam = Object.values(teams).find(team => team.is_bank) || null;

  return {
    from(table) {
      if (table === "auctions") {
        return {
          select(columns) {
            assert.equal(columns, "*, rider:rider_id(*)");

            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, auction.id);

                return {
                  maybeSingle() {
                    return Promise.resolve({ data: auction, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, auction.id);
                auctionUpdates.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "teams") {
        return {
          select(columns) {
            return {
              eq(column, value) {
                let team = null;

                if (column === "id") {
                  team = teams[value] || null;
                } else if (column === "is_bank") {
                  assert.equal(value, true);
                  team = bankTeam;
                } else {
                  throw new Error(`Unexpected teams column: ${column}`);
                }

                return {
                  single() {
                    return Promise.resolve({
                      data: team,
                      error: team ? null : { message: "Team not found" },
                    });
                  },
                  maybeSingle() {
                    return Promise.resolve({ data: team, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                teamUpdates.push({ teamId: value, payload });
                if (teams[value]) {
                  teams[value] = { ...teams[value], ...payload };
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "riders") {
        return {
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });

            return {
              eq(column, value) {
                const counts = teamMarketCounts[value] || {};

                if (column === "team_id") {
                  return Promise.resolve({ count: counts.riderCount || 0, error: null });
                }

                if (column === "pending_team_id") {
                  return Promise.resolve({ count: counts.pendingCount || 0, error: null });
                }

                throw new Error(`Unexpected riders column: ${column}`);
              },
            };
          },
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, auction.rider.id);
                riderUpdates.push(payload);
                auction.rider = { ...auction.rider, ...payload };
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "loan_agreements") {
        return {
          select(columns, options) {
            assert.equal(columns, "id");
            assert.deepEqual(options, { count: "exact", head: true });

            return {
              eq(firstColumn, firstValue) {
                assert.equal(firstColumn, "to_team_id");
                const counts = teamMarketCounts[firstValue] || {};

                return {
                  eq(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    assert.equal(secondValue, "active");
                    return Promise.resolve({ count: counts.activeLoanCount || 0, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "transfer_windows") {
        return {
          select(columns) {
            assert.equal(columns, "status");
            return {
              order(column, options) {
                assert.equal(column, "created_at");
                assert.deepEqual(options, { ascending: false });
                return {
                  limit(value) {
                    assert.equal(value, 1);
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: transferWindowStatus
                            ? { status: transferWindowStatus }
                            : null,
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "finance_transactions") {
        return {
          insert(payload) {
            financeInserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("finalizeAuctionById blocks a winner whose borrowed riders already fill the squad", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];
  const notifications = [];
  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-1",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 75,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-1",
          firstname: "Loan",
          lastname: "Blocked",
          team_id: "seller-team",
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500,
          division: 3,
          user_id: "user-1",
        },
      },
      teamMarketCounts: {
        "buyer-team": {
          riderCount: 8,
          pendingCount: 1,
          activeLoanCount: 1,
        },
      },
      auctionUpdates,
      riderUpdates,
    }),
    auctionId: "auction-1",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-04-21T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "squad_full");
  assert.equal(auctionUpdates.length, 1);
  assert.deepEqual(auctionUpdates[0], {
    status: "completed",
    actual_end: "2026-04-21T10:00:00.000Z",
    seller_team_id: "seller-team",
  });
  assert.equal(notifications.length, 2);
  assert.deepEqual(riderUpdates, []);
  assert.equal(notifications[0].teamId, "buyer-team");
  assert.match(notifications[0].message, /kan max have 10 ryttere/);
});

test("finalizeAuctionById pays the actual AI owner instead of the initiator", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];
  const xpAwards = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-ai",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 120,
        seller_team_id: "initiator-team",
        rider: {
          id: "rider-ai",
          firstname: "AI",
          lastname: "Owner",
          team_id: "ai-team",
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500,
          division: 3,
          user_id: "user-buyer",
        },
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 200,
          division: 3,
          user_id: "user-init",
          is_ai: false,
        },
        "ai-team": {
          id: "ai-team",
          name: "AI Team",
          balance: 1000,
          division: 1,
          user_id: null,
          is_ai: true,
        },
      },
      teamMarketCounts: {
        "buyer-team": {
          riderCount: 5,
          pendingCount: 0,
          activeLoanCount: 0,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-ai",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    awardXP: async (teamId, action) => {
      xpAwards.push({ teamId, action });
    },
    now: new Date("2026-04-22T08:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.equal(result.seller_owned, false);
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-22T08:00:00.000Z",
    seller_team_id: null,
  }]);
  assert.deepEqual(teamUpdates, [
    { teamId: "buyer-team", payload: { balance: 380 } },
    { teamId: "ai-team", payload: { balance: 1120 } },
  ]);
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    salary: 18,
  }]);
  assert.equal(financeInserts.length, 1);
  assert.deepEqual(financeInserts[0], [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -120,
      description: "Købt AI Owner på auktion",
    },
    {
      team_id: "ai-team",
      type: "transfer_in",
      amount: 120,
      description: "Solgt AI Owner på auktion",
    },
  ]);
  assert.deepEqual(xpAwards, [
    { teamId: "buyer-team", action: "auction_won" },
  ]);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].teamId, "buyer-team");
  assert.equal(notifications[1].teamId, "initiator-team");
});

test("finalizeAuctionById cancels a stale auction when another human manager owns the rider", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-stale",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 90,
        seller_team_id: "initiator-team",
        rider: {
          id: "rider-stale",
          firstname: "Stale",
          lastname: "Owner",
          team_id: "other-manager-team",
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500,
          division: 3,
          user_id: "user-buyer",
        },
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 200,
          division: 3,
          user_id: "user-init",
          is_ai: false,
        },
        "other-manager-team": {
          id: "other-manager-team",
          name: "Real Owner",
          balance: 900,
          division: 2,
          user_id: "user-owner",
          is_ai: false,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-stale",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-04-22T09:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "cancelled_stale_owner");
  assert.deepEqual(auctionUpdates, [{
    status: "cancelled",
    actual_end: "2026-04-22T09:00:00.000Z",
    seller_team_id: null,
  }]);
  assert.deepEqual(teamUpdates, []);
  assert.deepEqual(riderUpdates, []);
  assert.deepEqual(financeInserts, []);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].teamId, "buyer-team");
  assert.equal(notifications[1].teamId, "initiator-team");
  assert.match(notifications[0].message, /anden manager/);
});

test("finalizeAuctionById still pays the human seller for a normal owned-rider auction", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const xpAwards = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-owned",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 150,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-owned",
          firstname: "Owned",
          lastname: "Seller",
          team_id: "seller-team",
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500,
          division: 3,
          user_id: "user-buyer",
        },
        "seller-team": {
          id: "seller-team",
          name: "Seller",
          balance: 250,
          division: 3,
          user_id: "user-seller",
          is_ai: false,
        },
      },
      teamMarketCounts: {
        "buyer-team": {
          riderCount: 6,
          pendingCount: 0,
          activeLoanCount: 0,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-owned",
    notifyTeamOwner: async () => {},
    awardXP: async (teamId, action) => {
      xpAwards.push({ teamId, action });
    },
    now: new Date("2026-04-22T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.equal(result.seller_owned, true);
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-22T10:00:00.000Z",
    seller_team_id: "seller-team",
  }]);
  assert.deepEqual(teamUpdates, [
    { teamId: "buyer-team", payload: { balance: 350 } },
    { teamId: "seller-team", payload: { balance: 400 } },
  ]);
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    salary: 23,
  }]);
  assert.equal(financeInserts.length, 1);
  assert.deepEqual(financeInserts[0], [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -150,
      description: "Købt Owned Seller på auktion",
    },
    {
      team_id: "seller-team",
      type: "transfer_in",
      amount: 150,
      description: "Solgt Owned Seller på auktion",
    },
  ]);
  assert.deepEqual(xpAwards, [
    { teamId: "buyer-team", action: "auction_won" },
    { teamId: "seller-team", action: "auction_sold" },
  ]);
});

test("finalizeAuctionById keeps guaranteed sale on non-owned riders payout-free and history-safe", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-guaranteed",
        status: "active",
        current_bidder_id: null,
        current_price: 50,
        seller_team_id: "initiator-team",
        is_guaranteed_sale: true,
        guaranteed_price: 50,
        rider: {
          id: "rider-guaranteed",
          firstname: "Guaranteed",
          lastname: "AI",
          team_id: "ai-team",
        },
      },
      teams: {
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 200,
          division: 3,
          user_id: "user-init",
          is_ai: false,
        },
        "ai-team": {
          id: "ai-team",
          name: "AI Team",
          balance: 1000,
          division: 1,
          user_id: null,
          is_ai: true,
        },
        bank: {
          id: "bank",
          name: "Banken",
          balance: 999999,
          division: 1,
          user_id: null,
          is_ai: true,
          is_bank: true,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-guaranteed",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-04-22T11:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "no_bids");
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-22T11:00:00.000Z",
    seller_team_id: null,
  }]);
  assert.deepEqual(teamUpdates, []);
  assert.deepEqual(riderUpdates, []);
  assert.deepEqual(financeInserts, []);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].teamId, "initiator-team");
});
