import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuctionHistorySort, ALLOWED_AUCTION_HISTORY_SORT_KEYS } from "./auctionHistorySort.js";

test("resolveAuctionHistorySort accepts a whitelisted key + valid dir", () => {
  assert.deepEqual(resolveAuctionHistorySort("current_price", "asc"), { sort: "current_price", dir: "asc" });
  assert.deepEqual(resolveAuctionHistorySort("actual_end", "asc"), { sort: "actual_end", dir: "asc" });
});

test("resolveAuctionHistorySort falls back to default on missing params", () => {
  assert.deepEqual(resolveAuctionHistorySort(undefined, undefined), { sort: "actual_end", dir: "desc" });
  assert.deepEqual(resolveAuctionHistorySort(null, null), { sort: "actual_end", dir: "desc" });
});

test("resolveAuctionHistorySort rejects non-whitelisted keys (nation/rider/status/etc are not server-sortable)", () => {
  for (const bad of ["nation", "rider", "status", "winner", "seller", "bids", "'; drop table auctions;--"]) {
    assert.deepEqual(resolveAuctionHistorySort(bad, "asc"), { sort: "actual_end", dir: "asc" }, `key "${bad}" should fall back to default sort key`);
  }
});

test("resolveAuctionHistorySort rejects an invalid direction", () => {
  assert.deepEqual(resolveAuctionHistorySort("current_price", "sideways"), { sort: "current_price", dir: "desc" });
  assert.deepEqual(resolveAuctionHistorySort("current_price", undefined), { sort: "current_price", dir: "desc" });
});

test("whitelist only exposes direct, meaningfully-sortable auctions columns", () => {
  assert.deepEqual(ALLOWED_AUCTION_HISTORY_SORT_KEYS, ["actual_end", "current_price"]);
});
