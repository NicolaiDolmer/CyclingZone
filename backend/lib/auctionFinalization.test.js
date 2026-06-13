import test from "node:test";
import assert from "node:assert/strict";

import {
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
  listingUpdates = [],
} = {}) {
  const bankTeam = Object.values(teams).find(team => team.is_bank) || null;

  return {
    // Slice 07c: balance + finance_transactions atomic via RPC.
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const team = teams[params.p_team_id];
      const before = team?.balance ?? 0;
      const after = before + params.p_delta;
      if (team) {
        team.balance = after;
        teams[params.p_team_id] = team;
      }
      teamUpdates.push({ teamId: params.p_team_id, payload: { balance: after } });
      financeInserts.push({
        team_id: params.p_team_id,
        ...params.p_finance_payload,
      });
      return Promise.resolve({ data: after, error: null });
    },
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
          select(_columns) {
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

            // #268: getTeamMarketState's outgoing-query chains .eq().not().neq()
            // — match med en chainable builder der dispatcher counts efter filtre.
            return {
              eq(column, value) {
                const counts = teamMarketCounts[value] || {};

                if (column === "team_id") {
                  const teamId = value;
                  return {
                    not(col, op, val) {
                      assert.equal(col, "pending_team_id");
                      assert.equal(op, "is");
                      assert.equal(val, null);
                      return {
                        neq(neqCol, neqVal) {
                          assert.equal(neqCol, "pending_team_id");
                          assert.equal(neqVal, teamId);
                          return Promise.resolve({ count: counts.outgoingCount || 0, error: null });
                        },
                      };
                    },
                    then(resolve, reject) {
                      return Promise.resolve({ count: counts.riderCount || 0, error: null }).then(resolve, reject);
                    },
                  };
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
                  in(secondColumn, secondValue) {
                    assert.equal(secondColumn, "status");
                    assert.deepEqual(secondValue, ["active", "window_pending"]);
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

      // #776/#822: salg (auktion eller guaranteed-sale) skal lukke åbne
      // transfer_listings — chain: update().in("rider_id").in("status").
      if (table === "transfer_listings") {
        return {
          update(payload) {
            return {
              in(riderColumn, riderIds) {
                assert.equal(riderColumn, "rider_id");
                return {
                  in(statusColumn, statuses) {
                    assert.equal(statusColumn, "status");
                    listingUpdates.push({ payload, riderIds, statuses });
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === "seasons") {
        // 07d Fase B / #240: finalizeAuctionRecord slår activeSeason op for season_id-stamping.
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "season-active-mock" }, error: null }),
                }),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// #267: i et åbent transfervindue må køber gå +TRANSFER_WINDOW_SOFT_CAP_BUFFER
// over division-cap. Hard-blokade rammer kun hvis køber allerede er på
// effective cap (#838: alle divisioner max 30 → soft-cap 32). Auctioneer-cron
// og admin-finalize matcher samme regel.
test("finalizeAuctionById blocks a winner whose squad already exceeds soft-cap (windowOpen=true)", async () => {
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
          riderCount: 30,
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
  assert.match(notifications[0].message, /32 ryttere/);
  assert.match(notifications[0].message, /buffer i transfervinduet/);
});

// #267: når transfervinduet er lukket (post-cutoff) er hard-cap igen gældende
// — totalAfter > maxRiders blokker, selv hvis køber er +1 over cap.
test("finalizeAuctionById hard-caps when transfer window is closed", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];
  const notifications = [];
  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-closed-window",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 75,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-cw",
          firstname: "Hard",
          lastname: "Cap",
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
          riderCount: 28,
          pendingCount: 1,
          activeLoanCount: 1,
        },
      },
      transferWindowStatus: "closed",
      auctionUpdates,
      riderUpdates,
    }),
    auctionId: "auction-closed-window",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-04-21T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "squad_full");
  assert.equal(notifications.length, 2);
  assert.match(notifications[0].message, /max have 30 ryttere/);
  assert.match(notifications[0].message, /uden for transfervinduet/);
  assert.deepEqual(riderUpdates, []);
});

// #267: køber +1 over hard-cap (D3 har 11) i åbent vindue må gerne vinde
// auktion. Rytteren transfereres til team_id (windowOpen) og finance/audit
// skrives som normalt.
test("finalizeAuctionById allows winner +1 over hard-cap during open window", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];
  const xpAwards = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-soft-cap-allow",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 30000,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-soft-cap",
          firstname: "Soft",
          lastname: "Cap",
          team_id: "seller-team",
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500000,
          division: 3,
          user_id: "user-buyer",
        },
        "seller-team": {
          id: "seller-team",
          name: "Seller",
          balance: 100000,
          division: 3,
          user_id: "user-seller",
          is_ai: false,
        },
      },
      teamMarketCounts: {
        "buyer-team": {
          riderCount: 30, // ved hard-cap, men under soft-cap (30+2=32)
          pendingCount: 0,
          activeLoanCount: 0,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-soft-cap-allow",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    awardXP: async (teamId, action) => {
      xpAwards.push({ teamId, action });
    },
    now: new Date("2026-05-09T17:20:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  // #1309: kontraktløs vinder-rytter (ingen salary i mock) får standard-kontrakt.
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    acquired_at: "2026-05-09T17:20:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.equal(financeInserts.length, 2);
  assert.equal(financeInserts[0].team_id, "buyer-team");
  assert.equal(financeInserts[0].amount, -30000);
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
    acquired_at: "2026-04-22T08:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -120,
      description: "Købt AI Owner på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
      reason_code: "auction_winner_payment",
      related_entity_type: "auction",
      related_entity_id: "auction-ai",
      idempotency_key: "auction_winner:auction-ai",
    },
    {
      team_id: "ai-team",
      type: "transfer_in",
      amount: 120,
      description: "Solgt AI Owner på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.seller",
      reason_code: "auction_seller_payout",
      related_entity_type: "auction",
      related_entity_id: "auction-ai",
      idempotency_key: "auction_seller:auction-ai",
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
    acquired_at: "2026-04-22T10:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -150,
      description: "Købt Owned Seller på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
      reason_code: "auction_winner_payment",
      related_entity_type: "auction",
      related_entity_id: "auction-owned",
      idempotency_key: "auction_winner:auction-owned",
    },
    {
      team_id: "seller-team",
      type: "transfer_in",
      amount: 150,
      description: "Solgt Owned Seller på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.seller",
      reason_code: "auction_seller_payout",
      related_entity_type: "auction",
      related_entity_id: "auction-owned",
      idempotency_key: "auction_seller:auction-owned",
    },
  ]);
  assert.deepEqual(xpAwards, [
    { teamId: "buyer-team", action: "auction_won" },
    { teamId: "seller-team", action: "auction_sold" },
  ]);
});

