import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #231 — AuctionsPage queryer Supabase direkte (ikke /api/auctions). De fire
// felter herunder rendres i AuctionRow + AuctionCard og MUST være i select-listen,
// ellers ses "—" i Løn/Alder/Flag/Potentiale-kolonnerne. Bug 2026-05-09: salary
// var faldet ud af select-listen. Test holder os ærlige hvis nogen fjerner et felt igen.

const __dirname = dirname(fileURLToPath(import.meta.url));
const auctionsPageSource = readFileSync(join(__dirname, "AuctionsPage.jsx"), "utf8");

const riderSelect = auctionsPageSource.match(/rider:rider_id\(([^)]*)\)/);

test("AuctionsPage rider-select indeholder felter brugt i UI (#231)", () => {
  assert.ok(riderSelect, "rider:rider_id(...) select-list skal kunne findes");
  const fields = riderSelect[1];
  for (const required of ["salary", "birthdate", "nationality_code", "potentiale"]) {
    assert.match(
      fields,
      new RegExp(`\\b${required}\\b`),
      `rider-select mangler '${required}' — felt rendres i AuctionRow/AuctionCard og bliver "—" hvis det fjernes`,
    );
  }
});
