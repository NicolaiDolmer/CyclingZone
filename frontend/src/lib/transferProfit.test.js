import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTransferProfit } from "./transferProfit.js";

// #1107 · Transfer-profit pr. rytter udledes af transferhistorikkens events
// (der findes ingen acquisition_price-kolonne endnu, jf. #1101). Kernen:
// par "in"-køb med efterfølgende "out"-salg pr. rytter; swap = ejerskifte
// uden kendt pris; loan = intet ejerskifte; auktion uden bud = intet salg.

const RIDER_A = { id: "r-a", firstname: "Tadej", lastname: "Asgreen" };
const RIDER_B = { id: "r-b", firstname: "Jonas", lastname: "Bjerg" };

function auctionEvent({ rider, direction, amount, date, season = 1 }) {
  return {
    id: `auction:${rider.id}:${date}`,
    type: "auction",
    direction,
    cash_flow: amount > 0 ? (direction === "out" ? "in" : "out") : null,
    date,
    rider,
    counterparty: amount > 0 ? { id: "t-x", name: "Modpart", is_ai: false } : null,
    amount,
    season_number: season,
  };
}

function transferEvent({ rider, direction, amount, date, season = 1 }) {
  return {
    id: `transfer:${rider.id}:${date}`,
    type: "transfer",
    direction,
    cash_flow: amount > 0 ? (direction === "out" ? "in" : "out") : null,
    date,
    rider,
    counterparty: { id: "t-x", name: "Modpart", is_ai: false },
    amount,
    status: "accepted",
    season_number: season,
  };
}

test("#1107 · køb + salg parres til én handel med korrekt profit", () => {
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 10_000_000, date: "2026-01-01T10:00:00Z" }),
    transferEvent({ rider: RIDER_A, direction: "out", amount: 28_000_000, date: "2026-05-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].rider.id, "r-a");
  assert.equal(trades[0].buyAmount, 10_000_000);
  assert.equal(trades[0].sellAmount, 28_000_000);
  assert.equal(trades[0].profit, 18_000_000);
  assert.equal(totals.realizedProfit, 18_000_000);
  assert.equal(totals.knownTradeCount, 1);
  assert.equal(totals.tradeCount, 1);
});

test("#1107 · tab vises som negativ profit", () => {
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 20_000_000, date: "2026-01-01T10:00:00Z" }),
    auctionEvent({ rider: RIDER_A, direction: "out", amount: 12_000_000, date: "2026-03-01T10:00:00Z" }),
  ]);
  assert.equal(trades[0].profit, -8_000_000);
  assert.equal(totals.realizedProfit, -8_000_000);
});

test("#1107 · salg uden forudgående køb i historikken = ukendt købspris (profit null, ikke 0)", () => {
  // Fx start-trup-rytter solgt: intet køb i historikken.
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "out", amount: 5_000_000, date: "2026-02-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].buyAmount, null);
  assert.equal(trades[0].profit, null);
  // Ukendte køb må ikke forurene totalen som "gratis" køb.
  assert.equal(totals.realizedProfit, 0);
  assert.equal(totals.knownTradeCount, 0);
  assert.equal(totals.tradeCount, 1);
});

