// #8060: akademi-regnskabet pr. sæson. Porteret fra designudgavens
// regnskabstests i draft-PR #8249 og udvidet med backend-hentningen og
// kontakten. De gamle tests for de kumulative tal står i academyPnl.test.js
// og er uændrede (kontakten slukket = svaret som før).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEDGER_SOURCE,
  classifySigning,
  seasonForDate,
  buildAcademyRiderPool,
  buildLedgerSales,
  buildSeasonLedger,
  buildAcademyLedgerPayload,
} from "./academyPnl.ts";
import type { PoolMember } from "./academyPnl.ts";
import { ACADEMY_LEDGER_FLAG_KEY, isAcademyLedgerEnabled, loadAcademySeasonLedger } from "./academyPnlLoad.ts";

const seasons = [
  { id: "s4", number: 4, status: "completed", start_date: "2026-08-01", end_date: "2026-09-28" },
  { id: "s5", number: 5, status: "active", start_date: "2026-10-01" },
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
  assert.equal(sales[0].riderName, "B Auction");
  assert.equal(sales[0].via, "auction");
  assert.equal(sales[0].seasonNumber, 5);
  assert.equal(sales[1].via, "transfer");
  assert.equal(sales[1].seasonNumber, 4);
});

test("#785: en auktion uden vinder er hverken et køb eller et salg", () => {
  const pool = buildAcademyRiderPool({ youthAuctionWins: [{ rider_id: "x", current_bidder_id: null }] });
  assert.equal(pool.size, 0);
  const sales = buildLedgerSales({
    pool: new Map<string, PoolMember>([["y", { riderId: "y", riderName: null, origin: "offer" }]]),
    auctionRows: [{ rider_id: "y", current_bidder_id: null, current_price: 50 }],
  });
  assert.equal(sales.length, 0);
});

test("en transfer uden pris er intet salg; counter_amount vinder over offer_amount", () => {
  const pool = new Map<string, PoolMember>([["y", { riderId: "y", riderName: null, origin: "offer" }]]);
  const sales = buildLedgerSales({
    pool,
    transferRows: [
      { rider_id: "y", offer_amount: 0, updated_at: "2026-10-02T00:00:00Z" },
      { rider_id: "y", offer_amount: 100, counter_amount: 140, updated_at: "2026-10-03T00:00:00Z" },
    ],
  });
  assert.deepEqual(sales.map((s) => s.price), [140]);
});

test("en hentning fra tilbud vinder over samme rytter vundet på auktion (ingen dublet i kredsen)", () => {
  const pool = buildAcademyRiderPool({
    signedIntake: [{ rider_id: "r1" }],
    youthAuctionWins: [{ rider_id: "r1", current_bidder_id: "team" }, { rider_id: "r2", is_guaranteed_sale: true }],
  });
  assert.equal(pool.size, 2);
  assert.equal(pool.get("r1")?.origin, LEDGER_SOURCE.OFFER);
  assert.equal(pool.get("r2")?.origin, LEDGER_SOURCE.YOUTH_AUCTION);
});

