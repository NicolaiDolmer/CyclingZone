// Regression-tests for buildRiderHistory (offentlig rytter-handelshistorik).
// #1994: rider-loan-privacy-testene (PUBLIC_LOAN_STATUSES/#105) er fjernet
// sammen med selve udlåns-featuren — loan_agreements har 0 rows i prod og
// er afviklet. #785 no_sale-testen dækker en uafhængig del af historikken
// (auktioner) og er bevaret.

import test from "node:test";
import assert from "node:assert/strict";

const { buildRiderHistory } = await import("./riderHistory.js");

const RIDER = "rider-X";

function auctionRow({ id, winner, price, date, guaranteed = false, freeAgent = false }) {
  return {
    id,
    status: "completed",
    rider_id: RIDER,
    current_price: price,
    actual_end: date,
    created_at: date,
    is_guaranteed_sale: guaranteed,
    seller: freeAgent ? null : { id: "team-seller", name: "Seller Team", is_ai: false },
    winner: winner ? { id: winner, name: `Team ${winner}` } : null,
  };
}

function ownershipRow({ auctionId }) {
  return { rider_id: RIDER, related_entity_type: "auction", related_entity_id: auctionId };
}

// Simpel in-memory Supabase-mock: understøtter kun de kald buildRiderHistory
// selv laver (select/eq/in/or/order), filtreret på RIDER-scopede tabeller.
// Kæden er selv "thenable" (som den ægte Supabase query builder), så den kan
// awaites/lægges i Promise.all uanset om sidste kald er .order() eller .eq()
// (rider_ownership_events-forespørgslen har ikke noget .order()-kald).
function makeSupabase(tableData) {
  function buildQuery(table) {
    const filters = { in: null, eq: [] };
    function finish() {
      const rows = (tableData[table] || []).filter((row) => {
        if (filters.in && !filters.in.values.includes(row[filters.in.column])) return false;
        for (const { column, value } of filters.eq) {
          if (row[column] !== value) return false;
        }
        return true;
      });
      return Promise.resolve({ data: rows, error: null });
    }
    const chain = {
      select() { return chain; },
      or() { return chain; },
      in(column, values) { filters.in = { column, values }; return chain; },
      eq(column, value) { filters.eq.push({ column, value }); return chain; },
      order() { return chain; },
      then(onResolve, onReject) { return finish().then(onResolve, onReject); },
    };
    return chain;
  }
  return { from(table) { return buildQuery(table); } };
}

test("riderHistory — auktion uden bud markeres no_sale med price null (#785)", async () => {
  // Gennemført auktion uden vinder = rytteren blev IKKE solgt. Historikken må
  // ikke vise "Ukendt vandt af X" med den umødte startpris som beløb.
  const supabaseWithAuctions = makeSupabase({
    auctions: [
      auctionRow({ id: "A-nobids", winner: null, price: 106000, date: "2026-05-13T00:00:00Z" }),
      auctionRow({ id: "A-sold", winner: "team-buyer", price: 50000, date: "2026-05-12T00:00:00Z" }),
      auctionRow({ id: "A-guaranteed", winner: null, price: 25000, date: "2026-05-11T00:00:00Z", guaranteed: true }),
    ],
    transfer_offers: [],
    swap_offers: [],
    rider_ownership_events: [],
  });

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

test("riderHistory — phantom free-agent-vinder uden ownership-bekræftelse skjules bag en senere bekræftet auktion (#4297)", async () => {
  // Reproducerer prod-fundet fra #4297 (rytter 425b7604…): to free-agent-
  // auktioner samme dag, samme vinder/pris, kun den SIDSTE har en matchende
  // rider_ownership_events-række. Den første må ikke vises som et selvstændigt salg.
  const supabase = makeSupabase({
    auctions: [
      auctionRow({ id: "A-phantom", winner: "team-x", price: 67104, date: "2026-08-26T13:36:37Z", freeAgent: true }),
      auctionRow({ id: "A-real", winner: "team-x", price: 67104, date: "2026-08-26T15:58:20Z", freeAgent: true }),
    ],
    transfer_offers: [],
    swap_offers: [],
    rider_ownership_events: [ownershipRow({ auctionId: "A-real" })],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const auctionEvents = events.filter((e) => e.type === "auction");
  assert.equal(auctionEvents.length, 2, "begge rækker bevares i datalaget");

  const phantom = auctionEvents.find((e) => e.date === "2026-08-26T13:36:37Z");
  assert.equal(phantom.no_sale, true, "ubekræftet, overhalet free-agent-vind vises ikke som salg");
  assert.equal(phantom.price, null);

  const real = auctionEvents.find((e) => e.date === "2026-08-26T15:58:20Z");
  assert.equal(real.no_sale, false, "den ownership-bekræftede auktion forbliver et rigtigt salg");
  assert.equal(real.price, 67104);
});

test("riderHistory — free-agent-vind uden ownership-række FØR audit-loggens lancering vises stadig som salg", async () => {
  // rider_ownership_events blev først skrevet fra #3582 (2026-08-18). En
  // ældre auktion uden matchende række er IKKE en fejl — den må ikke skjules.
  const supabase = makeSupabase({
    auctions: [
      auctionRow({ id: "A-preAudit", winner: "team-x", price: 40000, date: "2026-06-29T20:02:05Z", freeAgent: true }),
    ],
    transfer_offers: [],
    swap_offers: [],
    rider_ownership_events: [],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const auctionEvents = events.filter((e) => e.type === "auction");
  assert.equal(auctionEvents.length, 1);
  assert.equal(auctionEvents[0].no_sale, false, "før 18/8 er manglende ownership-række forventet, ikke en fejl");
  assert.equal(auctionEvents[0].price, 40000);
});

test("riderHistory — legitim gentaget free-agent-cyklus (begge bekræftet) beholder begge salg", async () => {
  // Rytter vindes free → ejes en periode → kontrakt udløber → vindes free
  // igen af et andet hold. Begge auktioner ER bekræftet af hver deres
  // ownership-række og skal IKKE fjerne hinanden.
  const supabase = makeSupabase({
    auctions: [
      auctionRow({ id: "A-first", winner: "team-a", price: 30000, date: "2026-07-01T00:00:00Z", freeAgent: true }),
      auctionRow({ id: "A-second", winner: "team-b", price: 32000, date: "2026-09-01T00:00:00Z", freeAgent: true }),
    ],
    transfer_offers: [],
    swap_offers: [],
    rider_ownership_events: [ownershipRow({ auctionId: "A-first" }), ownershipRow({ auctionId: "A-second" })],
  });

  const events = await buildRiderHistory(supabase, RIDER);
  const auctionEvents = events.filter((e) => e.type === "auction");
  assert.equal(auctionEvents.every((e) => e.no_sale === false), true, "begge bekræftede salg forbliver synlige");
});
