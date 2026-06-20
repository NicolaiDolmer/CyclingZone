import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1592 — nye spillere kunne ikke afkode de 15 evne-koder (CLM/TT/FLT/…) i
// kolonne-overskrifterne, hvilket blokerede det første rytter-valg. Fixen gav
// hver stat-header en `title`-tooltip med det fulde navn + en kollapsbar legende.
// Forward-guard (samme kilde-tekst-mønster som RidersPage.statBar/columns):
// fanger hvis nogen ruller tooltips eller legenden tilbage.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "RidersPage.jsx"), "utf8");

test("stat-headers har en title-tooltip med det fulde evne-navn (#1592)", () => {
  assert.match(
    src,
    /title=\{tRider\(`racePreview\.derived\.\$\{key\}`\)\}/,
    "hver stat-SortTh skal have title={tRider(`racePreview.derived.${key}`)} så koden kan afkodes ved hover",
  );
});

test("der findes en kollapsbar evne-legende der mapper alle 15 koder (#1592)", () => {
  assert.match(
    src,
    /function AbilityLegend\(/,
    "AbilityLegend-komponenten skal findes",
  );
  assert.match(
    src,
    /t\("abilityLegend\.toggle"\)/,
    "legenden skal bruge riders:abilityLegend.toggle-nøglen til toggle-knappen",
  );
  assert.match(
    src,
    /<AbilityLegend /,
    "AbilityLegend skal rendres på siden",
  );
});

test("legenden bygger på den delte ABILITY_STATS + rider-namespace, ikke hardkodede navne (#1592)", () => {
  // Legenden itererer STATS (= ABILITY_STATS) og henter fulde navne via tRider,
  // så den deler ÉN kilde med tooltips og kolonne-koderne — ingen drift.
  const legend = src.match(/function AbilityLegend\([\s\S]*?\n\}/)?.[0];
  assert.ok(legend, "AbilityLegend-blokken skal kunne isoleres");
  assert.match(legend, /STATS\.map/, "legenden skal iterere den delte STATS-liste");
  assert.match(
    legend,
    /tRider\(`racePreview\.derived\.\$\{key\}`\)/,
    "legendens fulde navne skal komme fra rider:racePreview.derived.* (samme kilde som tooltips)",
  );
});
