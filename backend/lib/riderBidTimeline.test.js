// Privacy-tests for #195: live bud-timeline må ALDRIG eksponere proxy_max,
// og afsluttet auktion må KUN returnere final-bud + vinder/sælger/tid.

import test from "node:test";
import assert from "node:assert/strict";

const { buildRiderBidTimeline, TIMELINE_BID_KEYS, COMPLETED_KEYS } =
  await import("./riderBidTimeline.js");

const RIDER = "rider-X";
const AUCTION = "auction-A";
const SELLER = { id: "team-seller", name: "Sælger Team" };
const BUYER = { id: "team-buyer", name: "Køber Team" };

// Minimal stub der efterligner supabase-js's chain-API for de queries
// buildRiderBidTimeline aktivt bruger: select/eq/in/order/limit/maybeSingle.
function createSupabase({ auctions = [], bids = [] } = {}) {
  const tableData = { auctions, auction_bids: bids };

  function buildQuery(table) {
    const filters = { eq: [], in: null };
    let orderCol = null;
    let orderDesc = false;
    let limit = null;

    function applyFilters(rows) {
      return rows.filter((row) => {
        for (const { column, value } of filters.eq) {
          if (row[column] !== value) return false;
        }
        if (filters.in && !filters.in.values.includes(row[filters.in.column])) {
          return false;
        }
        return true;
      });
    }

    function executeAndSort() {
      let rows = applyFilters(tableData[table]);
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = a[orderCol] ?? "";
          const bv = b[orderCol] ?? "";
          if (av < bv) return orderDesc ? 1 : -1;
          if (av > bv) return orderDesc ? -1 : 1;
          return 0;
        });
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return rows;
    }

    const chain = {
      select() { return chain; },
      eq(column, value) { filters.eq.push({ column, value }); return chain; },
      in(column, values) { filters.in = { column, values }; return chain; },
      order(col, opts = {}) {
        orderCol = col;
        orderDesc = opts.ascending === false;
        return chain;
      },
      limit(n) { limit = n; return chain; },
      maybeSingle() {
        const rows = executeAndSort();
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      then(resolve, reject) {
        try {
          const rows = executeAndSort();
          resolve({ data: rows, error: null });
        } catch (e) { reject(e); }
      },
    };
    return chain;
  }

  return { from(table) { return buildQuery(table); } };
}

test("riderBidTimeline — aktiv auktion returnerer bud-timeline med korrekt shape", async () => {
  const supabase = createSupabase({
    auctions: [
      {
        id: AUCTION,
        rider_id: RIDER,
        status: "active",
        current_price: 150000,
        calculated_end: "2026-05-09T18:00:00Z",
        actual_end: null,
        created_at: "2026-05-08T10:00:00Z",
        seller: SELLER,
        winner: BUYER,
      },
    ],
    bids: [
      { auction_id: AUCTION, amount: 100000, bid_time: "2026-05-08T10:05:00Z", is_proxy: false, team: { id: "team-buyer", name: "Køber Team" } },
      { auction_id: AUCTION, amount: 120000, bid_time: "2026-05-08T10:10:00Z", is_proxy: true, team: { id: "team-other", name: "Anden Manager" } },
      { auction_id: AUCTION, amount: 150000, bid_time: "2026-05-08T10:15:00Z", is_proxy: false, team: { id: "team-buyer", name: "Køber Team" } },
    ],
  });

  const result = await buildRiderBidTimeline(supabase, RIDER);

  assert.equal(result.auction_id, AUCTION);
  assert.equal(result.status, "active");
  assert.equal(result.current_price, 150000);
  assert.ok(Array.isArray(result.bid_timeline), "bid_timeline skal være array");
  assert.equal(result.bid_timeline.length, 3);

  const first = result.bid_timeline[0];
  assert.deepEqual(Object.keys(first).sort(), [...TIMELINE_BID_KEYS].sort());
  assert.equal(first.team_id, "team-buyer");
  assert.equal(first.team_name, "Køber Team");
  assert.equal(first.amount, 100000);
  assert.equal(first.bid_time, "2026-05-08T10:05:00Z");
  assert.equal(first.is_proxy, false);

  const second = result.bid_timeline[1];
  assert.equal(second.is_proxy, true, "proxy-bud skal være markeret med is_proxy=true");
});