test("#1107 · rytter erhvervet via swap og solgt kontant = ukendt købspris", () => {
  const { trades } = computeTransferProfit([
    {
      id: "swap:1", type: "swap", direction: "swap", cash_flow: null,
      date: "2026-01-15T10:00:00Z",
      rider: RIDER_A, // modtaget rytter
      rider_swapped: RIDER_B, // afgivet rytter
      counterparty: { id: "t-x", name: "Modpart", is_ai: false },
      amount: 0, status: "accepted", season_number: 1,
    },
    auctionEvent({ rider: RIDER_A, direction: "out", amount: 9_000_000, date: "2026-04-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].rider.id, "r-a");
  assert.equal(trades[0].buyAmount, null);
  assert.equal(trades[0].profit, null);
});

test("#1107 · rytter afgivet via swap giver ingen profit-række og rydder købet", () => {
  const { trades } = computeTransferProfit([
    auctionEvent({ rider: RIDER_B, direction: "in", amount: 7_000_000, date: "2026-01-01T10:00:00Z" }),
    {
      id: "swap:2", type: "swap", direction: "swap", cash_flow: null,
      date: "2026-02-01T10:00:00Z",
      rider: RIDER_A, rider_swapped: RIDER_B,
      counterparty: { id: "t-x", name: "Modpart", is_ai: false },
      amount: 0, status: "accepted", season_number: 1,
    },
    // B kommer senere tilbage og sælges — det gamle 7M-køb må IKKE parres
    // med det nye salg (B forlod holdet via swappen).
    auctionEvent({ rider: RIDER_B, direction: "out", amount: 11_000_000, date: "2026-05-01T10:00:00Z" }),
  ]);
  const bTrades = trades.filter((t) => t.rider.id === "r-b");
  assert.equal(bTrades.length, 1);
  assert.equal(bTrades[0].buyAmount, null);
  assert.equal(bTrades[0].profit, null);
});

test("#785 · no_sale-auktion (amount null) bliver aldrig til et salgs-ben", () => {
  // Backend sender no_sale: true + amount: null for auktioner uden bud —
  // tidligere lå den umødte startpris i amount og kunne blive et fantom-salg.
  const noSaleEvent = {
    ...auctionEvent({ rider: RIDER_A, direction: "out", amount: 0, date: "2026-02-01T10:00:00Z" }),
    amount: null,
    no_sale: true,
  };
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 4_000_000, date: "2026-01-01T10:00:00Z" }),
    noSaleEvent,
    transferEvent({ rider: RIDER_A, direction: "out", amount: 6_000_000, date: "2026-03-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1, "no_sale-event må ikke skabe en handel");
  assert.equal(trades[0].sellAmount, 6_000_000);
  assert.equal(trades[0].profit, 2_000_000);
  assert.equal(totals.tradeCount, 1);
});

test("#1107 · gennemført auktion uden bud (amount 0) er ikke et salg", () => {
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 4_000_000, date: "2026-01-01T10:00:00Z" }),
    // Auktion udløb uden bud — rytteren blev på holdet.
    auctionEvent({ rider: RIDER_A, direction: "out", amount: 0, date: "2026-02-01T10:00:00Z" }),
    // Senere ægte salg parres stadig med købet.
    transferEvent({ rider: RIDER_A, direction: "out", amount: 6_000_000, date: "2026-03-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].buyAmount, 4_000_000);
  assert.equal(trades[0].profit, 2_000_000);
  assert.equal(totals.tradeCount, 1);
});

test("#1107 · loan ændrer ikke ejerskab og giver ingen handler", () => {
  const { trades } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 3_000_000, date: "2026-01-01T10:00:00Z" }),
    {
      id: "loan:1", type: "loan", direction: "out", cash_flow: "in",
      date: "2026-02-01T10:00:00Z", rider: RIDER_A,
      counterparty: { id: "t-x", name: "Modpart", is_ai: false },
      amount: 500_000, start_season: 1, end_season: 1, loan_status: "active", season_number: 1,
    },
    transferEvent({ rider: RIDER_A, direction: "out", amount: 5_000_000, date: "2026-03-01T10:00:00Z" }),
  ]);
  assert.equal(trades.length, 1);
  // Loan-fee må ikke blive til hverken køb eller salg.
  assert.equal(trades[0].buyAmount, 3_000_000);
  assert.equal(trades[0].sellAmount, 5_000_000);
});

test("#1107 · samme rytter handlet flere gange giver flere rækker, nyeste salg først", () => {
  const { trades, totals } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 2_000_000, date: "2026-01-01T10:00:00Z", season: 1 }),
    transferEvent({ rider: RIDER_A, direction: "out", amount: 3_000_000, date: "2026-02-01T10:00:00Z", season: 1 }),
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 4_000_000, date: "2026-03-01T10:00:00Z", season: 2 }),
    transferEvent({ rider: RIDER_A, direction: "out", amount: 10_000_000, date: "2026-04-01T10:00:00Z", season: 2 }),
  ]);
  assert.equal(trades.length, 2);
  // Nyeste salg først.
  assert.equal(trades[0].sellAmount, 10_000_000);
  assert.equal(trades[0].profit, 6_000_000);
  assert.equal(trades[1].sellAmount, 3_000_000);
  assert.equal(trades[1].profit, 1_000_000);
  assert.equal(totals.realizedProfit, 7_000_000);
  assert.equal(totals.knownTradeCount, 2);
});

test("#1107 · multi-sæson: køb i sæson 1, salg i sæson 2 parres på tværs af sæsoner", () => {
  const { trades } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 1_000_000, date: "2026-01-01T10:00:00Z", season: 1 }),
    auctionEvent({ rider: RIDER_A, direction: "out", amount: 19_000_000, date: "2026-09-01T10:00:00Z", season: 2 }),
  ]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].profit, 18_000_000);
  assert.equal(trades[0].sellSeasonNumber, 2);
});

test("#1107 · gratis transfer ind (amount 0) er et kendt køb til 0, ikke ukendt", () => {
  const { trades, totals } = computeTransferProfit([
    transferEvent({ rider: RIDER_A, direction: "in", amount: 0, date: "2026-01-01T10:00:00Z" }),
    transferEvent({ rider: RIDER_A, direction: "out", amount: 2_000_000, date: "2026-02-01T10:00:00Z" }),
  ]);
  assert.equal(trades[0].buyAmount, 0);
  assert.equal(trades[0].profit, 2_000_000);
  assert.equal(totals.knownTradeCount, 1);
});

test("#1107 · events uden rytter eller tom liste håndteres uden fejl", () => {
  assert.deepEqual(computeTransferProfit([]).trades, []);
  assert.deepEqual(computeTransferProfit(null).trades, []);
  const { trades } = computeTransferProfit([
    auctionEvent({ rider: RIDER_A, direction: "in", amount: 1, date: "2026-01-01T10:00:00Z" }),
    { id: "auction:x", type: "auction", direction: "out", date: "2026-02-01T10:00:00Z", rider: null, amount: 5 },
  ]);
  assert.equal(trades.length, 0);
});
