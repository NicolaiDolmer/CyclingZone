import test from "node:test";
import assert from "node:assert/strict";

import { cancelAuctionByAdmin } from "./auctionCancellation.js";

function createMockSupabase({
  auction,
  bids = [],
  cancelResult = null,
  inserts = [],
  riderUpdates = [],
}) {
  return {
    from(table) {
      if (table === "auctions") {
        return {
          select() {
            return {
              eq(_col, _val) {
                return {
                  maybeSingle: () => Promise.resolve({ data: auction, error: null }),
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_col1, _val1) {
                return {
                  in(_col2, statuses) {
                    return {
                      select() {
                        const result = cancelResult !== null
                          ? cancelResult
                          : (statuses.includes(auction?.status) ? [{ id: auction.id }] : []);
                        return Promise.resolve({ data: result, error: null, payload });
                      },
                    };
                  },
                };
              },
            };
          },
          insert(_row) {
            inserts.push({ table, row: _row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "auction_bids") {
        return {
          select() {
            return {
              eq: () => Promise.resolve({ data: bids, error: null }),
            };
          },
        };
      }
      if (table === "riders") {
        return {
          update(payload) {
            return {
              eq(_col, val) {
                riderUpdates.push({ id: val, payload });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "admin_log") {
        return {
          insert(row) {
            inserts.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("cancelAuctionByAdmin returns not_found when auction missing", async () => {
  const result = await cancelAuctionByAdmin({
    supabase: createMockSupabase({ auction: null }),
    auctionId: "missing",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

test("cancelAuctionByAdmin returns not_cancellable when auction completed", async () => {
  const result = await cancelAuctionByAdmin({
    supabase: createMockSupabase({
      auction: { id: "a1", status: "completed", rider: { id: "r1", firstname: "A", lastname: "B" } },
    }),
    auctionId: "a1",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_cancellable");
  assert.equal(result.status, "completed");
});

test("cancelAuctionByAdmin returns race_lost when finalizer wins between read and update", async () => {
  const result = await cancelAuctionByAdmin({
    supabase: createMockSupabase({
      auction: { id: "a1", status: "active", rider: { id: "r1", firstname: "A", lastname: "B" }, seller_team_id: null },
      cancelResult: [], // simulate atomic update affected 0 rows
    }),
    auctionId: "a1",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "race_lost");
});

test("cancelAuctionByAdmin notifies all unique bidders + seller and logs activity", async () => {
  const inserts = [];
  const riderUpdates = [];
  const notifications = [];
  const activityLog = [];

  const result = await cancelAuctionByAdmin({
    supabase: createMockSupabase({
      auction: {
        id: "a1",
        status: "active",
        current_price: 150_000,
        seller_team_id: "seller-team",
        rider: { id: "r1", firstname: "Tadej", lastname: "Pogacar" },
      },
      bids: [
        { team_id: "bidder-a" },
        { team_id: "bidder-b" },
        { team_id: "bidder-a" }, // dup — skal de-dupes
      ],
      inserts,
      riderUpdates,
    }),
    auctionId: "a1",
    adminUserId: "admin-1",
    notifyTeamOwner: async (teamId, type, title, message, relatedId) => {
      notifications.push({ teamId, type, title, message, relatedId });
    },
    logActivity: async (type, data) => {
      activityLog.push({ type, data });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "cancelled");
  assert.equal(result.bidder_count, 2);
  assert.equal(result.rider_name, "Tadej Pogacar");

  // 2 unique bidders + 1 seller = 3 notifications
  assert.equal(notifications.length, 3);
  assert.equal(notifications.every(n => n.type === "auction_cancelled"), true);
  const recipients = notifications.map(n => n.teamId).sort();
  assert.deepEqual(recipients, ["bidder-a", "bidder-b", "seller-team"]);

  // Rider pending_team_id ryddet defensivt
  assert.equal(riderUpdates.length, 1);
  assert.equal(riderUpdates[0].id, "r1");
  assert.deepEqual(riderUpdates[0].payload, { pending_team_id: null });

  // Admin-log skrevet
  const adminLogInsert = inserts.find(i => i.table === "admin_log");
  assert.ok(adminLogInsert, "admin_log entry inserted");
  assert.equal(adminLogInsert.row.action_type, "auction_cancel");
  assert.equal(adminLogInsert.row.target_rider_id, "r1");
  assert.equal(adminLogInsert.row.meta.bidder_count, 2);

  // Activity feed entry
  assert.equal(activityLog.length, 1);
  assert.equal(activityLog[0].type, "auction_cancelled");
});

test("cancelAuctionByAdmin skips seller-notify when seller already among bidders", async () => {
  const notifications = [];

  const result = await cancelAuctionByAdmin({
    supabase: createMockSupabase({
      auction: {
        id: "a1",
        status: "extended",
        current_price: 100_000,
        seller_team_id: "team-x",
        rider: { id: "r1", firstname: "Mads", lastname: "Pedersen" },
      },
      bids: [{ team_id: "team-x" }],
    }),
    auctionId: "a1",
    adminUserId: "admin-1",
    notifyTeamOwner: async (teamId, type) => {
      notifications.push({ teamId, type });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].teamId, "team-x");
});
