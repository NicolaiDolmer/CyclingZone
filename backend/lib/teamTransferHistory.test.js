// Tests for #25: per-team transfer history.
// Verificerer at:
//   - alle 4 transfer-kilder samles korrekt
//   - direction (in/out/swap) bestemmes ud fra holdets rolle
//   - private statuses (pending/rejected/etc) ALDRIG vises (genbruger #105-kontrakt)
//   - events sorteres kronologisk (nyeste først)
//   - season_number udledes fra dato vs seasons.start_date/end_date
//   - AI-hold-handler er inkluderet (issue #25 acceptkriterium)

import test from "node:test";
import assert from "node:assert/strict";

const { buildTeamTransferHistory } = await import("./teamTransferHistory.js");

const TEAM = "team-target";
const OTHER = "team-other";
const AI_TEAM = "team-ai";
const RIDER = "rider-A";
const RIDER_B = "rider-B";

function createSupabase({
  auctions = [], transferOffers = [], swapOffers = [], loanAgreements = [], seasons = [],
} = {}) {
  const tableData = {
    auctions, transfer_offers: transferOffers, swap_offers: swapOffers,
    loan_agreements: loanAgreements, seasons,
  };

  function matchOr(expr, row) {
    // Minimal parser for `col.eq.val,col2.eq.val2` (top-level OR)
    const parts = expr.split(",");
    return parts.some((p) => {
      const m = p.match(/^([a-z_]+)\.eq\.(.+)$/);
      if (!m) return false;
      return row[m[1]] === m[2];
    });
  }

  function buildQuery(table) {
    const filters = { or: null, in: null, eq: [] };
    const chain = {
      select() { return chain; },
      or(expr) { filters.or = expr; return chain; },
      in(column, values) { filters.in = { column, values }; return chain; },
      eq(column, value) { filters.eq.push({ column, value }); return chain; },
      order() {
        const rows = (tableData[table] || []).filter((row) => {
          if (filters.in && !filters.in.values.includes(row[filters.in.column])) return false;
          for (const { column, value } of filters.eq) if (row[column] !== value) return false;
          if (filters.or && !matchOr(filters.or, row)) return false;
          return true;
        });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  return { from(table) { return buildQuery(table); } };
}

function auctionRow({ id, seller, winner, price, date, sellerIsAi = false, winnerIsAi = false }) {
  return {
    id, status: "completed", current_price: price,
    actual_end: date, created_at: date,
    is_guaranteed_sale: false,
    seller_team_id: seller, current_bidder_id: winner,
    seller: { id: seller, name: `Team ${seller}`, is_ai: sellerIsAi },
    winner: { id: winner, name: `Team ${winner}`, is_ai: winnerIsAi },
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

function offerRow({ id, seller, buyer, amount, date, status = "accepted" }) {
  return {
    id, status, offer_amount: amount, counter_amount: null, updated_at: date,
    seller_team_id: seller, buyer_team_id: buyer,
    seller: { id: seller, name: `Team ${seller}`, is_ai: false },
    buyer: { id: buyer, name: `Team ${buyer}`, is_ai: false },
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

function swapRow({ id, proposing, receiving, cash = 0, date, status = "accepted" }) {
  return {
    id, status, cash_adjustment: cash, counter_cash: null, updated_at: date,
    proposing_team_id: proposing, receiving_team_id: receiving,
    proposing: { id: proposing, name: `Team ${proposing}`, is_ai: false },
    receiving: { id: receiving, name: `Team ${receiving}`, is_ai: false },
    offered_rider: { id: RIDER, firstname: "A", lastname: "Rider" },
    requested_rider: { id: RIDER_B, firstname: "B", lastname: "Rider" },
  };
}

function loanRow({ id, from, to, fee = 30000, status = "active", date }) {
  return {
    id, status, loan_fee: fee, start_season: 1, end_season: 1,
    created_at: date, updated_at: date,
    from_team_id: from, to_team_id: to,
    from_team: { id: from, name: `Team ${from}`, is_ai: false },
    to_team: { id: to, name: `Team ${to}`, is_ai: false },
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

test("teamTransferHistory — samler events fra alle 4 kilder", async () => {
  const supabase = createSupabase({
    auctions: [auctionRow({ id: "A1", seller: OTHER, winner: TEAM, price: 50000, date: "2026-05-01T00:00:00Z" })],
    transferOffers: [offerRow({ id: "T1", seller: TEAM, buyer: OTHER, amount: 30000, date: "2026-05-02T00:00:00Z" })],
    swapOffers: [swapRow({ id: "S1", proposing: TEAM, receiving: OTHER, cash: 0, date: "2026-05-03T00:00:00Z" })],
    loanAgreements: [loanRow({ id: "L1", from: TEAM, to: OTHER, date: "2026-05-04T00:00:00Z" })],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events.length, 4);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ["auction", "loan", "swap", "transfer"]);
});

test("teamTransferHistory — direction afspejler holdets rolle", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-buy", seller: OTHER, winner: TEAM, price: 50000, date: "2026-05-01T00:00:00Z" }),
      auctionRow({ id: "A-sell", seller: TEAM, winner: OTHER, price: 40000, date: "2026-05-02T00:00:00Z" }),
    ],
    transferOffers: [
      offerRow({ id: "T-buy", seller: OTHER, buyer: TEAM, amount: 30000, date: "2026-05-03T00:00:00Z" }),
      offerRow({ id: "T-sell", seller: TEAM, buyer: OTHER, amount: 35000, date: "2026-05-04T00:00:00Z" }),
    ],
    loanAgreements: [
      loanRow({ id: "L-out", from: TEAM, to: OTHER, date: "2026-05-05T00:00:00Z" }),
      loanRow({ id: "L-in", from: OTHER, to: TEAM, date: "2026-05-06T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-buy"].direction, "in");
  assert.equal(byId["auction:A-sell"].direction, "out");
  assert.equal(byId["transfer:T-buy"].direction, "in");
  assert.equal(byId["transfer:T-sell"].direction, "out");
  assert.equal(byId["loan:L-out"].direction, "out");
  assert.equal(byId["loan:L-in"].direction, "in");
});

test("teamTransferHistory — swap uden cash får direction='swap'", async () => {
  const supabase = createSupabase({
    swapOffers: [
      swapRow({ id: "S-even", proposing: TEAM, receiving: OTHER, cash: 0, date: "2026-05-01T00:00:00Z" }),
      swapRow({ id: "S-paid", proposing: TEAM, receiving: OTHER, cash: 5000, date: "2026-05-02T00:00:00Z" }),
      swapRow({ id: "S-received", proposing: TEAM, receiving: OTHER, cash: -3000, date: "2026-05-03T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["swap:S-even"].direction, "swap");
  assert.equal(byId["swap:S-paid"].direction, "out");  // TEAM proposing + cash>0 → TEAM betalte
  assert.equal(byId["swap:S-received"].direction, "in");
  assert.equal(byId["swap:S-paid"].amount, 5000);
  assert.equal(byId["swap:S-received"].amount, 3000);
});

test("teamTransferHistory — events sorteres nyeste først", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-old", seller: OTHER, winner: TEAM, price: 1000, date: "2026-04-01T00:00:00Z" }),
      auctionRow({ id: "A-new", seller: OTHER, winner: TEAM, price: 2000, date: "2026-05-15T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events[0].id, "auction:A-new");
  assert.equal(events[1].id, "auction:A-old");
});

test("teamTransferHistory — AI-hold-handler er inkluderet", async () => {
  const supabase = createSupabase({
    auctions: [auctionRow({ id: "A-ai", seller: AI_TEAM, winner: TEAM, price: 10000, date: "2026-05-01T00:00:00Z", sellerIsAi: true })],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events.length, 1);
  assert.equal(events[0].counterparty.is_ai, true);
});

test("teamTransferHistory — season_number udledes fra dato", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-s5", seller: OTHER, winner: TEAM, price: 1000, date: "2026-03-15T00:00:00Z" }),
      auctionRow({ id: "A-s6", seller: OTHER, winner: TEAM, price: 2000, date: "2026-05-01T00:00:00Z" }),
    ],
    seasons: [
      { id: "s5", number: 5, start_date: "2026-01-01", end_date: "2026-03-31" },
      { id: "s6", number: 6, start_date: "2026-04-01", end_date: "2026-06-30" },
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-s5"].season_number, 5);
  assert.equal(byId["auction:A-s6"].season_number, 6);
});

test("teamTransferHistory — private statuses ekskluderes (#105 kontrakt)", async () => {
  // Mock-supabase'en respekterer `.in()`-filteret. Hvis buildTeamTransferHistory
  // ikke kalder .in() med PUBLIC_*-whitelisten, ville disse rows slippe igennem.
  const supabase = createSupabase({
    transferOffers: [
      offerRow({ id: "T-rejected", seller: TEAM, buyer: OTHER, amount: 5000, date: "2026-05-01T00:00:00Z", status: "rejected" }),
      offerRow({ id: "T-pending", seller: TEAM, buyer: OTHER, amount: 6000, date: "2026-05-02T00:00:00Z", status: "pending" }),
      offerRow({ id: "T-accepted", seller: TEAM, buyer: OTHER, amount: 7000, date: "2026-05-03T00:00:00Z", status: "accepted" }),
    ],
    loanAgreements: [
      loanRow({ id: "L-rejected", from: TEAM, to: OTHER, status: "rejected", date: "2026-05-01T00:00:00Z" }),
      loanRow({ id: "L-pending", from: TEAM, to: OTHER, status: "pending", date: "2026-05-02T00:00:00Z" }),
      loanRow({ id: "L-active", from: TEAM, to: OTHER, status: "active", date: "2026-05-03T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const ids = events.map((e) => e.id);
  assert.ok(ids.includes("transfer:T-accepted"));
  assert.ok(ids.includes("loan:L-active"));
  assert.ok(!ids.some((id) => id.includes("rejected") || id.includes("pending")));
});
