import { test } from "node:test";
import assert from "node:assert/strict";
import { sortListings, LISTING_SORT_OPTIONS, ABILITY_SORT_KEYS } from "./transferListingSort.js";
import { ABILITY_KEYS } from "./abilities.js";

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

test("LISTING_SORT_OPTIONS matcher de understøttede nøgler (#1755: + alder, #2031: + værdi + evner)", () => {
  assert.deepEqual(LISTING_SORT_OPTIONS, [
    "newest", "price_asc", "price_desc", "value_desc", "value_asc", "age_asc", "age_desc",
    "ability_climbing", "ability_tempo", "ability_punch", "ability_sprint", "ability_acceleration",
    "ability_flat", "ability_time_trial", "ability_endurance", "ability_durability", "ability_recovery",
    "ability_aggression", "ability_tactics", "ability_descending", "ability_cobblestone", "ability_positioning",
  ]);
});

test("ABILITY_SORT_KEYS = ability_<key> for hver af de 15 evner i SSOT-rækkefølge", () => {
  assert.deepEqual(ABILITY_SORT_KEYS, ABILITY_KEYS.map(k => `ability_${k}`));
  assert.equal(ABILITY_SORT_KEYS.length, 15);
});

// #1755 — alders-sort på rytter-niveau (listing.rider.birthdate). Transferlisten
// kunne tidligere kun sorteres på pris/dato; universel-sortering kræver alder.
const ageListings = [
  { id: "young", asking_price: 1, created_at: "2026-06-01T10:00:00Z", rider: { birthdate: "2004-01-01" } },
  { id: "old",   asking_price: 1, created_at: "2026-06-01T10:00:00Z", rider: { birthdate: "1992-01-01" } },
  { id: "mid",   asking_price: 1, created_at: "2026-06-01T10:00:00Z", rider: { birthdate: "1998-01-01" } },
  // ingen rytter/fødselsdato → falder bagest i begge retninger
  { id: "unknown", asking_price: 1, created_at: "2026-06-01T10:00:00Z" },
];

test("age_asc — yngste rytter først, ukendt alder bagest", () => {
  assert.deepEqual(sortListings(ageListings, "age_asc").map(l => l.id), ["young", "mid", "old", "unknown"]);
});

test("age_desc — ældste rytter først, ukendt alder bagest", () => {
  assert.deepEqual(sortListings(ageListings, "age_desc").map(l => l.id), ["old", "mid", "young", "unknown"]);
});

// #2031 — markedsværdi-sort (rytter-niveau via getRiderMarketValue → market_value
// med base_value/fallback). Listings uden rytter får fallback-værdien (1000).
const valueListings = [
  { id: "cheap", created_at: "2026-06-01T10:00:00Z", rider: { market_value: 5000 } },
  { id: "rich",  created_at: "2026-06-01T10:00:00Z", rider: { market_value: 900000 } },
  { id: "mid",   created_at: "2026-06-01T10:00:00Z", rider: { market_value: 120000 } },
];

test("value_desc — dyreste rytter (markedsværdi) først", () => {
  assert.deepEqual(sortListings(valueListings, "value_desc").map(l => l.id), ["rich", "mid", "cheap"]);
});

test("value_asc — billigste rytter (markedsværdi) først", () => {
  assert.deepEqual(sortListings(valueListings, "value_asc").map(l => l.id), ["cheap", "mid", "rich"]);
});

// #2031 — evne-sort. Evnerne er fladtgjort op på listing.rider[<key>] ved load.
// Numerisk, højest først; manglende rytter/evne bagest.
const abilityListings = [
  { id: "lowclimb",  created_at: "2026-06-01T10:00:00Z", rider: { climbing: 40, sprint: 90 } },
  { id: "highclimb", created_at: "2026-06-01T10:00:00Z", rider: { climbing: 88, sprint: 30 } },
  { id: "midclimb",  created_at: "2026-06-01T10:00:00Z", rider: { climbing: 65, sprint: 55 } },
  // ingen evne-felt → falder bagest uanset retning
  { id: "noability", created_at: "2026-06-01T10:00:00Z", rider: { firstname: "X" } },
  // ingen rytter overhovedet → også bagest
  { id: "norider",   created_at: "2026-06-01T10:00:00Z" },
];

test("ability_climbing — højeste climbing først, ukendt bagest", () => {
  const ids = sortListings(abilityListings, "ability_climbing").map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ["highclimb", "midclimb", "lowclimb"]);
  // de to uden climbing-værdi falder bagest (rækkefølgen mellem dem er ligegyldig)
  assert.deepEqual([...ids.slice(3)].sort(), ["noability", "norider"]);
});

test("ability_sprint — sorterer på en ANDEN evne end climbing", () => {
  const ids = sortListings(abilityListings, "ability_sprint").map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ["lowclimb", "midclimb", "highclimb"]);
});

test("ukendt evne-nøgle falder tilbage til newest", () => {
  assert.deepEqual(
    sortListings(abilityListings, "ability_notarealability").map(l => l.id),
    sortListings(abilityListings, "newest").map(l => l.id)
  );
});