// #822: en rytter solgt på normal auktion må ikke blive stående som "til salg"
// på transfermarkedet — åbne/negotiating transfer_listings lukkes som 'sold'.
test("finalizeAuctionById closes open transfer listings when the rider is sold at auction (#822)", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];
  const listingUpdates = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-listing-cleanup",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 150,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-listed",
          firstname: "Listed",
          lastname: "Rider",
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
      riderUpdates,
      listingUpdates,
    }),
    auctionId: "auction-listing-cleanup",
    notifyTeamOwner: async () => {},
    now: new Date("2026-06-10T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    acquired_at: "2026-06-10T10:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(listingUpdates, [{
    payload: { status: "sold" },
    riderIds: ["rider-listed"],
    statuses: ["open", "negotiating"],
  }]);
});

// #822 (lukket vindue): salget er bindende selvom rytteren parkeres på
// pending_team_id — listingen skal stadig lukkes, ellers kan rytteren
// dobbelt-sælges via transfermarkedet mens auktionen allerede er betalt.
test("finalizeAuctionById closes open transfer listings even when the window is closed (#822)", async () => {
  const riderUpdates = [];
  const listingUpdates = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-listing-cleanup-closed",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 150,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-listed-cw",
          firstname: "Listed",
          lastname: "Pending",
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
      transferWindowStatus: "closed",
      auctionUpdates: [],
      riderUpdates,
      listingUpdates,
    }),
    auctionId: "auction-listing-cleanup-closed",
    notifyTeamOwner: async () => {},
    now: new Date("2026-06-10T11:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  // #1309: kontrakt skrives også på den parkerede (lukket-vindue) rytter, fordi
  // den generiske pending-flush ved vindue-åbning kun flytter team_id.
  assert.deepEqual(riderUpdates, [{
    pending_team_id: "buyer-team",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(listingUpdates, [{
    payload: { status: "sold" },
    riderIds: ["rider-listed-cw"],
    statuses: ["open", "negotiating"],
  }]);
});

// #776: guaranteed-sale til banken (AI-opkøb) er også et salg — rytteren må
// ikke blive stående som zombie-listing på transfermarkedet.
test("finalizeAuctionById closes open transfer listings on guaranteed sale to the bank (#776)", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const listingUpdates = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-guaranteed-owned",
        status: "active",
        current_bidder_id: null,
        current_price: 50,
        seller_team_id: "seller-team",
        is_guaranteed_sale: true,
        guaranteed_price: 50,
        rider: {
          id: "rider-guaranteed-owned",
          firstname: "Guaranteed",
          lastname: "Owned",
          team_id: "seller-team",
        },
      },
      teams: {
        "seller-team": {
          id: "seller-team",
          name: "Seller",
          balance: 200,
          division: 3,
          user_id: "user-seller",
          is_ai: false,
        },
        bank: {
          id: "bank",
          name: "AI",
          balance: 999999,
          division: 1,
          user_id: null,
          is_ai: true,
          is_bank: true,
        },
      },
      auctionUpdates,
      riderUpdates,
      financeInserts,
      listingUpdates,
    }),
    auctionId: "auction-guaranteed-owned",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-06-10T12:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "guaranteed_sale");
  // #1309: banken erhverver den usolgte rytter → kontraktløs rytter får kontrakt.
  assert.deepEqual(riderUpdates, [{
    team_id: "bank",
    pending_team_id: null,
    acquired_at: "2026-06-10T12:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(listingUpdates, [{
    payload: { status: "sold" },
    riderIds: ["rider-guaranteed-owned"],
    statuses: ["open", "negotiating"],
  }]);
  assert.equal(financeInserts.length, 1);
  assert.equal(financeInserts[0].team_id, "seller-team");
  assert.equal(financeInserts[0].amount, 50);
});

