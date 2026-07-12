// Regression-tests for buildRiderHistory (offentlig rytter-handelshistorik).
// #1994: rider-loan-privacy-testene (PUBLIC_LOAN_STATUSES/#105) er fjernet
// sammen med selve udlåns-featuren — loan_agreements har 0 rows i prod og
// er afviklet. #785 no_sale-testen dækker en uafhængig del af historikken
// (auktioner) og er bevaret.

import test from "node:test";
import assert from "node:assert/strict";

const { buildRiderHistory } = await import("./riderHistory.js");

const RIDER = "rider-X";

function auctionRow({ id, winner, price, date, guaranteed = false }) {
  return {
    id,
    status: "completed",
    rider_id: RIDER,
    current_price: price,
    actual_end: date,
    created_at: date,
    is_guaranteed_sale: guaranteed,
    seller: { id: "team-seller", name: "Seller Team", is_ai: false },
    winner: winner ? { id: winner, name: `Team ${winner}` } : null,
  };
}

test("riderHistory — auktion uden bud markeres no_sale med price null (#785)", async () => {
  // Gennemført auktion uden vinder = rytteren blev IKKE solgt. Historikken må
  // ikke vise "Ukendt vandt af X" med den umødte startpris som beløb.
  const supabaseWithAuctions = (() => {
    const auctions = [
      auctionRow({ id: "A-nobids", winner: null, price: 106000, date: "2026-05-13T00:00:00Z" }),
      auctionRow({ id: "A-sold", winner: "team-buyer", price: 50000, date: "2026-05-12T00:00:00Z" }),
      auctionRow({ id: "A-guaranteed", winner: null, price: 25000, date: "2026-05-11T00:00:00Z", guaranteed: true }),
    ];
    const tableData = {
      auctions,
      transfer_offers: [],
      swap_offers: [],
    };
    function buildQuery(table) {
      const filters = { in: null, eq: [] };
      const chain = {
        select() { return chain; },
        or() { return chain; },
        in(column, values) { filters.in = { column, values }; return chain; },
        eq(column, value) { filters.eq.push({ column, value }); return chain; },
        order() {
          const rows = tableData[table].filter((row) => {
            if (filters.in && !filters.in.values.includes(row[filters.in.column])) return false;
            for (const { column, value } of filters.eq) {
              if (row[column] !== value) return false;
            }
            return true;
          });
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return chain;
    }
    return { from(table) { return buildQuery(table); } };
  })();

  const events = await buildRiderHistory(supabaseWithAuctions, RIDER);
  const auctionEvents = events.filter((e) => e.type === "auction");
  assert.equal(auctionEvents.length, 3);

  const noBids = auctionEvents.find((e) => e.date === "2026-05-13T00:00:00Z");
  assert.equal(noBids.no_sale, true, "ingen bud → no_sale");
  assert.equal(noBids.price, null, "umødt startpris må ikke vises som handelsbeløb");
  assert.equal(noBids.buyer, null);

  const sold = auctionEvents.find((e) => e.date === "2026-05-12T00:00:00Z");
  assert.equal(sold.no_sale, false);
  assert.equal(sold.price, 50000);

  const guaranteed = auctionEvents.find((e) => e.date === "2026-05-11T00:00:00Z");
  assert.equal(guaranteed.no_sale, false, "garanteret AI-salg er et salg, ikke no_sale");
  assert.equal(guaranteed.price, 25000);
});
