import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_SOURCE, classifySigning, seasonForDate, buildAcademyRiderPool,
  buildLedgerSales, buildSeasonLedger,
} from "./academyLedger.ts";
import {
  readDesign8081Variant, readDesign8081Tab, designLandingSquad, ageFocusDistribution,
} from "./designModel.ts";

const seasons = [
  { id: "s4", number: 4, start_date: "2026-08-01", end_date: "2026-09-30" },
  { id: "s5", number: 5, start_date: "2026-10-01", end_date: null },
];

test("#8060: en rytter vundet på ungdomsauktion og solgt tæller med i salg", () => {
  const pool = buildAcademyRiderPool({
    signedIntake: [{ rider_id: "r-offer", riders: { firstname: "A", lastname: "Offer" } }],
    youthAuctionWins: [{ rider_id: "r-auction", current_bidder_id: "team", riders: { firstname: "B", lastname: "Auction" } }],
  });
  const sales = buildLedgerSales({
    pool,
    seasons,
    auctionRows: [
      { rider_id: "r-auction", current_bidder_id: "buyer", current_price: 300, actual_end: "2026-10-05T10:00:00Z" },
      { rider_id: "r-other", current_bidder_id: "buyer", current_price: 999, actual_end: "2026-10-06T10:00:00Z" },
    ],
    transferRows: [{ rider_id: "r-offer", offer_amount: 100, updated_at: "2026-08-10T10:00:00Z" }],
  });
  assert.deepEqual(sales.map((s) => s.riderId), ["r-auction", "r-offer"]);
  assert.equal(sales[0].origin, LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(sales[0].seasonNumber, 5);
  assert.equal(sales[1].seasonNumber, 4);
});

test("#785: en auktion uden vinder er hverken et køb eller et salg", () => {
  const pool = buildAcademyRiderPool({ youthAuctionWins: [{ rider_id: "x", current_bidder_id: null }] });
  assert.equal(pool.size, 0);
  const sales = buildLedgerSales({
    pool: new Map([["y", { riderId: "y", riderName: null, origin: "offer" as const }]]),
    auctionRows: [{ rider_id: "y", current_bidder_id: null, current_price: 50 }],
  });
  assert.equal(sales.length, 0);
});

test("academy_signing deles i hentning fra tilbud og køb på ungdomsauktion", () => {
  assert.equal(classifySigning({ metadata: { code: "tx.youthAuctionWin" } }), LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(classifySigning({ related_entity_type: "auction" }), LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(classifySigning({ metadata: { code: "tx.academySigning" } }), LEDGER_SOURCE.OFFER);
  assert.equal(classifySigning({}), LEDGER_SOURCE.OFFER);
});

test("regnskabet deles pr. sæson: denne sæson øverst, samlet linje summerer", () => {
  const ledger = buildSeasonLedger({
    seasons,
    currentSeasonId: "s5",
    financeRows: [
      { type: "academy_signing", amount: -40, season_id: "s4", metadata: { code: "tx.academySigning" } },
      { type: "academy_signing", amount: -200, season_id: "s5", metadata: { code: "tx.youthAuctionWin" } },
      { type: "academy_drift", amount: -10, created_at: "2026-08-15T00:00:00Z" },
    ],
    sales: [
      { riderId: "a", price: 300, seasonId: "s5" },
      { riderId: "b", price: 100, seasonId: "s4" },
    ],
  });
  assert.deepEqual(ledger.rows.map((r) => r.seasonNumber), [5, 4]);
  assert.equal(ledger.rows[0].isCurrent, true);
  assert.equal(ledger.rows[0].youthAuctionBuys, 200);
  assert.equal(ledger.rows[0].net, 100);
  assert.equal(ledger.rows[1].offerSignings, 40);
  assert.equal(ledger.rows[1].drift, 10);
  assert.equal(ledger.rows[1].net, 50);
  assert.equal(ledger.total.net, 150);
  assert.equal(ledger.total.salesCount, 2);
  assert.equal(ledger.showDrift, true);
  assert.equal(ledger.driftIsHistoric, true);
});

test("denne sæson står altid med, også uden bevægelser", () => {
  const ledger = buildSeasonLedger({ seasons, currentSeasonId: "s5" });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.current?.seasonNumber, 5);
  assert.equal(ledger.showDrift, false);
});

test("seasonForDate falder tilbage til seneste startede sæson", () => {
  assert.equal(seasonForDate(seasons, "2026-08-20")?.id, "s4");
  assert.equal(seasonForDate(seasons, "2027-01-01")?.id, "s5");
  assert.equal(seasonForDate(seasons, "2025-01-01"), null);
  assert.equal(seasonForDate(seasons, null), null);
});

test("sæsonskifte samme dag: den nye sæson vinder (rækkefølgen er ligegyldig)", () => {
  const sameDay = [
    { id: "new", number: 6, start_date: "2026-12-01", end_date: null },
    { id: "old", number: 5, start_date: "2026-10-01", end_date: "2026-12-01" },
  ];
  assert.equal(seasonForDate(sameDay, "2026-12-01T15:00:00Z")?.id, "new");
  assert.equal(seasonForDate([...sameDay].reverse(), "2026-12-01T15:00:00Z")?.id, "new");
  assert.equal(seasonForDate(sameDay, "2026-11-30T15:00:00Z")?.id, "old");
});

test("design-parameteren: kun a, b og c tænder en udgave", () => {
  assert.equal(readDesign8081Variant("?design8081=a"), "a");
  assert.equal(readDesign8081Variant("?design8081=C"), "c");
  assert.equal(readDesign8081Variant("?design8081=d"), null);
  assert.equal(readDesign8081Variant(""), null);
  assert.equal(readDesign8081Tab("?tab8081=ledger"), "ledger");
  assert.equal(readDesign8081Tab("?tab8081=nope"), "intake");
});

test("#7932: talentet lander på den yngste trup med plads", () => {
  assert.equal(designLandingSquad(17, { junior: 3, u23: 2, senior: 20 }), "junior");
  assert.equal(designLandingSquad(17, { junior: 30, u23: 2, senior: 20 }), "u23");
  assert.equal(designLandingSquad(19, { junior: 0, u23: 5, senior: 20 }), "u23");
  assert.equal(designLandingSquad(23, { junior: 5, u23: 5, senior: 10 }), "senior");
  assert.equal(designLandingSquad(17, { junior: 30, u23: 30, senior: 0 }), null, "U23 og junior er fulde, og holdet er på 60");
  assert.equal(designLandingSquad(17, { junior: 10, u23: 20, senior: 30 }), null, "hele holdet er på 60");
});

test("#6944: fokus-alder flytter fordelingen, alle aldre er stadig med", () => {
  const mixed = ageFocusDistribution("mixed");
  assert.deepEqual(mixed.map((d) => d.age), [16, 17, 18, 19]);
  const focus17 = ageFocusDistribution("17");
  assert.equal(focus17.find((d) => d.age === 17)?.share, "many");
  assert.ok(focus17.every((d) => d.share !== undefined));
  assert.equal(focus17.find((d) => d.age === 19)?.squad, "u23");
});