test("academy_signing deles i hentning fra tilbud og køb på ungdomsauktion", () => {
  assert.equal(classifySigning({ metadata: { code: "tx.youthAuctionWin" } }), LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(classifySigning({ related_entity_type: "auction" }), LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(classifySigning({ idempotency_key: "youth_auction_winner:abc" }), LEDGER_SOURCE.YOUTH_AUCTION);
  assert.equal(classifySigning({ metadata: { code: "tx.academySigning" } }), LEDGER_SOURCE.OFFER);
  assert.equal(classifySigning({ idempotency_key: "academy_signing:r1" }), LEDGER_SOURCE.OFFER);
  assert.equal(classifySigning({}), LEDGER_SOURCE.OFFER);
  assert.equal(classifySigning(null), LEDGER_SOURCE.OFFER);
});

test("regnskabet deles pr. sæson: denne sæson øverst, samlet linje summerer", () => {
  const ledger = buildSeasonLedger({
    seasons,
    currentSeasonId: "s5",
    financeRows: [
      { type: "academy_signing", amount: -40, season_id: "s4", metadata: { code: "tx.academySigning" } },
      { type: "academy_signing", amount: -200, season_id: "s5", metadata: { code: "tx.youthAuctionWin" } },
      { type: "academy_drift", amount: -10, created_at: "2026-08-15T00:00:00Z" },
      { type: "salary", amount: -999, season_id: "s5" },
    ],
    sales: [
      { price: 300, seasonId: "s5" },
      { price: 100, seasonId: "s4" },
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

test("summen af sæsonerne er den samlede linje (udgift og indtægt dækker samme kreds)", () => {
  const payload = buildAcademyLedgerPayload({
    seasons,
    financeRows: [
      { type: "academy_signing", amount: -50, season_id: "s4", idempotency_key: "academy_signing:r-offer" },
      { type: "academy_signing", amount: -500, season_id: "s5", idempotency_key: "youth_auction_winner:a1" },
    ],
    signedIntake: [{ rider_id: "r-offer" }],
    youthAuctionWins: [{ rider_id: "r-auction", current_bidder_id: "team" }],
    auctionRows: [{ rider_id: "r-auction", current_bidder_id: "buyer", current_price: 800, actual_end: "2026-10-20T00:00:00Z" }],
    transferRows: [{ rider_id: "r-offer", offer_amount: 70, updated_at: "2026-09-01T00:00:00Z" }],
  });
  assert.equal(payload.currentSeasonId, "s5");
  assert.equal(payload.poolSize, 2);
  const sum = (k: "offerSignings" | "youthAuctionBuys" | "salesProceeds" | "net") =>
    payload.seasons.reduce((acc, r) => acc + r[k], 0);
  for (const k of ["offerSignings", "youthAuctionBuys", "salesProceeds", "net"] as const) {
    assert.equal(sum(k), payload.total[k], k);
  }
  assert.equal(payload.total.youthAuctionBuys, 500);
  assert.equal(payload.total.salesProceeds, 870);
  assert.equal(payload.total.net, 320);
  assert.equal(payload.showDrift, false);
  assert.deepEqual(payload.sales.map((s) => s.origin), [LEDGER_SOURCE.YOUTH_AUCTION, LEDGER_SOURCE.OFFER]);
});

test("denne sæson står altid med, også uden bevægelser", () => {
  const ledger = buildSeasonLedger({ seasons, currentSeasonId: "s5" });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.current?.seasonNumber, 5);
  assert.equal(ledger.showDrift, false);
  assert.equal(ledger.driftIsHistoric, false);
});

test("drift i denne sæson er ikke historisk", () => {
  const ledger = buildSeasonLedger({
    seasons,
    currentSeasonId: "s5",
    financeRows: [{ type: "academy_drift", amount: -10, season_id: "s5" }],
  });
  assert.equal(ledger.showDrift, true);
  assert.equal(ledger.driftIsHistoric, false);
});

test("seasonForDate falder tilbage til seneste startede sæson", () => {
  assert.equal(seasonForDate(seasons, "2026-08-20")?.id, "s4");
  assert.equal(seasonForDate(seasons, "2027-01-01")?.id, "s5");
  assert.equal(seasonForDate(seasons, "2025-01-01"), null);
  assert.equal(seasonForDate(seasons, null), null);
});

// Samme regel som holdets handelshistorik (buildSeasonResolver, #984/#7285/#1776),
// så et salg står i samme sæson her og i historikken (Codex 16/11).
test("delt grænsedag: den gamle sæson vinder (#984), dagen efter er den nye", () => {
  const shift = [
    { id: "new", number: 6, start_date: "2026-12-01" },
    { id: "old", number: 5, start_date: "2026-10-01", end_date: "2026-12-01" },
  ];
  assert.equal(seasonForDate(shift, "2026-12-01T15:00:00Z")?.id, "old");
  assert.equal(seasonForDate([...shift].reverse(), "2026-12-01T15:00:00Z")?.id, "old");
  assert.equal(seasonForDate(shift, "2026-12-02T09:00:00Z")?.id, "new");
  assert.equal(seasonForDate(shift, "2026-11-30T15:00:00Z")?.id, "old");
});

test("salg i sæsonpausen hører til den KOMMENDE sæson (#7285), som i handelshistorikken", () => {
  const s45 = [
    { id: "s4", number: 4, start_date: "2026-08-23", end_date: "2026-10-25" },
    { id: "s5", number: 5, start_date: "2026-10-28" },
  ];
  assert.equal(seasonForDate(s45, "2026-10-26T12:00:00Z")?.id, "s5");
  assert.equal(seasonForDate(s45, "2026-10-25T20:00:00Z")?.id, "s4");
});

test("nul-bred sæson taber sin grænsedag til en senere sæson samme dag (#1776)", () => {
  const launch = [
    { id: "s0", number: 0, start_date: "2026-06-22", end_date: "2026-06-22" },
    { id: "s1", number: 1, start_date: "2026-06-22" },
  ];
  assert.equal(seasonForDate(launch, "2026-06-22T12:00:00Z")?.id, "s1");
  assert.equal(seasonForDate([...launch].reverse(), "2026-06-22T12:00:00Z")?.id, "s1");
  assert.equal(seasonForDate(launch, "2026-07-01T00:00:00Z")?.id, "s1");
});

// ─── Kontakten og hentningen ─────────────────────────────────────────────────

type Filter = [op: string, col: string, val: unknown];

// Kædbar fake for PostgREST: hver .from(tabel) filtrerer `tables[tabel]` med
// eq/in og svarer på .range()/.maybeSingle(). Logger hvert kald, så testen kan se
// at historikken pagineres med stabil order.
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>, flag?: unknown) {
  const calls: { table: string; filters: Filter[]; ordered: string | null; ranged: boolean }[] = [];
  return {
    calls,
    from(table: string) {
      const call = { table, filters: [] as Filter[], ordered: null as string | null, ranged: false };
      calls.push(call);
      const apply = () => (tables[table] ?? []).filter((row) => call.filters.every(([op, col, val]) =>
        op === "eq" ? row[col] === val : (val as unknown[]).includes(row[col])));
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { call.filters.push(["eq", col, val]); return q; },
        in: (col: string, val: unknown[]) => { call.filters.push(["in", col, val]); return q; },
        order: (col: string) => { call.ordered = col; return q; },
        range: (from: number, to: number) => {
          call.ranged = true;
          return Promise.resolve({ data: apply().slice(from, to + 1), error: null });
        },
        maybeSingle: () => Promise.resolve(table === "app_config"
          ? { data: flag === undefined ? null : { value: flag }, error: null }
          : { data: null, error: null }),
      };
      return q;
    },
  };
}

test("kontakten: ikke seedet, off og beta for en ikke-tester er slukket", async () => {
  assert.equal(ACADEMY_LEDGER_FLAG_KEY, "academy_page_v2_8081");
  assert.equal(await isAcademyLedgerEnabled(fakeSupabase({})), false);
  assert.equal(await isAcademyLedgerEnabled(fakeSupabase({}, "off")), false);
  assert.equal(await isAcademyLedgerEnabled(fakeSupabase({}, "beta"), { isBetaTester: false }), false);
  assert.equal(await isAcademyLedgerEnabled(fakeSupabase({}, "beta"), { isBetaTester: true }), true);
  assert.equal(await isAcademyLedgerEnabled(fakeSupabase({}, "on")), true);
});

test("hentningen: kreds fra tilbud + ungdomsauktion, salg fra begge veje, alt pagineret", async () => {
  const db = fakeSupabase({
    seasons,
    finance_transactions: [
      { id: 1, team_id: "t", type: "academy_signing", amount: -50, season_id: "s4", metadata: { code: "tx.academySigning" } },
      { id: 2, team_id: "t", type: "academy_signing", amount: -500, season_id: "s5", metadata: { code: "tx.youthAuctionWin" } },
      { id: 3, team_id: "other", type: "academy_signing", amount: -9999, season_id: "s5" },
    ],
    academy_intake: [
      { id: 1, team_id: "t", status: "signed", rider_id: "r-offer", riders: { firstname: "A", lastname: "Offer" } },
      { id: 2, team_id: "t", status: "rejected", rider_id: "r-no" },
    ],
    auctions: [
      { id: 1, is_youth: true, status: "completed", current_bidder_id: "t", rider_id: "r-auction", riders: { firstname: "B", lastname: "Auction" } },
      { id: 2, is_youth: false, status: "completed", seller_team_id: "t", rider_id: "r-auction", current_bidder_id: "buyer", current_price: 800, actual_end: "2026-10-20T00:00:00Z" },
      { id: 3, is_youth: false, status: "completed", seller_team_id: "t", rider_id: "r-senior", current_bidder_id: "buyer", current_price: 5000, actual_end: "2026-10-21T00:00:00Z" },
    ],
    transfer_offers: [
      { id: 1, seller_team_id: "t", status: "accepted", rider_id: "r-offer", offer_amount: 70, updated_at: "2026-09-01T00:00:00Z" },
      { id: 2, seller_team_id: "t", status: "window_pending", rider_id: "r-offer", offer_amount: 999, updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
  const payload = await loadAcademySeasonLedger(db, { teamId: "t" });
  assert.equal(payload.poolSize, 2);
  assert.equal(payload.total.offerSignings, 50);
  assert.equal(payload.total.youthAuctionBuys, 500);
  assert.equal(payload.total.salesProceeds, 870);
  assert.equal(payload.total.salesCount, 2);
  assert.deepEqual(payload.sales.map((s) => s.riderName), ["B Auction", "A Offer"]);
  const dataCalls = db.calls.filter((c) => c.table !== "app_config");
  assert.ok(dataCalls.length >= 6);
  for (const c of dataCalls) {
    assert.equal(c.ranged, true, `${c.table} skal pagineres`);
    assert.equal(c.ordered, "id", `${c.table} skal have stabil order`);
  }
});

test("hentningen: hold uden akademihistorik giver kun denne sæson og ingen salgsopslag", async () => {
  const db = fakeSupabase({ seasons });
  const payload = await loadAcademySeasonLedger(db, { teamId: "t" });
  assert.equal(payload.poolSize, 0);
  assert.equal(payload.seasons.length, 1);
  assert.equal(payload.seasons[0].isCurrent, true);
  assert.deepEqual(payload.sales, []);
  assert.equal(db.calls.some((c) => c.table === "transfer_offers"), false);
});

// Kontrakt på routen: feltet ligger kun bag kontakten, og resten af svaret er
// de samme nøgler i samme rækkefølge som før #8060.
test("GET /academy/pnl: ledger kun bag kontakten, øvrigt svar uændret", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const api = readFileSync(resolve(here, "../routes/api.js"), "utf8");
  const start = api.indexOf('router.get("/academy/pnl"');
  assert.notEqual(start, -1);
  const block = api.slice(start, api.indexOf("\nrouter.", start + 10));
  assert.match(block, /res\.json\(\{\s*enabled: true,\s*\.\.\.summarizeAcademyPnl\(\{ current, driftPaid, signingFeesPaid, sales \}\),/);
  assert.match(block, /\(await isAcademyLedgerEnabled\(supabase, \{ isBetaTester \}\)\) \? \{ ledger: await loadAcademySeasonLedger\(supabase, \{ teamId \}\) \} : \{\}/);
  assert.equal((block.match(/loadAcademySeasonLedger/g) ?? []).length, 1, "hentningen må kun ske i den tændte gren");
});
