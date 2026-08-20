import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRatingSortedIds } from "./riderColumnSort.js";

// #4035 regression: rating-kolonnen i rytterdatabasen (RidersPage) reagerede
// slet ikke på klik — kolonnen manglede sortKey, fordi ratingen er et vægtet
// snit af evne-kolonner (vægtene afhænger af rytterens primary_type,
// generated/displayRecipes.js) og derfor ikke er en enkelt DB-kolonne
// PostgREST kan ORDER BY direkte. mergeRatingSortedIds er den JS-fletning
// (fetchRidersSortedByRating, useRiderFilters.js) der beregner den ÆGTE
// rating med samme funktion som visningen (riderOverallRating) og sorterer
// på tværs af HELE det filtrerede sæt, ikke kun én side.

// sprinter-opskriften (displayRecipes.js): sprint4/acceleration3/positioning2/
// flat2/durability1 — sætter alle fem evner til samme værdi giver rating ==
// den værdi (vægtet snit af identiske tal).
function sprinterRider(id, level) {
  return {
    id, primary_type: "sprinter",
    sprint: level, acceleration: level, positioning: level, flat: level, durability: level,
  };
}

test("mergeRatingSortedIds desc — sorterer på den ÆGTE beregnede rating, ikke rå evner", () => {
  const rows = [
    sprinterRider("mid", 50),
    sprinterRider("high", 90),
    sprinterRider("low", 20),
  ];
  const ids = mergeRatingSortedIds(rows, false);
  assert.deepEqual(ids, ["high", "mid", "low"]);
});

test("mergeRatingSortedIds asc — omvendt rækkefølge", () => {
  const rows = [
    sprinterRider("mid", 50),
    sprinterRider("high", 90),
    sprinterRider("low", 20),
  ];
  const ids = mergeRatingSortedIds(rows, true);
  assert.deepEqual(ids, ["low", "mid", "high"]);
});

test("mergeRatingSortedIds — ryttere uden beregnelig rating (ukendt type) placeres SIDST uanset retning", () => {
  const rows = [
    sprinterRider("has-rating", 60),
    { id: "no-recipe", primary_type: "unknown-type", sprint: 60 },
  ];
  assert.deepEqual(mergeRatingSortedIds(rows, false), ["has-rating", "no-recipe"]);
  assert.deepEqual(mergeRatingSortedIds(rows, true), ["has-rating", "no-recipe"]);
});

test("mergeRatingSortedIds — stabil tie-break på id ved lige rating", () => {
  const rows = [sprinterRider("b", 70), sprinterRider("a", 70)];
  assert.deepEqual(mergeRatingSortedIds(rows, false), ["a", "b"]);
});
