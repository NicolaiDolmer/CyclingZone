import test from "node:test";
import assert from "node:assert/strict";

import { cancelAuctionByAdmin, cancelActiveAuctionsForRider } from "./auctionCancellation.js";

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

// ── #3594 · cancelActiveAuctionsForRider ────────────────────────────────────
// Den manglende bro mellem "en rytter skal slettes" og den eksisterende,
// velafprøvede cancelAuctionByAdmin: find rytterens aktive/udvidede auktioner
// og annullér HVER via cancelAuctionByAdmin (samme notifikations-/
// frigivelses-logik), FØR en kalder (riderCleanupDeletion.js) sletter
// rytteren selv.

function createRiderAuctionsMockSupabase({ auctions = [], bidsByAuction = {} }) {
  return {
    from(table) {
      if (table === "auctions") {
        return {
          select(cols) {
            if (cols === "id") {
              // cancelActiveAuctionsForRider's opslag: aktive/udvidede auktioner for rytteren.
              return {
                eq(_col, riderId) {
                  return {
                    in(_col2, statuses) {
                      const matches = auctions
                        .filter((a) => a.rider_id === riderId && statuses.includes(a.status))
                        .map((a) => ({ id: a.id }));
                      return Promise.resolve({ data: matches, error: null });
                    },
                  };
                },
              };
            }
            // cancelAuctionByAdmin's egen detalje-opslag (join simuleret via seedet `rider`-felt).
            return {
              eq(_col, id) {
                return {
                  maybeSingle: () => Promise.resolve({ data: auctions.find((a) => a.id === id) ?? null, error: null }),
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_col, id) {
                return {
                  in(_col2, statuses) {
                    return {
                      select() {
                        const row = auctions.find((a) => a.id === id);
                        if (row && statuses.includes(row.status)) {
                          Object.assign(row, payload);
                          return Promise.resolve({ data: [{ id: row.id }], error: null });
                        }
                        return Promise.resolve({ data: [], error: null });
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "auction_bids") {
        return {
          select() {
            return {
              eq: (_col, auctionId) => Promise.resolve({ data: bidsByAuction[auctionId] || [], error: null }),
            };
          },
        };
      }
      if (table === "riders") {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }
      if (table === "admin_log") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("cancelActiveAuctionsForRider cancels every active/extended auction on the rider and notifies each bidder", async () => {
  const notifications = [];
  const auctions = [
    { id: "a1", status: "active", rider_id: "r1", seller_team_id: null, rider: { id: "r1", firstname: "A", lastname: "B" } },
    { id: "a2", status: "extended", rider_id: "r1", seller_team_id: null, rider: { id: "r1", firstname: "A", lastname: "B" } },
    { id: "a3", status: "completed", rider_id: "r1", seller_team_id: null, rider: { id: "r1", firstname: "A", lastname: "B" } },
  ];

  const results = await cancelActiveAuctionsForRider({
    supabase: createRiderAuctionsMockSupabase({
      auctions,
      bidsByAuction: { a1: [{ team_id: "bidder-a" }], a2: [{ team_id: "bidder-b" }] },
    }),
    riderId: "r1",
    adminUserId: "admin-1",
    notifyTeamOwner: async (teamId, type) => {
      notifications.push({ teamId, type });
    },
  });

  // a3 (completed) er ikke i CANCELLABLE_STATUSES — kun a1+a2 annulleres.
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok), "begge annulleringer skal lykkes");
  assert.deepEqual(results.map((r) => r.auction_id).sort(), ["a1", "a2"]);
  assert.equal(auctions.find((a) => a.id === "a1").status, "cancelled");
  assert.equal(auctions.find((a) => a.id === "a2").status, "cancelled");
  assert.equal(auctions.find((a) => a.id === "a3").status, "completed", "completed auktionen røres ikke");
  assert.deepEqual(notifications.map((n) => n.teamId).sort(), ["bidder-a", "bidder-b"]);
  assert.ok(notifications.every((n) => n.type === "auction_cancelled"));
});

test("cancelActiveAuctionsForRider returns an empty list when the rider has no active auctions", async () => {
  const results = await cancelActiveAuctionsForRider({
    supabase: createRiderAuctionsMockSupabase({ auctions: [] }),
    riderId: "r-none",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });
  assert.deepEqual(results, []);
});
