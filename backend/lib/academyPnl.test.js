import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAcademyCurrent,
  computeAcademyCumulative,
  isRealizedSale,
  buildAcademySales,
  summarizeAcademyPnl,
} from "./academyPnl.js";

// ─── computeAcademyCurrent ──────────────────────────────────────────────────

test("computeAcademyCurrent: summerer løn for nuværende akademi-trup + rapporterer pladser", () => {
  const roster = [{ salary: 5000 }, { salary: 3200 }, { salary: null }];
  const result = computeAcademyCurrent(roster, { slotsMax: 8 });
  assert.deepEqual(result, { slotsUsed: 3, slotsMax: 8, payroll: 8200 });
});

test("computeAcademyCurrent: tomt akademi giver 0 løn, 0 pladser brugt", () => {
  const result = computeAcademyCurrent([], { slotsMax: 8 });
  assert.deepEqual(result, { slotsUsed: 0, slotsMax: 8, payroll: 0 });
});

// ─── computeAcademyCumulative ───────────────────────────────────────────────

test("computeAcademyCumulative: summerer drift + signing-fees separat (negative amounts → abs)", () => {
  const rows = [
    { type: "academy_drift", amount: -5000 },
    { type: "academy_drift", amount: -10000 },
    { type: "academy_signing", amount: -2500 },
    { type: "salary", amount: -40000 }, // ikke akademi-specifik — skal ignoreres
  ];
  const result = computeAcademyCumulative(rows);
  assert.deepEqual(result, { driftPaid: 15000, signingFeesPaid: 2500 });
});

test("computeAcademyCumulative: ingen rows giver 0/0", () => {
  assert.deepEqual(computeAcademyCumulative([]), { driftPaid: 0, signingFeesPaid: 0 });
});

// ─── isRealizedSale (#785) ──────────────────────────────────────────────────

test("isRealizedSale: vinder = realiseret salg", () => {
  assert.equal(isRealizedSale({ current_bidder_id: "team-1", is_guaranteed_sale: false }), true);
});

test("isRealizedSale: garanteret salg uden vinder tæller stadig som realiseret", () => {
  assert.equal(isRealizedSale({ current_bidder_id: null, is_guaranteed_sale: true }), true);
});

test("isRealizedSale: ingen vinder + ikke garanteret = intet salg (#785)", () => {
  assert.equal(isRealizedSale({ current_bidder_id: null, is_guaranteed_sale: false }), false);
});

// ─── buildAcademySales ──────────────────────────────────────────────────────

test("buildAcademySales: bygger salgs-liste med navn + salgspræmie, nyeste først", () => {
  const gradByRider = new Map([
    ["rider-1", { resolved_at: "2026-06-01T00:00:00Z", riders: { firstname: "Anna", lastname: "Sørensen" } }],
    ["rider-2", { resolved_at: "2026-05-01T00:00:00Z", riders: { firstname: "Bo", lastname: "Nielsen" } }],
  ]);
  const auctions = [
    { rider_id: "rider-1", current_price: 12000, starting_price: 9000, current_bidder_id: "team-x", is_guaranteed_sale: false, actual_end: "2026-06-05T12:00:00Z" },
    { rider_id: "rider-2", current_price: 4000, starting_price: 4000, current_bidder_id: "team-y", is_guaranteed_sale: false, actual_end: "2026-05-02T12:00:00Z" },
  ];
  const sales = buildAcademySales(auctions, gradByRider);
  assert.equal(sales.length, 2);
  assert.equal(sales[0].riderId, "rider-1"); // nyeste actual_end først
  assert.equal(sales[0].riderName, "Anna Sørensen");
  assert.equal(sales[0].price, 12000);
  assert.equal(sales[0].premium, 3000);
  assert.equal(sales[1].premium, 0);
});

test("buildAcademySales: filtrerer ikke-realiserede auktioner fra (#785)", () => {
  const gradByRider = new Map([["rider-1", { riders: { firstname: "Anna", lastname: "Sørensen" } }]]);
  const auctions = [
    { rider_id: "rider-1", current_price: 9000, starting_price: 9000, current_bidder_id: null, is_guaranteed_sale: false },
  ];
  const sales = buildAcademySales(auctions, gradByRider);
  assert.equal(sales.length, 0);
});

test("buildAcademySales: falder tilbage på graduation.resolved_at når actual_end mangler", () => {
  const gradByRider = new Map([["rider-1", { resolved_at: "2026-04-01T00:00:00Z", riders: {} }]]);
  const auctions = [
    { rider_id: "rider-1", current_price: 5000, starting_price: 5000, current_bidder_id: "team-z", is_guaranteed_sale: false, actual_end: null },
  ];
  const sales = buildAcademySales(auctions, gradByRider);
  assert.equal(sales[0].soldAt, "2026-04-01T00:00:00Z");
  assert.equal(sales[0].riderName, null); // intet navn tilgængeligt
});

test("buildAcademySales: manglende graduation-match giver stadig et salg (defensivt)", () => {
  const auctions = [
    { rider_id: "rider-orphan", current_price: 3000, starting_price: 2000, current_bidder_id: "team-a", is_guaranteed_sale: false, actual_end: "2026-03-01T00:00:00Z" },
  ];
  const sales = buildAcademySales(auctions, new Map());
  assert.equal(sales.length, 1);
  assert.equal(sales[0].riderName, null);
  assert.equal(sales[0].premium, 1000);
});

// ─── summarizeAcademyPnl ────────────────────────────────────────────────────

test("summarizeAcademyPnl: samler kumulative summer + net cash flow korrekt", () => {
  const current = { slotsUsed: 4, slotsMax: 8, payroll: 12000 };
  const sales = [
    { riderId: "r1", price: 12000, premium: 3000 },
    { riderId: "r2", price: 4000, premium: 0 },
  ];
  const result = summarizeAcademyPnl({ current, driftPaid: 15000, signingFeesPaid: 2500, sales });
  assert.deepEqual(result, {
    current,
    cumulative: {
      driftPaid: 15000,
      signingFeesPaid: 2500,
      salesProceeds: 16000,
      valueCreation: 3000,
      salesCount: 2,
      netCashFlow: 16000 - 15000 - 2500, // -1500 — akademiet har kostet mere end det har indbragt indtil videre
    },
    sales,
  });
});

test("summarizeAcademyPnl: ingen salg giver 0-indtægter og negativ net cash flow lig med udgifterne", () => {
  const current = { slotsUsed: 2, slotsMax: 8, payroll: 5000 };
  const result = summarizeAcademyPnl({ current, driftPaid: 10000, signingFeesPaid: 0, sales: [] });
  assert.equal(result.cumulative.salesProceeds, 0);
  assert.equal(result.cumulative.valueCreation, 0);
  assert.equal(result.cumulative.netCashFlow, -10000);
});

test("summarizeAcademyPnl: kapper salgs-listen til de 20 seneste", () => {
  const sales = Array.from({ length: 25 }, (_, i) => ({ riderId: `r${i}`, price: 100, premium: 0 }));
  const result = summarizeAcademyPnl({ current: { slotsUsed: 0, slotsMax: 8, payroll: 0 }, driftPaid: 0, signingFeesPaid: 0, sales });
  assert.equal(result.sales.length, 20);
  assert.equal(result.cumulative.salesCount, 25); // salesCount tæller ALLE realiserede salg, ikke kun de viste
});