test("finalizeAuctionById keeps guaranteed sale on non-owned riders payout-free and history-safe", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];

  const listingUpdates = [];
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
          name: "AI",
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
      listingUpdates,
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
  // #776: intet salg fandt sted → ingen listings må lukkes.
  assert.deepEqual(listingUpdates, []);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].teamId, "initiator-team");
});

test("finalizeAuctionById completes when the initiator is the sole bidder on an AI-rider auction", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];
  const xpAwards = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-self-bid",
        status: "active",
        current_bidder_id: "initiator-team",
        current_price: 120,
        seller_team_id: "initiator-team",
        rider: {
          id: "rider-ai-self",
          firstname: "AI",
          lastname: "SelfBid",
          team_id: "ai-team",
        },
      },
      teams: {
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 500,
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
        "initiator-team": {
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
    auctionId: "auction-self-bid",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    awardXP: async (teamId, action) => {
      xpAwards.push({ teamId, action });
    },
    now: new Date("2026-04-25T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.equal(result.seller_owned, false);
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-25T10:00:00.000Z",
    seller_team_id: null,
  }]);
  assert.deepEqual(teamUpdates, [
    { teamId: "initiator-team", payload: { balance: 380 } },
    { teamId: "ai-team", payload: { balance: 1120 } },
  ]);
  assert.deepEqual(riderUpdates, [{
    team_id: "initiator-team",
    pending_team_id: null,
    acquired_at: "2026-04-25T10:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "initiator-team",
      type: "transfer_out",
      amount: -120,
      description: "Købt AI SelfBid på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
      reason_code: "auction_winner_payment",
      related_entity_type: "auction",
      related_entity_id: "auction-self-bid",
      idempotency_key: "auction_winner:auction-self-bid",
    },
    {
      team_id: "ai-team",
      type: "transfer_in",
      amount: 120,
      description: "Solgt AI SelfBid på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.seller",
      reason_code: "auction_seller_payout",
      related_entity_type: "auction",
      related_entity_id: "auction-self-bid",
      idempotency_key: "auction_seller:auction-self-bid",
    },
  ]);
  assert.deepEqual(xpAwards, [
    { teamId: "initiator-team", action: "auction_won" },
  ]);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].teamId, "initiator-team");
  assert.match(notifications[0].title, /vandt/i);
  assert.equal(notifications[1].teamId, "initiator-team");
});

test("finalizeAuctionById completes when the initiator is the sole bidder on a free-agent auction", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];
  const xpAwards = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-free-self-bid",
        status: "active",
        current_bidder_id: "initiator-team",
        current_price: 80,
        seller_team_id: "initiator-team",
        rider: {
          id: "rider-free",
          firstname: "Free",
          lastname: "Agent",
          team_id: null,
        },
      },
      teams: {
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 300,
          division: 3,
          user_id: "user-init",
          is_ai: false,
        },
      },
      teamMarketCounts: {
        "initiator-team": {
          riderCount: 4,
          pendingCount: 0,
          activeLoanCount: 0,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-free-self-bid",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    awardXP: async (teamId, action) => {
      xpAwards.push({ teamId, action });
    },
    now: new Date("2026-04-25T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.equal(result.seller_owned, false);
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-25T10:00:00.000Z",
    seller_team_id: null,
  }]);
  assert.deepEqual(teamUpdates, [
    { teamId: "initiator-team", payload: { balance: 220 } },
  ]);
  assert.deepEqual(riderUpdates, [{
    team_id: "initiator-team",
    pending_team_id: null,
    acquired_at: "2026-04-25T10:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "initiator-team",
      type: "transfer_out",
      amount: -80,
      description: "Købt Free Agent på auktion",
      season_id: "season-active-mock",
      actor_type: "cron",
      actor_id: null,
      source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
      reason_code: "auction_winner_payment",
      related_entity_type: "auction",
      related_entity_id: "auction-free-self-bid",
      idempotency_key: "auction_winner:auction-free-self-bid",
    },
  ]);
  assert.deepEqual(xpAwards, [
    { teamId: "initiator-team", action: "auction_won" },
  ]);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].teamId, "initiator-team");
  assert.match(notifications[0].title, /vandt/i);
  assert.equal(notifications[1].teamId, "initiator-team");
});

