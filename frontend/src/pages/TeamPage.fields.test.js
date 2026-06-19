import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1482 — Holdsiden (SquadTab) renderer nu status/badges, ryttertype og
// kontraktudløb som egne kolonner. Felterne hentes via tre Supabase-selects i
// loadAll() (trup, pending, loan-in). Hvis et felt falder ud af en select-liste
// ses tomme celler / "—" i UI'et uden anden fejl — denne test holder os ærlige.

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamPageSource = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");

// De felter de nye kolonner (RiderTypeBadge + kontraktudløb) er afhængige af.
const REQUIRED = ["primary_type", "secondary_type", "contract_end_season"];

// Trup- + pending-select: riders.select(`id, firstname, ...`)
const directSelects = [...teamPageSource.matchAll(/\.from\("riders"\)\s*\.select\(`([^`]*)`\)/g)];
// Loan-in nested select: rider:rider_id(...)
const loanSelect = teamPageSource.match(/rider:rider_id\(([^)]*)\)/);

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

test("TeamPage loan-in select indeholder felter til de nye kolonner (#1482)", () => {
  assert.ok(loanSelect, "rider:rider_id(...) loan-select skal kunne findes");
  for (const field of REQUIRED) {
    assert.match(
      loanSelect[1],
      new RegExp(`\\b${field}\\b`),
      `loan-in rider-select mangler '${field}' — lejede ryttere ville mangle Type/Contract`,
    );
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
