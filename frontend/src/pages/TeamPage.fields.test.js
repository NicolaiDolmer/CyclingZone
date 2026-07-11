import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1482 — Holdsiden (SquadTab) renderer nu status/badges, ryttertype og
// kontraktudløb som egne kolonner. Felterne hentes via tre Supabase-selects i
// loadAll() (trup, pending). Hvis et felt falder ud af en select-liste
// ses tomme celler / "—" i UI'et uden anden fejl — denne test holder os ærlige.

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamPageSource = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");

// De felter de nye kolonner (RiderTypeBadge + kontraktudløb) er afhængige af.
// #1529: evne-kolonnerne hentes nu via det delte ABILITY_SELECT-fragment
// (rider_derived_abilities(...)) i stedet for de gamle 14 PCM stat_*-felter.
const REQUIRED = ["primary_type", "secondary_type", "contract_end_season", "ABILITY_SELECT"];

// Gamle PCM stat_*-felter må ikke længere selectes til visning (#1529).
const FORBIDDEN_PCM_STATS = [
  "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_prl", "stat_bro",
  "stat_sp", "stat_acc", "stat_ned", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
];

// Trup- + pending-select: riders.select(`id, firstname, ...`)
const directSelects = [...teamPageSource.matchAll(/\.from\("riders"\)\s*\.select\(`([^`]*)`\)/g)];

test("TeamPage riders-selects indeholder felter til de nye kolonner (#1482)", () => {
  assert.ok(directSelects.length >= 2, "forventede mindst 2 riders.select()-kald (trup + pending)");
  for (const m of directSelects) {
    for (const field of REQUIRED) {
      assert.match(
        m[1],
        new RegExp(`\\b${field}\\b`),
        `riders-select mangler '${field}' — rendres i Type/Contract-kolonnen og bliver tom hvis fjernet`,
      );
    }
  }
});

test("TeamPage riders-selects må IKKE indeholde potentiale (#1162)", () => {
  for (const m of directSelects) {
    assert.doesNotMatch(
      m[1],
      /\bpotentiale\b/,
      "potentiale er server-skjult (column privilege) — et select på den fejler HELE kaldet i PostgREST",
    );
  }
});

test("TeamPage selects må IKKE selecte gamle PCM stat_*-felter (#1529)", () => {
  for (const m of directSelects) {
    for (const field of FORBIDDEN_PCM_STATS) {
      assert.doesNotMatch(
        m[1],
        new RegExp(`\\b${field}\\b`),
        `riders-select indeholder stadig PCM-feltet '${field}' — visningen skal bruge ABILITY_SELECT (rider_derived_abilities)`,
      );
    }
  }
});

// #1482 — Type-kolonnen er sortérbar (sortKey="primary_type"). useRiderFilters
// SKAL sortere den som en streng (localeCompare); den generiske numeriske gren
// (bVal - aVal) giver NaN på strenge, så pilen toggler uden at sortere.
const filtersSource = readFileSync(join(__dirname, "..", "lib", "useRiderFilters.js"), "utf8");

test("useRiderFilters sorterer primary_type som streng, ikke numerisk (#1482)", () => {
  assert.match(
    filtersSource,
    /filters\.sort === "primary_type"[\s\S]{0,200}?localeCompare/,
    "primary_type-sort skal bruge localeCompare (streng) — ellers NaN i den numeriske gren",
  );
});
