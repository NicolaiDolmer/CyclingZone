import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3067 — "Sælger"-kolonnens header var en almindelig <th> (ingen onSort) midt i
// en række sorterbare SortTh-headers med samme TH_BASE-typografi. Spillerne
// forsøgte at sortere på den ligesom naboerne (Højeste bud, Tid tilbage) og fik
// intet respons — 12 rage clicks, højeste tæthed i appen (Clarity 21-27/7).
// Source-contract test i samme stil som AuctionsPage.fields.test.js: beviser at
// headeren nu ER en rigtig SortTh, og at auktions-sort-domænet (samme gren som
// current_price/calculated_end) nu også kender "seller".

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "AuctionsPage.jsx"), "utf8");

test("Sælger-kolonnens header er en SortTh med sortKey=\"seller\" og onSort, ikke en død <th>", () => {
  assert.doesNotMatch(
    src,
    /<th className=\{`[^`]*\$\{TH_BASE\}`\}>\{t\("table\.seller"\)\}<\/th>/,
    "table.seller må ikke længere rendres som en almindelig, ikke-klikbar <th>",
  );
  assert.match(
    src,
    /<SortTh sortKey="seller"[^>]*onSort=\{handleSort\}/,
    "table.seller skal rendres via SortTh med onSort={handleSort}, som de andre kolonner",
  );
});

test("seller regnes som auktions-niveau sort-nøgle i handleSort/activeSort/activeSortDir (samme gren som current_price/calculated_end)", () => {
  for (const fn of ["handleSort", "activeSort", "activeSortDir"]) {
    const start = src.indexOf(`function ${fn}(key)`);
    assert.notEqual(start, -1, `function ${fn}(key) findes ikke`);
    const end = src.indexOf("\n  }", start);
    const block = src.slice(start, end);
    assert.match(
      block,
      /key === "current_price" \|\| key === "calculated_end" \|\| key === "seller"/,
      `${fn} skal behandle "seller" i samme gren som current_price/calculated_end`,
    );
  }
});

test("applyAuctionSort håndterer seller-nøglen alfabetisk via getAuctionSellerLabel", () => {
  const start = src.indexOf("function applyAuctionSort(list, auctionSort)");
  assert.notEqual(start, -1, "applyAuctionSort findes ikke");
  const end = src.indexOf("\n}", start);
  const block = src.slice(start, end);
  assert.match(block, /auctionSort\.key === "seller"/);
  assert.match(block, /getAuctionSellerLabel\(a\)\.localeCompare\(getAuctionSellerLabel\(b\)/);
});
