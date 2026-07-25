import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2763 — "Sæson 0" (åbne-beta-fasens bogførings-sæson, 0 løb, seasons.number=0)
// lækkede i tre spillervendte sæson-vælgere: SeasonEndPage, FinancePage
// (Historik-fanen) og RacesPage (Bibliotek-fanen). #2600 fixede samme læk i
// GET /peak-plans/board + GET /races/calendar via `.gt("number", 0)` på
// backend-siden; disse tre sider henter i stedet direkte via supabase-js
// client-side, så samme diskriminator skal genbruges der.
//
// Kildekode-strukturel test (samme mønster som FinancePage.loadStates.test.js)
// — repoet kører `node --test` uden DOM-renderer, så vi guard'er invarianten
// i kilden i stedet for at rendere komponenten.

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  { file: "SeasonEndPage.jsx", label: "SeasonEndPage (sæson-vælgeren i headeren)" },
  { file: "FinancePage.jsx", label: "FinancePage (Historik-fanens sæson-vælger)" },
  { file: "RacesPage.jsx", label: "RacesPage (Bibliotek-fanens sæson-vælger)" },
];

for (const { file, label } of PAGES) {
  test(`#2763 ${label} filtrerer sæson 0 fra med .gt("number", 0)`, () => {
    const source = readFileSync(join(__dirname, file), "utf8");
    // Isolér blokke der henter fra "seasons" og bygger en ordnet liste
    // (order("number", ...)) — det er signaturen på en vælger-kilde, til
    // forskel fra et enkelt aktiv-sæson-opslag (.eq("status","active").single()).
    const seasonListBlocks = [...source.matchAll(/from\("seasons"\)[\s\S]{0,160}?order\(\s*"number"/g)];
    assert.ok(
      seasonListBlocks.length > 0,
      `${file}: forventede mindst én seasons-liste-query (order by number) — testen er forældet hvis hentningen er refaktoreret`,
    );
    for (const match of seasonListBlocks) {
      assert.match(
        match[0],
        /\.gt\(\s*["']number["']\s*,\s*0\s*\)/,
        `${file}: en seasons-liste-query mangler .gt("number", 0) — sæson 0 kan lække i vælgeren igen (#2763)`,
      );
    }
  });
}
