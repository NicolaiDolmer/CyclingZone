import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTransferHistoryNoSale } from "./transferHistoryNoSale.js";

// #2400 — transferhistorik fyldt med "ingen salg"-auktioner (Discord-feedback:
// "is there a reason that 'no sale' auctions turn up in transfer history?").

const events = [
  { id: "auction:1", type: "auction", no_sale: false },
  { id: "auction:2", type: "auction", no_sale: true },
  { id: "transfer:3", type: "transfer" }, // no_sale undefined (transfer/swap/academy events har ikke feltet)
  { id: "auction:4", type: "auction", no_sale: true },
];

test("showNoSale=false (default): filtrerer no_sale-events fra og tæller dem", () => {
  const { visible, hiddenCount } = filterTransferHistoryNoSale(events, false);
  assert.deepEqual(visible.map((e) => e.id), ["auction:1", "transfer:3"]);
  assert.equal(hiddenCount, 2);
});

test("showNoSale=true: viser alt, hiddenCount er 0", () => {
  const { visible, hiddenCount } = filterTransferHistoryNoSale(events, true);
  assert.equal(visible.length, 4);
  assert.equal(hiddenCount, 0);
});

test("events uden no_sale-felt (transfer/swap/academy) regnes aldrig som no_sale", () => {
  const { visible } = filterTransferHistoryNoSale([{ id: "swap:1", type: "swap" }], false);
  assert.equal(visible.length, 1);
});

test("tom liste og undefined/null input giver tomt resultat uden at kaste", () => {
  assert.deepEqual(filterTransferHistoryNoSale([], false), { visible: [], hiddenCount: 0 });
  assert.deepEqual(filterTransferHistoryNoSale(undefined, false), { visible: [], hiddenCount: 0 });
  assert.deepEqual(filterTransferHistoryNoSale(null, true), { visible: [], hiddenCount: 0 });
});

test("kun no_sale-events i listen: visible tom, hiddenCount === listens længde (understøtter emptyDueToHiddenNoSaleOnly)", () => {
  const onlyNoSale = [
    { id: "auction:1", no_sale: true },
    { id: "auction:2", no_sale: true },
  ];
  const { visible, hiddenCount } = filterTransferHistoryNoSale(onlyNoSale, false);
  assert.equal(visible.length, 0);
  assert.equal(hiddenCount, onlyNoSale.length);
});
