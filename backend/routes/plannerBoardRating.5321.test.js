// #5321 — planlægger-boardets rating-felt.
//
// Spilleren mandia1984 så samme rytter med to forskellige rating-tal. Årsagen var
// ikke to formler i backenden, men ÉT sted der regnede den ene formel på for lidt
// data: GET /api/peak-plans/board hentede kun de evne-kolonner løbsmotoren
// bruger, og planlæggerens flader regnede ratingen ud af netop det udsnit.
// `ratingForRole` springer en manglende evne over i BÅDE tæller og nævner, så et
// udsnit giver et andet tal end hele rækken.
//
// SSOT'en er GAME_DESIGN_DOCUMENT.md D-049 (ejer-valgt 11/9): rating-tallet på
// rytterkort, i tabeller og på markedet er den samme størrelse overalt. Denne
// test holder på de to ting rettelsen hviler på:
//   1. mekanismen (et evne-udsnit giver et andet tal end hele rækken), og
//   2. at boardets kolonne-udtræk faktisk dækker hele opskriften.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ABILITY_KEYS as RACE_SIM_ABILITY_KEYS } from "../lib/raceSimulator.js";
import { REGISTRY_ABILITY_KEYS } from "../lib/abilityRegistry.js";
import { DISPLAY_RECIPES, ratingForRole } from "../lib/weights/displayRecipes.js";

const API_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "api.js"), "utf8");

const recipeAbilities = [...new Set(DISPLAY_RECIPES.flatMap((r) => Object.keys(r.weights)))];

test("#5321: løbsmotorens evne-udsnit dækker IKKE hele visnings-opskriften", () => {
  // Er dette ikke længere sandt, er bug'en strukturelt umulig og resten af
  // testen må skrives om — men den skal ikke bare stå og lyve.
  const missing = recipeAbilities.filter((k) => !RACE_SIM_ABILITY_KEYS.includes(k));
  assert.ok(missing.length > 0, "motorens udsnit dækker nu hele opskriften");
});

test("#5321: en rating regnet på et evne-udsnit er et ANDET tal end på hele rækken", () => {
  const full = Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k, i) => [k, 20 + ((i * 7) % 50)]));
  const slice = Object.fromEntries(RACE_SIM_ABILITY_KEYS.map((k) => [k, full[k]]));
  const differing = DISPLAY_RECIPES
    .map((r) => r.key)
    .filter((role) => ratingForRole(slice, role) !== ratingForRole(full, role));
  assert.ok(
    differing.length > 0,
    "intet rolle-tal flyttede sig — så beviser testen ikke den fejlklasse den er skrevet for",
  );
});

test("#5321: boardet henter evne-kolonnerne som union af motor og evne-register", () => {
  assert.match(
    API_SOURCE,
    /new Set\(\[\.\.\.RACE_SIM_ABILITY_KEYS, \.\.\.REGISTRY_ABILITY_KEYS\]\)/,
    "planlægger-boardets kolonne-udtræk er snævret ind igen",
  );
});

test("#5321: evne-registret dækker hver evne enhver visnings-opskrift bruger", () => {
  for (const key of recipeAbilities) {
    assert.ok(REGISTRY_ABILITY_KEYS.includes(key), `opskrift-evnen ${key} mangler i registret`);
  }
});

test("#5321: boardet sender ratingen færdigberegnet med i payloaden", () => {
  assert.match(
    API_SOURCE,
    /rating: ratingFromAbilities\(ratingRowByRider\.get\(r\.id\)/,
    "board-payloadens rating-felt er væk — så regner fladerne den selv igen",
  );
});
