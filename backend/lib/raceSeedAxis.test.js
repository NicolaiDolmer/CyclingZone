// backend/lib/raceSeedAxis.test.js — #3347 sæson-akse i parcours-seed'en.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seasonSeedSuffix, seasonVariantOf, SEASON_RETRY_TOKEN } from "./raceSeedAxis.js";

test("variant 0 / fraværende → nøglen er uændret ift. før #3347", () => {
  assert.equal(seasonSeedSuffix({ season_id: "s2" }), "::s2");
  assert.equal(seasonSeedSuffix({ season_id: "s2", season_variant: 0 }), "::s2");
  assert.equal(seasonSeedSuffix({ season_id: "s2", season_variant: null }), "::s2");
  assert.equal(seasonSeedSuffix({}), "");
});

test("variant > 0 giver et afledt, aflæseligt re-draw-suffiks", () => {
  assert.equal(seasonSeedSuffix({ season_id: "s2", season_variant: 1 }), `::s2${SEASON_RETRY_TOKEN}1`);
  assert.equal(seasonSeedSuffix({ season_id: "s2", season_variant: 7 }), "::s2:retry:7");
});

test("varianten tabes ALDRIG tavst når season_id mangler", () => {
  // Ellers ville en DB-fri harness/ad-hoc-kald køre 12 identiske 'gen-træk'.
  assert.equal(seasonSeedSuffix({ season_variant: 3 }), ":retry:3");
});

test("ugyldige varianter normaliseres til 0 (ingen NaN i seed-nøglen)", () => {
  for (const v of [-1, 1.5, "abc", NaN, undefined, {}]) assert.equal(seasonVariantOf({ season_variant: v }), 0);
  assert.equal(seasonVariantOf({ season_variant: "2" }), 2); // numerisk streng er fint
});