test("finalizeAuctionById treats legacy non-owned auctions without current_bidder as initiator wins", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-legacy-free",
        status: "active",
        current_bidder_id: null,
        current_price: 48,
        seller_team_id: "initiator-team",
        is_guaranteed_sale: false,
        rider: {
          id: "rider-legacy-free",
          firstname: "Legacy",
          lastname: "Free",
          team_id: null,
        },
      },
      teams: {
        "initiator-team": {
          id: "initiator-team",
          name: "Initiator",
          balance: 300,
          division: 3,
          user_id: "user-init",
          is_ai: false,
        },
      },
      teamMarketCounts: {
        "initiator-team": {
          riderCount: 4,
          pendingCount: 0,
          activeLoanCount: 0,
        },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-legacy-free",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-04-29T17:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.deepEqual(auctionUpdates, [{
    status: "completed",
    actual_end: "2026-04-29T17:00:00.000Z",
    seller_team_id: null,
    current_bidder_id: "initiator-team",
  }]);
  assert.deepEqual(teamUpdates, [
    { teamId: "initiator-team", payload: { balance: 252 } },
  ]);
  assert.deepEqual(riderUpdates, [{
    team_id: "initiator-team",
    pending_team_id: null,
    acquired_at: "2026-04-29T17:00:00.000Z",
    salary: 100,
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [{
    team_id: "initiator-team",
    type: "transfer_out",
    amount: -48,
    description: "Købt Legacy Free på auktion",
    season_id: "season-active-mock",
    actor_type: "cron",
    actor_id: null,
    source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
    reason_code: "auction_winner_payment",
    related_entity_type: "auction",
    related_entity_id: "auction-legacy-free",
    idempotency_key: "auction_winner:auction-legacy-free",
  }]);
  assert.equal(notifications[0].teamId, "initiator-team");
  assert.match(notifications[0].title, /vandt/i);
});

// ── #1309 kontrakt-on-acquire ────────────────────────────────────────────────

// Kontraktløs vinder (salary == null) → standard-kontrakt oprettes i samme
// rider-update som ejerskabsskiftet (salary fra base_value/bonus, length 2,
// end = aktiv sæson + 1).
test("finalizeAuctionById creates a default contract for a contractless winner (#1309)", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-contract-create",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 100,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-free-contract",
          firstname: "Free",
          lastname: "Contract",
          team_id: "seller-team",
          salary: null, // kontraktløs free agent
          base_value: 1_000_000,
          prize_earnings_bonus: 0,
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500000,
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
        "buyer-team": { riderCount: 6, pendingCount: 0, activeLoanCount: 0 },
      },
      auctionUpdates,
      riderUpdates,
    }),
    auctionId: "auction-contract-create",
    notifyTeamOwner: async () => {},
    now: new Date("2026-06-13T10:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    acquired_at: "2026-06-13T10:00:00.000Z",
    salary: 100_000, // 10% af 1_000_000
    contract_length: 2,
    contract_end_season: 2, // aktiv sæson 1 + 2 - 1
  }]);
});

// Vinder MED eksisterende kontrakt (salary != null) → ejerskab skifter, men
// kontrakten arves UÆNDRET (salary/contract_length/contract_end_season røres ikke).
test("finalizeAuctionById inherits an existing contract unchanged on a won auction (#1309)", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-contract-inherit",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 100,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-has-contract",
          firstname: "Has",
          lastname: "Contract",
          team_id: "seller-team",
          salary: 42_000, // eksisterende kontrakt
          contract_length: 3,
          contract_end_season: 4,
          base_value: 1_000_000,
          prize_earnings_bonus: 0,
        },
      },
      teams: {
        "buyer-team": {
          id: "buyer-team",
          name: "Buyer",
          balance: 500000,
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
        "buyer-team": { riderCount: 6, pendingCount: 0, activeLoanCount: 0 },
      },
      auctionUpdates,
      riderUpdates,
    }),
    auctionId: "auction-contract-inherit",
    notifyTeamOwner: async () => {},
    now: new Date("2026-06-13T11:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  // Kun ejerskabsfelter — INGEN salary/contract_length/contract_end_season i patch.
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    acquired_at: "2026-06-13T11:00:00.000Z",
  }]);
});
