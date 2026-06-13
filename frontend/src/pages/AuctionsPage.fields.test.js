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

const __dirname = dirname(fileURLToPath(import.meta.url));
const auctionsPageSource = readFileSync(join(__dirname, "AuctionsPage.jsx"), "utf8");

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
