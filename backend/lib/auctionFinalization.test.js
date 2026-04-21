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

test("calculateAuctionSalary keeps the 10 percent rule with a minimum salary of 1", () => {
  assert.equal(calculateAuctionSalary(1), 1);
  assert.equal(calculateAuctionSalary(9), 1);
  assert.equal(calculateAuctionSalary(10), 1);
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
  buyerTeam,
  riderCount,
  pendingCount,
  activeLoanCount,
  auctionUpdates,
} = {}) {
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
            assert.equal(columns, "id, name, balance, division, user_id");

            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, buyerTeam.id);

                return {
                  single() {
                    return Promise.resolve({ data: buyerTeam, error: null });
                  },
                };
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
                assert.equal(value, buyerTeam.id);

                if (column === "team_id") {
                  return Promise.resolve({ count: riderCount, error: null });
                }

                if (column === "pending_team_id") {
                  return Promise.resolve({ count: pendingCount, error: null });
                }

                throw new Error(`Unexpected riders column: ${column}`);
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
                assert.equal(firstValue, buyerTeam.id);

                return {
                  eq(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    assert.equal(secondValue, "active");
                    return Promise.resolve({ count: activeLoanCount, error: null });
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

test("finalizeAuctionById blocks a winner whose borrowed riders already fill the squad", async () => {
  const auctionUpdates = [];
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
      buyerTeam: {
        id: "buyer-team",
        name: "Buyer",
        balance: 500,
        division: 3,
        user_id: "user-1",
      },
      riderCount: 8,
      pendingCount: 1,
      activeLoanCount: 1,
      auctionUpdates,
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
  assert.equal(notifications[0].teamId, "buyer-team");
  assert.match(notifications[0].message, /kan max have 10 ryttere/);
});