test("riderBidTimeline — completed auktion returnerer KUN final + vinder + sælger + tid", async () => {
  const supabase = createSupabase({
    auctions: [
      {
        id: AUCTION,
        rider_id: RIDER,
        status: "completed",
        current_price: 200000,
        calculated_end: "2026-05-08T18:00:00Z",
        actual_end: "2026-05-08T18:03:00Z",
        created_at: "2026-05-08T10:00:00Z",
        seller: SELLER,
        winner: BUYER,
      },
    ],
    bids: [
      { auction_id: AUCTION, amount: 100000, bid_time: "2026-05-08T10:05:00Z", is_proxy: false, team: BUYER },
      { auction_id: AUCTION, amount: 200000, bid_time: "2026-05-08T17:55:00Z", is_proxy: false, team: BUYER },
    ],
  });

  const result = await buildRiderBidTimeline(supabase, RIDER);

  assert.equal(result.status, "completed");
  assert.equal(result.final_bid, 200000);
  assert.equal(result.winner_team_id, "team-buyer");
  assert.equal(result.winner_name, "Køber Team");
  assert.equal(result.seller_team_id, "team-seller");
  assert.equal(result.seller_name, "Sælger Team");
  assert.equal(result.completed_at, "2026-05-08T18:03:00Z");

  // Privacy-invariant: bud-timeline må IKKE være med i completed-shape
  assert.equal(result.bid_timeline, undefined, "completed-payload må ikke indeholde bid_timeline");
  assert.equal(result.current_price, undefined, "completed-payload må ikke eksponere intern current_price");

  // Whitelist: kun forventede keys + auction_id
  const allowed = new Set([...COMPLETED_KEYS, "auction_id", "status"]);
  for (const key of Object.keys(result)) {
    assert.ok(allowed.has(key), `uventet key i completed-payload: ${key}`);
  }
});

test("riderBidTimeline — proxy_max / max_amount eksponeres ALDRIG (privacy-invariant)", async () => {
  const supabase = createSupabase({
    auctions: [
      {
        id: AUCTION,
        rider_id: RIDER,
        status: "active",
        current_price: 150000,
        calculated_end: "2026-05-09T18:00:00Z",
        actual_end: null,
        created_at: "2026-05-08T10:00:00Z",
        seller: SELLER,
        winner: BUYER,
      },
    ],
    bids: [
      // Selv hvis nogen ved et uheld lægger proxy-felter på bid-rækken,
      // skal pickTimelineBid stadig returnere whitelist-only shape.
      {
        auction_id: AUCTION,
        amount: 120000,
        bid_time: "2026-05-08T10:10:00Z",
        is_proxy: true,
        proxy_max: 999999, // <-- må aldrig nå frem til responsen
        max_amount: 999999, // <-- må aldrig nå frem til responsen
        team: BUYER,
      },
    ],
  });

  const result = await buildRiderBidTimeline(supabase, RIDER);
  const blob = JSON.stringify(result);

  assert.ok(!blob.includes("proxy_max"), "proxy_max må ALDRIG forekomme i payload");
  assert.ok(!blob.includes("max_amount"), "max_amount må ALDRIG forekomme i payload");
  assert.ok(!blob.includes("999999"), "proxy-værdier må ALDRIG forekomme i payload");

  for (const entry of result.bid_timeline) {
    assert.deepEqual(Object.keys(entry).sort(), [...TIMELINE_BID_KEYS].sort());
  }
});

test("riderBidTimeline — ingen auktion → returnerer tomt skel-payload", async () => {
  const supabase = createSupabase({ auctions: [], bids: [] });
  const result = await buildRiderBidTimeline(supabase, RIDER);
  assert.deepEqual(result, { auction_id: null, status: null });
});
