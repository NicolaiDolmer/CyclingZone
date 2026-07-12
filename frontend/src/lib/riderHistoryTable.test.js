import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistoryRows, historyRowAmount } from "./riderHistoryTable.js";

test("buildHistoryRows normaliserer event-typer og sorterer nyeste først", () => {
  const rows = buildHistoryRows({
    events: [
      { type: "transfer", date: "2026-06-01T10:00:00Z", price: 5000 },
      { type: "auction", date: "2026-06-10T10:00:00Z", price: 9000, no_sale: false },
    ],
  });
  assert.deepEqual(rows.map((r) => r.kind), ["auction", "transfer"]);
});

test("no_sale-auktioner får egen kind (ingen antydet handel)", () => {
  const rows = buildHistoryRows({ events: [{ type: "auction", date: "2026-06-01", no_sale: true, price: null }] });
  assert.equal(rows[0].kind, "auction_no_sale");
  assert.equal(historyRowAmount(rows[0]), null);
});

test("bud fra bid-timelinen flettes ind som bid-rækker", () => {
  const rows = buildHistoryRows({
    events: [{ type: "auction", date: "2026-06-10T12:00:00Z", price: 9000 }],
    bidTimeline: {
      bid_timeline: [
        { bid_time: "2026-06-10T11:00:00Z", amount: 8000, team_id: "t1", team_name: "Helios CC", is_proxy: false },
        { bid_time: "2026-06-10T11:30:00Z", amount: 9000, team_id: "t2", team_name: "Atlas Racing", is_proxy: true },
      ],
    },
  });
  assert.deepEqual(rows.map((r) => r.kind), ["auction", "bid", "bid"]);
  assert.equal(rows[1].team_name, "Atlas Racing");
  assert.equal(rows[1].is_proxy, true);
  assert.equal(historyRowAmount(rows[1]), 9000);
});

test("ukendte event-typer filtreres, rækker uden dato ryger sidst", () => {
  const rows = buildHistoryRows({
    events: [
      { type: "mystery", date: "2026-06-01" },
      { type: "swap", date: null, cash_adjustment: 0 },
      { type: "transfer", date: "2026-06-05", price: 100 },
    ],
  });
  assert.deepEqual(rows.map((r) => r.kind), ["transfer", "swap"]);
  assert.equal(historyRowAmount(rows[1]), null, "cash_adjustment 0 vises som —");
});

test("beløbs-mapping pr. kind", () => {
  assert.equal(historyRowAmount({ kind: "auction", price: 1200 }), 1200);
  assert.equal(historyRowAmount({ kind: "bid", amount: 800 }), 800);
  assert.equal(historyRowAmount({ kind: "transfer", price: 700 }), 700);
  assert.equal(historyRowAmount({ kind: "swap", cash_adjustment: -250 }), -250);
});

test("tom input giver tom liste", () => {
  assert.deepEqual(buildHistoryRows({}), []);
  assert.deepEqual(buildHistoryRows(), []);
});
