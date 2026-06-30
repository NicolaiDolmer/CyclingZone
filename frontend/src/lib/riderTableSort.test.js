import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRidersForTable } from "./riderTableSort.js";

// #1092 regression: værdi-sortering på TeamProfilePage (Liga→Hold→Trup) skal
// sortere på den VISTE værdi (getRiderMarketValue), præcis som "Mit Hold"
// (useRiderFilters' sort === "value"-gren). Før #1101-cutover sorterede siden
// på den frosne uci_points-kolonne mens cellen viste market value → forkert
// rækkefølge. Den generiske `r[key] || 0`-sortering må aldrig genindføres for
// værdi-kolonnen.

const riders = [
  { id: "a", firstname: "Anna", lastname: "Zander", market_value: 50000, stat_sp: 70, nationality_code: "ch" },
  { id: "b", firstname: "Bo", lastname: "Mikkelsen", market_value: 120000, stat_sp: 55, nationality_code: "dk" },
  // Ingen market_value fra DB → UI viser fallback base_value + bonus (65000).
  // Den gamle inline-sortering (`r.market_value || 0`) behandlede den som 0.
  { id: "c", firstname: "Carl", lastname: "Astrup", base_value: 50000, prize_earnings_bonus: 15000, stat_sp: 80, nationality_code: "de" },
  // Frossen uci_points må ALDRIG påvirke værdi-sortering (#1092 rod-årsag).
  { id: "d", firstname: "Dan", lastname: "Quist", market_value: 1000, uci_points: 99999, stat_sp: 60, nationality_code: "fr" },
];

test("market_value desc — sorterer på vist værdi, ikke rå kolonne", () => {
  const sorted = sortRidersForTable(riders, { key: "market_value", dir: "desc" });
  assert.deepEqual(sorted.map(r => r.id), ["b", "c", "a", "d"]);
});

test("market_value asc — omvendt rækkefølge af desc", () => {
  const sorted = sortRidersForTable(riders, { key: "market_value", dir: "asc" });
  assert.deepEqual(sorted.map(r => r.id), ["d", "a", "c", "b"]);
});

test("market_value — fallback-rytter (base_value + bonus) sorteres som vist, ikke som 0", () => {
  const sorted = sortRidersForTable(riders, { key: "market_value", dir: "desc" });
  const idxFallback = sorted.findIndex(r => r.id === "c");
  const idxLow = sorted.findIndex(r => r.id === "a");
  assert.ok(idxFallback < idxLow, "fallback-værdi 65000 skal stå før 50000");
});

test("firstname — sorterer på efternavn + fornavn i begge retninger", () => {
  const asc = sortRidersForTable(riders, { key: "firstname", dir: "asc" });
  assert.deepEqual(asc.map(r => r.lastname), ["Astrup", "Mikkelsen", "Quist", "Zander"]);
  const desc = sortRidersForTable(riders, { key: "firstname", dir: "desc" });
  assert.deepEqual(desc.map(r => r.lastname), ["Zander", "Quist", "Mikkelsen", "Astrup"]);
});

test("stat-kolonner — generisk numerisk sortering med 0-fallback", () => {
  const sorted = sortRidersForTable(riders, { key: "stat_sp", dir: "desc" });
  assert.deepEqual(sorted.map(r => r.stat_sp), [80, 70, 60, 55]);
  const withMissing = sortRidersForTable([...riders, { id: "e", lastname: "X", firstname: "Y" }], { key: "stat_sp", dir: "asc" });
  assert.equal(withMissing[0].id, "e");
});

test("nationality_code — sorterer på vist IOC-kode, ikke rå ISO2 (#802)", () => {
  // ISO2-orden ville give CH(a) < DE(c) < DK(b) < FR(d); IOC: DEN < FRA < GER < SUI.
  const asc = sortRidersForTable(riders, { key: "nationality_code", dir: "asc" });
  assert.deepEqual(asc.map(r => r.id), ["b", "d", "c", "a"]);
  const desc = sortRidersForTable(riders, { key: "nationality_code", dir: "desc" });
  assert.deepEqual(desc.map(r => r.id), ["a", "c", "d", "b"]);
});

test("nationality_code — rytter uden nation sorterer sidst i asc", () => {
  const withMissing = sortRidersForTable(
    [...riders, { id: "e", firstname: "Ed", lastname: "Nyt" }],
    { key: "nationality_code", dir: "asc" });
  assert.equal(withMissing[withMissing.length - 1].id, "e");
});

// #1755 — alder + ryttertype skal kunne sorteres i de filter-løse trup-tabeller
// (andre holds trup) præcis som på rytterdatabasen, så sweepet er universelt.
const ageTypeRiders = [
  { id: "old",   firstname: "O", lastname: "O", birthdate: "1992-01-01", primary_type: "sprinter" },
  { id: "young", firstname: "Y", lastname: "Y", birthdate: "2004-01-01", primary_type: "climber" },
  { id: "mid",   firstname: "M", lastname: "M", birthdate: "1998-01-01", primary_type: "allrounder" },
];

test("birthdate desc — ældste først (lavest fødselsår), default klik-retning", () => {
  const sorted = sortRidersForTable(ageTypeRiders, { key: "birthdate", dir: "desc" });
  assert.deepEqual(sorted.map(r => r.id), ["young", "mid", "old"]);
});

test("birthdate asc — yngste først; manglende fødselsdato i ældste ende", () => {
  const sorted = sortRidersForTable(ageTypeRiders, { key: "birthdate", dir: "asc" });
  assert.deepEqual(sorted.map(r => r.id), ["old", "mid", "young"]);
  const withMissing = sortRidersForTable(
    [...ageTypeRiders, { id: "unknown", firstname: "U", lastname: "U" }],
    { key: "birthdate", dir: "asc" });
  // 1970-fallback = ældst → først i asc (yngste-først).
  assert.equal(withMissing[0].id, "unknown");
});

test("primary_type — alfabetisk på primær type i begge retninger", () => {
  const asc = sortRidersForTable(ageTypeRiders, { key: "primary_type", dir: "asc" });
  assert.deepEqual(asc.map(r => r.primary_type), ["allrounder", "climber", "sprinter"]);
  const desc = sortRidersForTable(ageTypeRiders, { key: "primary_type", dir: "desc" });
  assert.deepEqual(desc.map(r => r.primary_type), ["sprinter", "climber", "allrounder"]);
});

// #1950 — navne-sortering skal være collation-stabil og matche Postgres
// .order('lastname') (literal 'aa'). Bar localeCompare() i en dansk browser
// resolver til da-DK og behandler 'aa' som 'å' → 'Aamodt' ville ende SIDST,
// så DB-listen og klient-listen var uenige. Pinnet til 'en': 'aa' sorteres
// bogstaveligt og 'Aamodt'/'Saadi' står FØR 'Sato'.
const collationRiders = [
  { id: "sato",   firstname: "S", lastname: "Sato" },
  { id: "aamodt", firstname: "A", lastname: "Aamodt" },
  { id: "saadi",  firstname: "S", lastname: "Saadi" },
];

test("firstname — 'aa' sorteres bogstaveligt (Aamodt/Saadi før Sato), ikke som 'å'", () => {
  const asc = sortRidersForTable(collationRiders, { key: "firstname", dir: "asc" });
  assert.deepEqual(asc.map(r => r.lastname), ["Aamodt", "Saadi", "Sato"]);
});

test("muterer ikke input-arrayet", () => {
  const input = [...riders];
  sortRidersForTable(input, { key: "market_value", dir: "asc" });
  assert.deepEqual(input.map(r => r.id), riders.map(r => r.id));
});
