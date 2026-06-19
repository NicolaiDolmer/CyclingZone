import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #231 — AuctionsPage queryer Supabase direkte (ikke /api/auctions). Felterne
// herunder rendres i AuctionRow + AuctionCard og MUST være i select-listen,
// ellers ses "—" i Løn/Alder/Flag-kolonnerne. Bug 2026-05-09: salary
// var faldet ud af select-listen. Test holder os ærlige hvis nogen fjerner et felt igen.
//
// #1162 — `potentiale` er flyttet den MODSATTE vej: kolonnen er server-skjult
// (column privilege i Supabase), så den må ALDRIG optræde i select-listen igen.
// Potentiale-visningen kommer fra POST /api/scouting/estimates (maskeret estimat).
//
// #1529 — stat-kolonnerne er migreret fra de 14 PCM stat_*-felter til de 15 CZ-
// evner, som hentes via et nested rider_derived_abilities(...)-join (ABILITY_SELECT)
// og flades op på rider med flattenAbilities. De gamle stat_*-felter må ALDRIG
// optræde i rider-select-listen igen.

const __dirname = dirname(fileURLToPath(import.meta.url));
const auctionsPageSource = readFileSync(join(__dirname, "AuctionsPage.jsx"), "utf8");

// rider:rider_id(...) embedder evnerne via et ${ABILITY_SELECT}-interpolations-
// token (ikke literal kolonner i kildeteksten), så det inderste join har ingen
// literal parenteser her — [^)]* matcher derfor stadig frem til select-listens `)`.
const riderSelect = auctionsPageSource.match(/rider:rider_id\(([^)]*)\)/);

test("AuctionsPage rider-select indeholder felter brugt i UI (#231)", () => {
  assert.ok(riderSelect, "rider:rider_id(...) select-list skal kunne findes");
  const fields = riderSelect[1];
  for (const required of ["salary", "contract_length", "contract_end_season", "birthdate", "nationality_code"]) {
    assert.match(
      fields,
      new RegExp(`\\b${required}\\b`),
      `rider-select mangler '${required}' — felt rendres i AuctionRow/AuctionCard og bliver "—" hvis det fjernes`,
    );
  }
});

test("AuctionsPage rider-select må IKKE indeholde potentiale (#1162)", () => {
  assert.ok(riderSelect, "rider:rider_id(...) select-list skal kunne findes");
  assert.doesNotMatch(
    riderSelect[1],
    /\bpotentiale\b/,
    "potentiale er server-skjult (column privilege) — et select på den fejler HELE kaldet i PostgREST",
  );
});

test("AuctionsPage rider-select henter de nye CZ-evner via ABILITY_SELECT-join (#1529)", () => {
  assert.ok(riderSelect, "rider:rider_id(...) select-list skal kunne findes");
  assert.match(
    riderSelect[1],
    /\$\{ABILITY_SELECT\}/,
    "rider-select skal embedde ${ABILITY_SELECT} (rider_derived_abilities-join) — evne-kolonnerne rendres i stat-kolonnerne",
  );
});

test("AuctionsPage rider-select må IKKE indeholde de gamle PCM stat_*-felter (#1529)", () => {
  assert.ok(riderSelect, "rider:rider_id(...) select-list skal kunne findes");
  assert.doesNotMatch(
    riderSelect[1],
    /\bstat_(fl|bj|kb|bk|tt|prl|bro|sp|acc|ned|udh|mod|res|ftr)\b/,
    "stat_* PCM-kolonnerne er udgået af visningen — evnerne hentes nu via rider_derived_abilities",
  );
});
