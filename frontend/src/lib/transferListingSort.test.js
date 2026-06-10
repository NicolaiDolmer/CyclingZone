import { test } from "node:test";
import assert from "node:assert/strict";
import { sortListings, LISTING_SORT_OPTIONS } from "./transferListingSort.js";

// #1185: sortér transferlistens market-tab på listing-pris. Sorteringen skal
// ske på asking_price (listing-niveau) — IKKE rytterens market_value, som
// useClientRiderFilters sorterer på men som ikke styrer listing-rækkefølgen.

const listings = [
  { id: "a", asking_price: 50000, created_at: "2026-06-01T10:00:00Z" },
  { id: "b", asking_price: 200000, created_at: "2026-06-03T10:00:00Z" },
  { id: "c", asking_price: 1000, created_at: "2026-06-02T10:00:00Z" },
  // asking_price mangler (defensivt) → behandles som 0
  { id: "d", created_at: "2026-06-04T10:00:00Z" },
];

test("price_asc — billigste først, manglende pris som 0", () => {
  const sorted = sortListings(listings, "price_asc");
  assert.deepEqual(sorted.map(l => l.id), ["d", "c", "a", "b"]);
});

test("price_desc — dyreste først", () => {
  const sorted = sortListings(listings, "price_desc");
  assert.deepEqual(sorted.map(l => l.id), ["b", "a", "c", "d"]);
});

test("newest (default) — nyeste created_at først", () => {
  assert.deepEqual(sortListings(listings).map(l => l.id), ["d", "b", "c", "a"]);
  assert.deepEqual(sortListings(listings, "newest").map(l => l.id), ["d", "b", "c", "a"]);
});

test("muterer ikke input og tåler null/ukendt sort-nøgle", () => {
  const before = listings.map(l => l.id);
  sortListings(listings, "price_desc");
  assert.deepEqual(listings.map(l => l.id), before);
  assert.deepEqual(sortListings(null, "price_asc"), []);
  // ukendt nøgle falder tilbage til newest
  assert.deepEqual(sortListings(listings, "garbage").map(l => l.id), ["d", "b", "c", "a"]);
});

test("LISTING_SORT_OPTIONS matcher de tre understøttede nøgler", () => {
  assert.deepEqual(LISTING_SORT_OPTIONS, ["newest", "price_asc", "price_desc"]);
});
