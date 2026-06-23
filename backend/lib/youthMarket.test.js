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
  offeredIntake = false,   // rytteren ligger som 'offered' i et intake-kuld
  activeAuction = false,   // rytteren ligger på en aktiv ungdomsauktion
  insufficientBalance = false, // RPC afviser pga. manglende råd (#1713)
} = {}) {
  const riderUpdates = [];
  const rpcCalls = [];
  const supabase = {
    // #1713: optagelsen koster nu den viste market_value (p_price > 0). RPC'en
    // håndterer betaling + balance-tjek og returnerer { ok:false, code:'insufficient_balance' }
    // hvis holdet ikke har råd. Mocken replikerer cap-check + balance-tjek og
    // syntetiserer en rider-update i _riderUpdates ved succes.
    rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "finalize_academy_acquisition");
      if (academyCount >= 8) {
        return Promise.resolve({ data: { ok: false, code: "academy_full" }, error: null });
      }
      if (insufficientBalance) {
        return Promise.resolve({ data: { ok: false, code: "insufficient_balance" }, error: null });
      }
      riderUpdates.push({
        team_id: args.p_team_id,
        is_academy: true,
        salary: Number(args.p_salary),
        contract_length: args.p_contract_length,
        contract_end_season: args.p_contract_end_season,
        acquired_at: args.p_acquired_at,
        pending_team_id: null,
      });
      return Promise.resolve({ data: { ok: true, balance: 0, academy_count: academyCount + 1 }, error: null });
    },
    from(table) {
      if (table === "riders") {
        return {
          select() {
            const readApi = { eq() { return readApi; }, maybeSingle() { return Promise.resolve({ data: rider, error: null }); } };
            return readApi;
          },
        };
      }
      if (table === "academy_intake") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: offeredIntake ? { id: "intake-1" } : null, error: null }); },
        };
        return api;
      }
      if (table === "auctions") {
        const api = {
          select() { return api; },
          eq() { return api; },
          in() { return api; },
          maybeSingle() { return Promise.resolve({ data: activeAuction ? { id: "auc-1" } : null, error: null }); },
        };
        return api;
      }
      return {};
    },
    _riderUpdates: riderUpdates,
    _rpcCalls: rpcCalls,
  };
  return supabase;
}

const NOW_2026 = new Date("2026-06-20T12:00:00Z");

test("signFreeAgentYouth: signer fri ungdom ind i akademiet (is_academy=true, kontrakt) og betaler den viste market_value", async () => {
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

  // #1713: optagelsen koster den viste pris (= calculateRiderMarketValue).
  // market_value=80000 → value=80000. RPC kaldes med p_price=value og en
  // finance-payload med amount=-value (debit).
  assert.equal(supabase._rpcCalls.length, 1, "præcis ét RPC-kald (atomær cap+betaling+update)");
  assert.equal(supabase._rpcCalls[0].name, "finalize_academy_acquisition");
  assert.equal(supabase._rpcCalls[0].args.p_price, 80000, "p_price = den viste market_value");
  assert.equal(supabase._rpcCalls[0].args.p_finance_payload.type, "academy_signing");
  assert.equal(supabase._rpcCalls[0].args.p_finance_payload.amount, -80000, "finance-payload debiterer den viste pris");
});

test("signFreeAgentYouth: propagerer insufficient_balance fra RPC → insufficient_balance (ingen råd, #1713)", async () => {
  const supabase = makeFreeAgentSupabase({ insufficientBalance: true });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /insufficient_balance/,
  );
  assert.equal(supabase._riderUpdates.length, 0, "ingen optagelse når holdet ikke har råd");
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

test("signFreeAgentYouth: afviser rytter der er 'offered' i et intake-kuld → not_free_agent", async () => {
  const supabase = makeFreeAgentSupabase({ offeredIntake: true });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_free_agent/,
  );
  assert.equal(supabase._riderUpdates.length, 0, "ingen sign når kandidaten tilhører et intake-kuld");
});

test("signFreeAgentYouth: afviser ÆGTE PCM-rytter (pcm_id != null) → not_free_agent (#1478 bug #1)", async () => {
  // En ægte rytter der tilfældigvis er fri agent i akademi-alder må ikke kunne
  // hentes gratis. pcm_id=null er fiktiv-vs-ægte-markøren.
  const supabase = makeFreeAgentSupabase({
    rider: { id: "fa-rider", team_id: null, is_academy: false, pcm_id: 4242, birthdate: "2008-06-15", base_value: 80000, market_value: 80000, prize_earnings_bonus: 0 },
  });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_free_agent/,
  );
  assert.equal(supabase._riderUpdates.length, 0, "ægte rytter må ikke kunne signes gratis");
});

test("signFreeAgentYouth: tillader stadig FIKTIV fri ungdom (pcm_id null) — kontrol-case", async () => {
  const supabase = makeFreeAgentSupabase({
    rider: { id: "fa-rider", team_id: null, is_academy: false, pcm_id: null, birthdate: "2008-06-15", base_value: 80000, market_value: 80000, prize_earnings_bonus: 0 },
  });
  const result = await signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 });
  assert.equal(result.riderId, "fa-rider");
  assert.equal(supabase._riderUpdates.length, 1, "fiktiv fri ungdom kan stadig signes");
});

test("signFreeAgentYouth: afviser rytter på aktiv ungdomsauktion → not_free_agent (ingen auktions-bypass)", async () => {
  const supabase = makeFreeAgentSupabase({ activeAuction: true });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_free_agent/,
  );
  assert.equal(supabase._riderUpdates.length, 0, "auktionen må ikke kunne bypasses via direct-sign");
});

test("signFreeAgentYouth: afviser pensioneret rytter → not_free_agent (forward-guard #1742)", async () => {
  // En pensioneret rytter (is_retired=true) har team_id=NULL + is_academy=false og
  // ville ellers passere free-agent-grundkriterierne. Forward-guard'en sikrer at en
  // pensioneret rytter aldrig kan signes som fri ungdom, selv hvis han skulle slippe
  // gennem discovery-listen.
  const supabase = makeFreeAgentSupabase({
    rider: { id: "fa-rider", team_id: null, is_academy: false, is_retired: true, pcm_id: null, birthdate: "2008-06-15", base_value: 80000, market_value: 80000, prize_earnings_bonus: 0 },
  });
  await assert.rejects(
    () => signFreeAgentYouth(supabase, { teamId: "team-A", riderId: "fa-rider", seasonNumber: 1, now: NOW_2026 }),
    /not_free_agent/,
  );
  assert.equal(supabase._riderUpdates.length, 0, "pensioneret rytter må ikke kunne signes som fri ungdom");
});
