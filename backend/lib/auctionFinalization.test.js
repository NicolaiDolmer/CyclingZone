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
  offerWithdrawals = [],
  swapWithdrawals = [],
  activeStageRaceRiderIds = [], // #1995: ryttere i et aktivt fleretape-løb → defer
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

            // #268/#1308: getTeamMarketState's count-queries chains:
            //   riderCount:   .eq("team_id",X).eq("is_academy",false)
            //   pendingCount: .eq("pending_team_id",X).eq("is_academy",false)
            //   outgoing:     .eq("team_id",X).eq("is_academy",false).not(...).neq(...)
            // Gøres chainbare: .eq() returnerer altid et objekt der kan tage
            // en ekstra .eq() (is_academy-filtret). Korrekt count dispatches efter
            // den samlede kæde.
            return {
              eq(column, value) {
                const counts = teamMarketCounts[value] || {};

                if (column === "team_id") {
                  const teamId = value;
                  // Builder til team_id-grenen — håndterer riderCount + outgoingCount.
                  const teamIdBuilder = {
                    eq(_col, _val) {
                      // Ekstra filter (f.eks. is_academy=false) — ignorer værdien,
                      // returner det SAMME builder-objekt så .not()/.then() stadig virker.
                      return teamIdBuilder;
                    },
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
                  return teamIdBuilder;
                }

                if (column === "pending_team_id") {
                  // Builder til pending_team_id-grenen — håndterer pendingCount.
                  const pendingBuilder = {
                    eq(_col, _val) {
                      // Ekstra filter (f.eks. is_academy=false) — returner sig selv.
                      return pendingBuilder;
                    },
                    then(resolve, reject) {
                      return Promise.resolve({ count: counts.pendingCount || 0, error: null }).then(resolve, reject);
                    },
                  };
                  return pendingBuilder;
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

      // #1748 (a): salg trækker også åbne transfer-/swap-TILBUD tilbage.
      // transfer_offers: update().in("rider_id").in("status").
      if (table === "transfer_offers") {
        return {
          update(payload) {
            return {
              in(riderColumn, riderIds) {
                assert.equal(riderColumn, "rider_id");
                return {
                  in(statusColumn, statuses) {
                    assert.equal(statusColumn, "status");
                    offerWithdrawals.push({ payload, riderIds, statuses });
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      // swap_offers: update().in("status").or(<offered/requested rider filter>).
      if (table === "swap_offers") {
        return {
          update(payload) {
            return {
              in(statusColumn, statuses) {
                assert.equal(statusColumn, "status");
                return {
                  or(filter) {
                    swapWithdrawals.push({ payload, statuses, filter });
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }

      // #1995: getRidersInActiveStageRace → races (aktive stage races) +
      // race_entries (deltagere). Simuleret via activeStageRaceRiderIds-fixturen:
      // ét syntetisk aktivt løb hvis listen er ikke-tom.
      if (table === "races" || table === "race_entries") {
        const rows = table === "races"
          ? (activeStageRaceRiderIds.length ? [{ id: "active-stage-race" }] : [])
          : activeStageRaceRiderIds.map((riderId) => ({ rider_id: riderId }));
        const chain = {
          _rows: rows,
          select: () => chain,
          eq: () => chain,
          neq: () => chain,
          gt: () => chain,
          in: (col, vals) => {
            if (table === "race_entries" && col === "rider_id") {
              chain._rows = chain._rows.filter((r) => vals.includes(r.rider_id));
            }
            return chain;
          },
          then: (resolve, reject) =>
            Promise.resolve({ data: chain._rows, error: null }).then(resolve, reject),
        };
        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// #267: i et åbent transfervindue må køber gå +TRANSFER_WINDOW_SOFT_CAP_BUFFER
// over division-cap. Hard-blokade rammer kun hvis køber allerede er på
// effective cap (#838: alle divisioner max 30 → soft-cap 32). Auctioneer-cron
// og admin-finalize matcher samme regel.
test("finalizeAuctionById blocks a winner whose squad would exceed the hard cap (#16 always-open)", async () => {
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
  assert.match(notifications[0].message, /maks\. have 30 ryttere/);
});

// #267: når transfervinduet er lukket (post-cutoff) er hard-cap igen gældende
// — totalAfter > maxRiders blokker, selv hvis køber er +1 over cap.
test("finalizeAuctionById hard-caps at deal time (#16 always-open, no window grace)", async () => {
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
          riderCount: 29,
          pendingCount: 1,
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
  assert.match(notifications[0].message, /maks\. have 30 ryttere/);
  assert.deepEqual(riderUpdates, []);
});

// #267: køber +1 over hard-cap (D3 har 11) i åbent vindue må gerne vinde
// auktion. Rytteren transfereres til team_id (windowOpen) og finance/audit
// skrives som normalt.
test("finalizeAuctionById allows a winner up to the hard cap + registers immediately (#16 always-open)", async () => {
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
          riderCount: 29, // +1 vinder = 30 = hard-cap (tilladt; ingen vindue-buffer længere)
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
    salary: 148, // fallback 1000 × 0.1481 (buyer-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.equal(financeInserts.length, 2);
  assert.equal(financeInserts[0].team_id, "buyer-team");
  assert.equal(financeInserts[0].amount, -30000);
});

// #1872 forward-guard: en kontraktudløb-notifikation der kaster (fx fordi DB-
// constraint'en mangler typen) må ALDRIG forhindre finaliseringen i at nå
// closeAuction. Tidligere efterlod throw'et — efter at køber var debiteret og
// sælger krediteret — auktionen i en evig cron-retry-loop ("Udløbet" men aldrig
// completed). Guarden skal sluge fejlen og fuldføre handlen.
test("finalizeAuctionById completes even if the contract-expiring notification throws (#1872)", async () => {
  const auctionUpdates = [];
  const teamUpdates = [];
  const riderUpdates = [];
  const financeInserts = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-contract-expiring-throw",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 7575,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-expiring",
          firstname: "Wei",
          lastname: "Luo",
          team_id: "seller-team",
          // Allerede kontraktbundet (salary != null) → contractOnAcquirePatch er
          // en no-op, så contract_end_season=1 arves og rammer activeSeasonNumber
          // (default 1) → #1836-køb-triggeren fyrer.
          salary: 100,
          contract_length: 1,
          contract_end_season: 1,
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
        "buyer-team": { riderCount: 5, pendingCount: 0, activeLoanCount: 0 },
      },
      auctionUpdates,
      teamUpdates,
      riderUpdates,
      financeInserts,
    }),
    auctionId: "auction-contract-expiring-throw",
    notifyTeamOwner: async (teamId, type, title, message, entityId) => {
      if (type === "contract_expiring") {
        // Simulér DB-constraint-violation (den oprindelige #1872-fejl).
        throw new Error("new row for relation \"notifications\" violates check constraint");
      }
      notifications.push({ teamId, type, title, message, entityId });
    },
    now: new Date("2026-06-25T18:10:43.000Z"),
  });

  // Guarden virker: handlen er fuldført trods notifikations-throw.
  assert.equal(result.ok, true);
  assert.equal(result.code, "completed");
  // closeAuction blev nået → auktionen er sat completed (ikke efterladt active).
  const completedUpdate = auctionUpdates.find((u) => u.status === "completed");
  assert.ok(completedUpdate, "auktionen skal lukkes completed trods notify-throw");
  // Begge finansielle posteringer kørte (debit + kredit) — de ligger før guarden.
  assert.equal(financeInserts.length, 2);
  // "Auktion afsluttet"-notifikationen (efter guarden) blev stadig sendt.
  assert.ok(
    notifications.some((n) => n.title === "Auktion afsluttet"),
    "post-guard-notifikationer skal stadig sendes"
  );
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
    salary: 148, // fallback 1000 × 0.1481 (buyer-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -120,
      description: "Købt AI Owner på auktion",
      metadata: { code: "tx.auctionBuy", params: { riderName: "AI Owner" } },
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
      metadata: { code: "tx.auctionSell", params: { riderName: "AI Owner" } },
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
    salary: 148, // fallback 1000 × 0.1481 (buyer-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "buyer-team",
      type: "transfer_out",
      amount: -150,
      description: "Købt Owned Seller på auktion",
      metadata: { code: "tx.auctionBuy", params: { riderName: "Owned Seller" } },
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
      metadata: { code: "tx.auctionSell", params: { riderName: "Owned Seller" } },
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
    salary: 148, // fallback 1000 × 0.1481 (buyer-team division 3)
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
test("finalizeAuctionById closes open transfer listings on finalization (#822)", async () => {
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
  // #16 altid-åben handel: vinderen får rytteren med det samme (team_id), ikke parkeret.
  assert.deepEqual(riderUpdates, [{
    team_id: "buyer-team",
    pending_team_id: null,
    acquired_at: "2026-06-10T11:00:00.000Z",
    salary: 148, // fallback 1000 × 0.1481 (buyer-team division 3)
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
    salary: 303, // fallback 1000 × 0.3029 (bank-team division 1)
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
  // #1483: garanteret AI-salg får struktureret metadata med rytternavn.
  assert.deepEqual(financeInserts[0].metadata, {
    code: "tx.guaranteedAiSale",
    params: { riderName: "Guaranteed Owned" },
  });
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
    salary: 148, // fallback 1000 × 0.1481 (initiator-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "initiator-team",
      type: "transfer_out",
      amount: -120,
      description: "Købt AI SelfBid på auktion",
      metadata: { code: "tx.auctionBuy", params: { riderName: "AI SelfBid" } },
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
      metadata: { code: "tx.auctionSell", params: { riderName: "AI SelfBid" } },
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
    salary: 148, // fallback 1000 × 0.1481 (initiator-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [
    {
      team_id: "initiator-team",
      type: "transfer_out",
      amount: -80,
      description: "Købt Free Agent på auktion",
      metadata: { code: "tx.auctionBuy", params: { riderName: "Free Agent" } },
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
    salary: 148, // fallback 1000 × 0.1481 (initiator-team division 3)
    contract_length: 2,
    contract_end_season: 2,
  }]);
  assert.deepEqual(financeInserts, [{
    team_id: "initiator-team",
    type: "transfer_out",
    amount: -48,
    description: "Købt Legacy Free på auktion",
    metadata: { code: "tx.auctionBuy", params: { riderName: "Legacy Free" } },
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
// rider-update som ejerskabsskiftet (salary fra current_production_value ×
// vinderens divisions-sats, length 2, end = aktiv sæson + 1).
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
          current_production_value: 500_000,
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
    salary: 74_050, // 500_000 × 0.1481 (buyer-team division 3)
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

// ─── #1308 Fase B: ungdomsauktion-finalization ────────────────────────────────
// En youth-auktion (is_youth=true) har INGEN sælger (seller_team_id=NULL) og
// rytteren er fri (team_id=NULL). Vinderen placeres i sit akademi (is_academy=true,
// 8-plads-cap), betaler sit bud som academy_signing (sink, ingen seller-payout).
// #2456 "usolgt = væk": ender auktionen uden optagelse (ingen bud / akademi fuldt /
// ingen råd), slettes rytteren — guarded mod racende bud (atomisk claim) og mod
// race_results-orphans (#1847).

function makeYouthFinalizeSupabase({
  auction,
  buyerBalance = 1_000_000,
  academyCount = 0,
  // #2754: vinderens senior-trup-størrelse (ikke-akademi-ryttere). Bruges KUN når
  // akademiet er fuldt og senior-fallbacken forsøges. Cap er 30 for alle divisioner.
  seniorCount = 0,
  buyerDivision = 3,
  // #2456-testknobs:
  claimRaced = false,      // simulér at et bud lander mellem read og atomisk claim → claim rammer 0 rækker
  riderRaceResults = [],   // race_results-rækker for rytteren (#1847-guard)
  riderNowOwned = false,   // rytteren har imens fået et hold → conditional DELETE rammer 0 rækker
  riderHasExpiredIntake = false, // #2627: rytterens intake-tilbud UDLØB → usolgt beholdes som fri agent
  compensationDuplicate = false, // #2648: simulér cron-retry af en allerede-krediteret auktion (23505)
}) {
  const riderUpdates = [];
  const auctionUpdates = [];
  const financeInserts = [];
  const compensationInserts = [];
  const notifications = [];
  const riderDeleteAttempts = [];
  const riderDeletions = [];

  const buyer = { id: auction.current_bidder_id, name: "Buyer FC", balance: buyerBalance };

  const supabase = {
    // #1558: cap-check + rider-update + debit sker nu atomisk i én RPC. Mocken
    // replikerer plpgsql-semantikken: cap → balance → guarded rider-update →
    // betinget debit, og returnerer JSONB-resultatet.
    rpc(name, params) {
      if (name === "increment_balance_with_audit") {
        // #2754: negativ delta = vinder-debit fra senior-fallbacken (bud-sink,
        // ingen sælger). Positiv delta = #2648-kompensation til den manager hvis
        // intake-tilbud udløb (auction.expired_intake_team_id).
        const delta = Number(params.p_delta);
        if (delta < 0) {
          financeInserts.push({ team_id: params.p_team_id, delta, ...params.p_finance_payload });
          buyer.balance += delta;
          return Promise.resolve({ data: buyer.balance, error: null });
        }
        if (compensationDuplicate) {
          return Promise.resolve({
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          });
        }
        compensationInserts.push({ team_id: params.p_team_id, delta, ...params.p_finance_payload });
        return Promise.resolve({ data: 999999, error: null });
      }
      assert.equal(name, "finalize_academy_acquisition");
      const price = Number(params.p_price);
      if (academyCount >= 8) {
        return Promise.resolve({ data: { ok: false, code: "academy_full" }, error: null });
      }
      if (price > 0 && buyer.balance < price) {
        return Promise.resolve({ data: { ok: false, code: "insufficient_balance" }, error: null });
      }
      // Guarded rider-update (placering).
      riderUpdates.push({
        team_id: params.p_team_id,
        is_academy: true,
        salary: Number(params.p_salary),
        contract_length: params.p_contract_length,
        contract_end_season: params.p_contract_end_season,
        acquired_at: params.p_acquired_at,
        pending_team_id: null,
      });
      // Betinget debit + finance-row.
      if (price > 0) {
        financeInserts.push({ team_id: params.p_team_id, delta: -price, ...params.p_finance_payload });
        buyer.balance -= price;
      }
      return Promise.resolve({ data: { ok: true, balance: buyer.balance, academy_count: academyCount + 1 }, error: null });
    },
    from(table) {
      if (table === "auctions") {
        return {
          select(cols) {
            assert.equal(cols, "*, rider:rider_id(*)");
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: auction, error: null }) }) };
          },
          // Skal understøtte BÅDE closeAuction (.update().eq() awaited direkte) og
          // #2456-claimen (.update().eq().in().is().select() → rækker). Builder'en
          // er derfor thenable OG chainbar, som den ægte supabase-builder.
          update(payload) {
            const api = {
              eq() { return api; },
              in() { return api; },
              is() { return api; },
              select() {
                auctionUpdates.push({ ...payload, _conditionalClaim: true });
                return Promise.resolve({ data: claimRaced ? [] : [{ id: auction.id }], error: null });
              },
              then(resolve, reject) {
                auctionUpdates.push(payload);
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return api;
          },
        };
      }
      if (table === "race_results") {
        return {
          select: () => ({
            eq: () => ({ limit: () => Promise.resolve({ data: riderRaceResults, error: null }) }),
          }),
        };
      }
      if (table === "academy_intake") {
        // #2627: deleteUnsoldYouthRider tjekker om rytteren har et UDLØBET
        // intake-tilbud (status='expired') — i så fald beholdes han som fri agent.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({
                  data: riderHasExpiredIntake ? [{ id: "intake-expired-row" }] : [],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "riders") {
        return {
          // #2754: getTeamMarketState's count-queries til senior-fallbacken.
          //   riderCount:   .eq("team_id",X).eq("is_academy",false)  → seniorCount
          //   pendingCount: .eq("pending_team_id",X).eq("is_academy",false) → 0
          //   outgoing:     .eq("team_id",X).eq("is_academy",false).not(...).neq(...) → 0
          select(cols, options) {
            assert.equal(cols, "id");
            assert.deepEqual(options, { count: "exact", head: true });
            return {
              eq(column, _value) {
                if (column === "team_id") {
                  const b = {
                    eq() { return b; },
                    not() {
                      return { neq: () => Promise.resolve({ count: 0, error: null }) };
                    },
                    then(resolve, reject) {
                      return Promise.resolve({ count: seniorCount, error: null }).then(resolve, reject);
                    },
                  };
                  return b;
                }
                if (column === "pending_team_id") {
                  const b = {
                    eq() { return b; },
                    then(resolve, reject) {
                      return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
                    },
                  };
                  return b;
                }
                throw new Error(`Unexpected riders count column: ${column}`);
              },
            };
          },
          // #2754: senior-placeringen (expectMutation på .update().eq()).
          update(payload) {
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, auction.rider.id);
                riderUpdates.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
          delete() {
            const api = {
              eq() { return api; },
              is() { return api; },
              select() {
                riderDeleteAttempts.push(auction.rider.id);
                if (riderNowOwned) {
                  // Conditional DELETE (team_id IS NULL ...) rammer 0 rækker.
                  return Promise.resolve({ data: [], error: null });
                }
                riderDeletions.push(auction.rider.id);
                return Promise.resolve({ data: [{ id: auction.rider.id }], error: null });
              },
            };
            return api;
          },
        };
      }
      if (table === "seasons") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: "season-1", number: 1 }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "transfer_listings") {
        return { update: () => ({ in: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
      }
      if (table === "rider_watchlist") {
        // #2524: deleteUnsoldYouthRider kalder notifyAndClearWatchlistForRiders
        // efter en bekræftet sletning — ingen af disse fixtures har ønskeliste-
        // rækker for youth-rytteren, så et tomt svar er nok.
        return {
          select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
          delete: () => ({ in: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      }
      if (table === "teams") {
        // #2594: finalizeYouthAuctionRecord slår vinderens division op for at
        // prissætte akademi-lønnen (per-division sats) via .maybeSingle().
        // #2754: getTeamMarketState (senior-fallback) læser balance/division via
        // expectSingle → .single(). Begge understøttes på samme eq()-resultat.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: buyer.id, division: buyerDivision }, error: null }),
              single: () => Promise.resolve({
                data: { id: buyer.id, name: "Buyer FC", balance: buyer.balance, division: buyerDivision, user_id: "user-1" },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    _riderUpdates: riderUpdates,
    _auctionUpdates: auctionUpdates,
    _financeInserts: financeInserts,
    _compensationInserts: compensationInserts,
    _notifications: notifications,
    _riderDeleteAttempts: riderDeleteAttempts,
    _riderDeletions: riderDeletions,
  };
  return supabase;
}

const YOUTH_RIDER = {
  id: "youth-rider",
  firstname: "Tadej",
  lastname: "Ungdom",
  base_value: 100000,
  market_value: 100000,
  prize_earnings_bonus: 0,
  team_id: null,
};

test("youth-auktion MED bud + plads + balance: vinder får rytteren i akademiet (is_academy=true, kontrakt), betaler academy_signing, ingen seller-payout", async () => {
  const auction = {
    id: "youth-auc-1",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 0 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "youth_completed");

  // Rytter placeret i akademiet med kontrakt
  assert.equal(supabase._riderUpdates.length, 1, "præcis én rider-update (placering)");
  const upd = supabase._riderUpdates[0];
  assert.equal(upd.is_academy, true);
  assert.equal(upd.team_id, "buyer-team");
  assert.equal(upd.pending_team_id, null, "akademiryttere bypasser transfervindue-pending");
  assert.equal(upd.contract_length, 3);
  assert.equal(upd.contract_end_season, 3, "1 + 3 - 1");
  assert.ok(typeof upd.salary === "number" && upd.salary >= 1);
  assert.ok(upd.acquired_at, "acquired_at sat");

  // Finance: vinder debiteret academy_signing = -bud, INGEN seller-credit
  assert.equal(supabase._financeInserts.length, 1, "kun vinder-debit, ingen seller-payout");
  const fin = supabase._financeInserts[0];
  assert.equal(fin.team_id, "buyer-team");
  assert.equal(fin.type, "academy_signing");
  assert.equal(fin.delta, -25000, "betaler sit bud");
  assert.ok(fin.idempotency_key, "idempotency_key sat (cron-sikkerhed)");
  // #1483: struktureret metadata med rytternavn til Historik-fanen.
  assert.deepEqual(fin.metadata, {
    code: "tx.youthAuctionWin",
    params: { riderName: "Tadej Ungdom" },
  });

  // Auktion lukket completed
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "completed"));
});

test("youth-auktion MED bud, akademi fyldt (8) MEN senior har plads: placeres på senior (is_academy=false, senior-kontrakt), betaler bud, IKKE annulleret (#2754)", async () => {
  const auction = {
    id: "youth-auc-2b",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  // Akademi fuldt (8) men senior har rigelig plads (20/30) + råd.
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 8, seniorCount: 20 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "youth_completed_senior");
  assert.equal(result.senior, true);

  // Rytter placeret på SENIOR (is_academy=false), ikke slettet.
  assert.equal(supabase._riderUpdates.length, 1, "præcis én rider-update (senior-placering)");
  const upd = supabase._riderUpdates[0];
  assert.equal(upd.is_academy, false, "placeret på senior, ikke akademi");
  assert.equal(upd.team_id, "buyer-team");
  assert.equal(upd.pending_team_id, null);
  assert.ok(upd.acquired_at, "acquired_at sat");
  assert.equal(supabase._riderDeletions.length, 0, "rytteren slettes IKKE når han placeres");

  // Finance: vinder debiteret sit bud (sink, ingen seller-payout).
  assert.equal(supabase._financeInserts.length, 1, "kun vinder-debit");
  const fin = supabase._financeInserts[0];
  assert.equal(fin.team_id, "buyer-team");
  assert.equal(fin.delta, -25000, "betaler sit bud");
  assert.equal(fin.idempotency_key, `youth_auction_winner:${auction.id}`, "samme nøgle som akademi-vinder → cron-retry-sikker");

  // Auktion lukket completed (IKKE cancelled).
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "completed"));
  assert.ok(!supabase._auctionUpdates.some((u) => u.status === "cancelled"), "ingen annullering");
});

test("youth-auktion MED bud men akademi (8) OG senior (30) fyldt: annulleres + slettes (#2456-backstop bevaret)", async () => {
  const auction = {
    id: "youth-auc-2",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  // Både akademi (8) og senior (30) fyldt → ingen plads nogen steder.
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 8, seniorCount: 30 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "academy_full");
  assert.equal(result.senior_reason, "squad_full");
  assert.equal(supabase._riderUpdates.length, 0, "ingen placering når alt er fyldt");
  assert.equal(supabase._financeInserts.length, 0, "ingen debit når alt er fyldt");
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "cancelled"));
  // #2456: rytteren blev ikke optaget → han slettes (ingen fri-liste at falde på).
  assert.equal(result.rider_deleted, true);
  assert.deepEqual(supabase._riderDeletions, ["youth-rider"], "usolgt rytter slettet");
});

test("youth-auktion MED bud, akademi fyldt (8), senior har plads men vinderen har ikke råd: annulleres + slettes", async () => {
  const auction = {
    id: "youth-auc-2c",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  // Senior har plads (10/30) men balance < bud → kan ikke placeres.
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 1000, academyCount: 8, seniorCount: 10 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "academy_full");
  assert.equal(result.senior_reason, "insufficient_balance");
  assert.equal(supabase._riderUpdates.length, 0, "ingen placering uden råd");
  assert.equal(supabase._financeInserts.length, 0, "ingen debit uden råd");
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "cancelled"));
  assert.equal(result.rider_deleted, true);
});

test("youth-auktion MED bud men utilstrækkelig balance: annulleres, ingen placering, ingen debit", async () => {
  const auction = {
    id: "youth-auc-3",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 100, academyCount: 0 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "cancelled_insufficient_balance");
  assert.equal(supabase._riderUpdates.length, 0);
  assert.equal(supabase._financeInserts.length, 0);
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "cancelled"));
  // #2456: rytteren blev ikke optaget → han slettes.
  assert.equal(result.rider_deleted, true);
  assert.deepEqual(supabase._riderDeletions, ["youth-rider"], "usolgt rytter slettet");
});

test("youth-auktion UDEN bud (#2456): auktionen claimes atomisk (completed) og rytteren SLETTES, ingen debit", async () => {
  const auction = {
    id: "youth-auc-4",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null,
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 0, academyCount: 0 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_no_bids");
  assert.equal(result.rider_deleted, true, "usolgt = væk: rytteren slettes");
  assert.equal(supabase._riderUpdates.length, 0, "ingen ejerskabsændring");
  assert.equal(supabase._financeInserts.length, 0, "ingen debit uden bud");
  // Lukningen skete via den ATOMISKE conditional claim (status-check + ingen
  // byder i selve UPDATE'en), ikke en ubetinget closeAuction.
  const claim = supabase._auctionUpdates.find((u) => u._conditionalClaim);
  assert.ok(claim, "auktionen lukket via conditional claim");
  assert.equal(claim.status, "completed");
  assert.deepEqual(supabase._riderDeletions, ["youth-rider"], "rytteren slettet");
});

test("youth-auktion UDEN bud men UDLØBET intake (#2627): rytteren beholdes som fri agent, slettes IKKE", async () => {
  const auction = {
    id: "youth-auc-expired-1",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null,
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({
    auction, buyerBalance: 0, academyCount: 0, riderHasExpiredIntake: true,
  });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_no_bids");
  // Ejer-beslutning 18/7: udløbne intake-ryttere forlader ALDRIG spillet ved
  // usolgt auktion — de forbliver frie agenter (team_id=null, is_academy=false)
  // og kan hentes igen (fri-agent-filter + enhver manager kan auktionere dem).
  assert.equal(result.rider_deleted, false, "udløbet intake-rytter må IKKE slettes");
  assert.equal(supabase._riderDeleteAttempts.length, 0, "ingen delete må overhovedet forsøges");
  assert.deepEqual(supabase._riderDeletions, []);
});

test("youth-auktion UDEN bud men RACENDE bud (#2456 TOCTOU): claim rammer 0 rækker → rytteren røres IKKE, buddet vinder", async () => {
  // Et bud landede mellem finalizerens read (current_bidder_id=null) og den
  // atomiske claim. Claimen rammer 0 rækker → ingen sletning, auktionen står
  // stadig active med byderen, og næste finalize-pass gennemfører den med
  // vinderen. Buddet vinder altid over sletningen.
  const auction = {
    id: "youth-auc-5",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null, // finalizerens (forældede) read
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, claimRaced: true });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "youth_bid_raced");
  assert.equal(supabase._riderDeleteAttempts.length, 0, "INGEN delete forsøgt når claimen tabte");
  assert.equal(supabase._riderDeletions.length, 0, "rytteren består — buddet vandt");
  assert.equal(supabase._financeInserts.length, 0, "ingen debit i dette pass");
});

test("youth-auktion UDEN bud men rytteren har race_results (#1847-guard): beholdes, ingen sletning", async () => {
  const auction = {
    id: "youth-auc-6",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null,
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({
    auction,
    riderRaceResults: [{ id: "result-1" }],
  });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_no_bids");
  assert.equal(result.rider_deleted, false, "rytter med resultater beholdes (ingen nye orphans)");
  assert.equal(supabase._riderDeleteAttempts.length, 0, "DELETE aldrig forsøgt når resultater findes");
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "completed"), "auktionen lukkes stadig");
});

test("youth-auktion UDEN bud men rytteren fik imens et hold (#2456 guard 3): conditional DELETE rammer 0 rækker", async () => {
  // Parallel sti (fx cron-retry af en anden auktion) nåede at optage rytteren
  // efter claimen. DELETE'ens egne betingelser (team_id IS NULL, is_academy=false)
  // rammer 0 rækker → rytteren bevares.
  const auction = {
    id: "youth-auc-7",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null,
    current_price: 25000,
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, riderNowOwned: true });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_no_bids");
  assert.equal(result.rider_deleted, false, "ejet rytter må aldrig slettes");
  assert.equal(supabase._riderDeleteAttempts.length, 1, "DELETE forsøgt (betinget)");
  assert.equal(supabase._riderDeletions.length, 0, "0 rækker ramt — rytteren bevaret");
});

// ── #2648 (intake-udløb v2, ejer-beslutning 18/7): provenu til den mistende
// manager. auction.expired_intake_team_id sættes KUN af academyIntakeExpirySweep
// for ejerskabs-verificerede kandidater (#2646-guarden) — se youthMarket.js.

test("intake-udløbs-auktion MED salg (#2648): salgssummen krediteres den manager hvis intake-tilbud udløb + notifikation", async () => {
  const auction = {
    id: "youth-auc-comp-1",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 30000,
    expired_intake_team_id: "losing-team",
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 0 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "youth_completed");

  assert.equal(supabase._compensationInserts.length, 1, "præcis én kompensations-kreditering");
  const comp = supabase._compensationInserts[0];
  assert.equal(comp.team_id, "losing-team", "krediteres DEN manager hvis intake-tilbud udløb, ikke køberen");
  assert.equal(comp.delta, 30000, "hele salgssummen (bud-prisen), ikke en andel");
  assert.equal(comp.type, "transfer_in");
  assert.equal(comp.reason_code, "intake_expiry_auction_compensation");
  assert.equal(comp.related_entity_type, "auction");
  assert.equal(comp.related_entity_id, auction.id);
  assert.equal(comp.idempotency_key, `intake_expiry_compensation:${auction.id}`, "cron-retry-sikker");
  assert.deepEqual(comp.metadata, {
    code: "tx.intakeExpiryCompensation",
    params: { riderName: "Tadej Ungdom" },
  });

  // Notifikation til DEN manager (ikke køberen), EN-first + i18n-koder til DA.
  const compNotif = supabase._notifications.find((n) => n[0] === "losing-team");
  assert.ok(compNotif, "den mistende manager notificeres");
  assert.equal(compNotif[1], "academy_intake_expired_compensation");
  assert.match(compNotif[3], /Tadej Ungdom/);
  assert.match(compNotif[3], /30000/);
  assert.equal(compNotif[4], auction.id);
  assert.equal(compNotif[5].titleCode, "notif.intakeExpiryCompensation.title");
  assert.equal(compNotif[5].messageCode, "notif.intakeExpiryCompensation.message");
  assert.deepEqual(compNotif[5].messageParams, { rider: "Tadej Ungdom", amount: 30000 });

  // Auktionen lukkes stadig completed, og køberens academy_signing-debit er uændret.
  assert.ok(supabase._auctionUpdates.some((u) => u.status === "completed"));
  assert.equal(supabase._financeInserts.length, 1, "køberens debit uændret ved siden af kompensationen");
  assert.equal(supabase._financeInserts[0].team_id, "buyer-team");
});

test("almindelig ungdomsauktion UDEN expired_intake_team_id (#2648): INGEN kreditering — manager-afvist kandidat er ikke udløb", async () => {
  const auction = {
    id: "youth-auc-comp-2",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 30000,
    // expired_intake_team_id UNDEFINED — almindelig rejectAcademyCandidate-flow.
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_completed");
  assert.equal(supabase._compensationInserts.length, 0, "ingen kreditering uden verificeret intake-udløbs-herkomst");
  assert.equal(
    supabase._notifications.some((n) => n[1] === "academy_intake_expired_compensation"),
    false,
    "ingen kompensations-notifikation"
  );
});

test("intake-udløbs-auktion UDEN bud (#2648): rytteren bliver fri agent som i dag — INGEN kreditering, ingen bud at kreditere", async () => {
  const auction = {
    id: "youth-auc-comp-3",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: null,
    current_price: 25000,
    expired_intake_team_id: "losing-team",
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({
    auction, buyerBalance: 0, academyCount: 0, riderHasExpiredIntake: true,
  });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_no_bids");
  assert.equal(result.rider_deleted, false, "udløbet intake-rytter forbliver fri agent (#2627)");
  assert.equal(supabase._compensationInserts.length, 0, "usolgt = ingen provenu at kreditere");
});

test("intake-udløbs-auktion MED salg men akademi OG senior fyldt (#2648/#2754): annulleret salg krediterer IKKE — ingen reelt salg gennemført", async () => {
  const auction = {
    id: "youth-auc-comp-4",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 30000,
    expired_intake_team_id: "losing-team",
    rider: { ...YOUTH_RIDER },
  };
  // #2754: akademi (8) OG senior (30) fyldt → auktionen annulleres reelt → ingen
  // kompensation (kompensation følger et gennemført salg, ikke en annullering).
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 8, seniorCount: 30 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "academy_full");
  assert.equal(supabase._compensationInserts.length, 0, "annulleret salg (ingen plads) krediterer aldrig");
});

test("intake-udløbs-auktion MED salg, akademi fyldt men senior har plads (#2648/#2754): senior-salg → kompensation krediteres den tabende manager", async () => {
  const auction = {
    id: "youth-auc-comp-4b",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 30000,
    expired_intake_team_id: "losing-team",
    rider: { ...YOUTH_RIDER },
  };
  // Akademi fuldt (8) men senior har plads (5/30) → reelt salg via senior →
  // kompensationen skal følge med (afhænger af salget, ikke af placeringen).
  const supabase = makeYouthFinalizeSupabase({ auction, buyerBalance: 500000, academyCount: 8, seniorCount: 5 });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_completed_senior");
  assert.equal(supabase._compensationInserts.length, 1, "gennemført senior-salg krediterer den tabende manager");
  assert.equal(supabase._compensationInserts[0].team_id, "losing-team");
  assert.equal(supabase._compensationInserts[0].delta, 30000);
});

test("intake-udløbs-auktion (#2648): cron-retry af allerede-krediteret auktion no-op'er (23505), ingen dobbelt-notifikation", async () => {
  const auction = {
    id: "youth-auc-comp-5",
    status: "active",
    is_youth: true,
    seller_team_id: null,
    current_bidder_id: "buyer-team",
    current_price: 30000,
    expired_intake_team_id: "losing-team",
    rider: { ...YOUTH_RIDER },
  };
  const supabase = makeYouthFinalizeSupabase({
    auction, buyerBalance: 500000, compensationDuplicate: true,
  });
  const result = await finalizeAuctionById({
    supabase,
    notifyTeamOwner: async (...args) => supabase._notifications.push(args),
    now: new Date("2026-06-20T12:00:00Z"),
  });

  assert.equal(result.code, "youth_completed", "finalisering fortsætter (idempotent skip, ikke fejl)");
  assert.equal(
    supabase._notifications.some((n) => n[1] === "academy_intake_expired_compensation"),
    false,
    "allerede krediteret i et tidligere pass → ingen ny notifikation ved retry"
  );
});

// ── #1995: rytter i AKTIVT fleretape-løb → auktions-vinderen får pending_team_id ──
test("finalizeAuctionById parkerer holdskiftet når rytteren er i et aktivt etapeløb (#1995)", async () => {
  const auctionUpdates = [];
  const riderUpdates = [];
  const notifications = [];

  const result = await finalizeAuctionById({
    supabase: createFinalizeAuctionSupabase({
      auction: {
        id: "auction-defer",
        status: "active",
        current_bidder_id: "buyer-team",
        current_price: 100,
        seller_team_id: "seller-team",
        rider: {
          id: "rider-in-race",
          firstname: "Mid",
          lastname: "Race",
          team_id: "seller-team",
          salary: 42_000,
          contract_length: 3,
          contract_end_season: 4,
          base_value: 1_000_000,
          prize_earnings_bonus: 0,
        },
      },
      teams: {
        "buyer-team": { id: "buyer-team", name: "Buyer", balance: 500000, division: 3, user_id: "user-buyer" },
        "seller-team": { id: "seller-team", name: "Seller", balance: 250, division: 3, user_id: "user-seller", is_ai: false },
      },
      teamMarketCounts: {
        "buyer-team": { riderCount: 6, pendingCount: 0, activeLoanCount: 0 },
      },
      auctionUpdates,
      riderUpdates,
      activeStageRaceRiderIds: ["rider-in-race"],
    }),
    auctionId: "auction-defer",
    notifyTeamOwner: async (teamId, type, title, message) => { notifications.push({ teamId, type, title, message }); },
    now: new Date("2026-07-03T11:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "completed", "auktionen fuldføres straks (Model B)");
  // Holdskiftet er parkeret: pending_team_id, IKKE team_id/acquired_at.
  assert.deepEqual(riderUpdates, [{ pending_team_id: "buyer-team" }]);
  // Vinder-beskeden forklarer at rytteren ankommer efter løbet.
  const won = notifications.find((n) => n.type === "auction_won" && n.teamId === "buyer-team");
  assert.match(won.message, /etapeløb/);
});
