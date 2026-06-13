import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { listRejectedAsYouthAuction, signFreeAgentYouth, YOUTH_AUCTION_START_RATE } from "./youthMarket.js";

// ─── Mock-supabase ────────────────────────────────────────────────────────────

/**
 * Minimal mock for youthMarket: riders-lookup + auctions-insert.
 */
function makeYouthMarketSupabase({
  rider = {
    id: "rider-Y",
    firstname: "Yann",
    lastname: "Ungdom",
    base_value: 100000,
    market_value: 100000,
    prize_earnings_bonus: 0,
    team_id: null,
  },
  riderMissing = false,
  insertError = null,
} = {}) {
  const auctionInserts = [];

  const supabase = {
    from(table) {
      if (table === "riders") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() {
            return Promise.resolve({ data: riderMissing ? null : rider, error: null });
          },
        };
        return api;
      }

      if (table === "auctions") {
        return {
          insert(row) {
            auctionInserts.push(row);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: insertError ? null : { id: "youth-auction-1", ...row },
                      error: insertError,
                    });
                  },
                };
              },
            };
          },
        };
      }

      return {};
    },
    _auctionInserts: auctionInserts,
  };

  return supabase;
}

// ─── listRejectedAsYouthAuction ───────────────────────────────────────────────

test("listRejectedAsYouthAuction: opretter is_youth-auktion uden sælger, lav startpris, ingen bidder", async () => {
  const supabase = makeYouthMarketSupabase();
  const auction = await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });

  assert.equal(supabase._auctionInserts.length, 1, "præcis én auktion oprettet");
  const ins = supabase._auctionInserts[0];
  assert.equal(ins.rider_id, "rider-Y");
  assert.equal(ins.seller_team_id, null, "ingen sælger (klubben afviste)");
  assert.equal(ins.is_youth, true, "markeret som ungdomsauktion");
  assert.equal(ins.current_bidder_id, null, "ingen initial bidder");
  assert.ok(ins.starting_price >= 1, "startpris >= 1");
  assert.equal(ins.starting_price, ins.current_price, "current = starting ved oprettelse");
  assert.ok(ins.calculated_end, "calculated_end sat");

  assert.equal(auction.id, "youth-auction-1");
});

test("listRejectedAsYouthAuction: startpris = lav andel af markedsværdi (YOUTH_AUCTION_START_RATE)", async () => {
  const supabase = makeYouthMarketSupabase({
    rider: { id: "rider-Y", firstname: "A", lastname: "B", base_value: 200000, market_value: 200000, prize_earnings_bonus: 0, team_id: null },
  });
  await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });
  const ins = supabase._auctionInserts[0];
  assert.equal(ins.starting_price, Math.round(200000 * YOUTH_AUCTION_START_RATE));
  assert.ok(YOUTH_AUCTION_START_RATE < 1, "startpris-rate er lav (< 1)");
});

test("listRejectedAsYouthAuction: kaster når rytter mangler", async () => {
  const supabase = makeYouthMarketSupabase({ riderMissing: true });
  await assert.rejects(
    () => listRejectedAsYouthAuction(supabase, { riderId: "ghost", auctionConfig: DEFAULT_AUCTION_CONFIG }),
    /not found/,
  );
});

test("listRejectedAsYouthAuction: kaster når riderId mangler", async () => {
  const supabase = makeYouthMarketSupabase();
  await assert.rejects(
    () => listRejectedAsYouthAuction(supabase, { auctionConfig: DEFAULT_AUCTION_CONFIG }),
    /riderId required/,
  );
});

// ─── signFreeAgentYouth (Task 13) ─────────────────────────────────────────────

function makeFreeAgentSupabase({
  rider = {
    id: "fa-rider",
    team_id: null,
    is_academy: false,
    birthdate: "2008-06-15", // 18 ved 2026
    base_value: 80000,
    market_value: 80000,
    prize_earnings_bonus: 0,
  },
  academyCount = 0,
} = {}) {
  const riderUpdates = [];
  const rpcCalls = [];
  const supabase = {
    rpc(name, args) { rpcCalls.push({ name, args }); return Promise.resolve({ data: 0, error: null }); },
    from(table) {
      if (table === "riders") {
        return {
          select(_cols, opts) {
            if (opts?.count === "exact" && opts?.head === true) {
              const api = { eq() { return api; }, then(res) { return Promise.resolve({ count: academyCount, error: null }).then(res); } };
              return api;
            }
            const readApi = { eq() { return readApi; }, maybeSingle() { return Promise.resolve({ data: rider, error: null }); } };
            return readApi;
          },
          update(payload) {
            return { eq() { riderUpdates.push(payload); return Promise.resolve({ error: null }); } };
          },
        };
      }
      return {};
    },
    _riderUpdates: riderUpdates,
    _rpcCalls: rpcCalls,
  };
  return supabase;
}

const NOW_2026 = new Date("2026-06-20T12:00:00Z");

test("signFreeAgentYouth: signer fri ungdom til minimumsløn ind i akademiet (is_academy=true, kontrakt), ingen signing-fee", async () => {
  const supabase = makeFreeAgentSupabase({ academyCount: 0 });
  const result = await signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 });

  assert.equal(result.riderId, "fa-rider");
  assert.ok(result.salary >= 1, "minimumsløn >= 1");
  assert.equal(result.contractEndSeason, 3);

  assert.equal(supabase._riderUpdates.length, 1);
  const upd = supabase._riderUpdates[0];
  assert.equal(upd.is_academy, true);
  assert.equal(upd.team_id, "team-A");
  assert.equal(upd.contract_length, 3);
  assert.equal(upd.contract_end_season, 3);
  assert.ok(upd.salary >= 1);

  // Ingen finance-fee ved free-agent-sign (kun løbende løn)
  assert.equal(supabase._rpcCalls.length, 0, "ingen signing-fee-debit");
});

test("signFreeAgentYouth: afviser ikke-free-agent (team_id sat) → not_free_agent", async () => {
  const supabase = makeFreeAgentSupabase({
    rider: { id: "fa-rider", team_id: "team-Z", is_academy: false, birthdate: "2008-06-15", base_value: 80000, market_value: 80000, prize_earnings_bonus: 0 },
  });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_free_agent/,
  );
  assert.equal(supabase._riderUpdates.length, 0);
});

test("signFreeAgentYouth: afviser rytter uden for akademi-alder (22) → not_academy_age", async () => {
  const supabase = makeFreeAgentSupabase({
    rider: { id: "fa-rider", team_id: null, is_academy: false, birthdate: "2004-06-15", base_value: 80000, market_value: 80000, prize_earnings_bonus: 0 },
  });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_academy_age/,
  );
  assert.equal(supabase._riderUpdates.length, 0);
});

test("signFreeAgentYouth: afviser når akademi fyldt (8) → academy_full", async () => {
  const supabase = makeFreeAgentSupabase({ academyCount: 8 });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /academy_full/,
  );
  assert.equal(supabase._riderUpdates.length, 0);
});
