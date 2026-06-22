import { test } from "node:test";
import assert from "node:assert/strict";
import { racesForPool } from "./racesByPool.js";

// #1715 — kalenderen hentede ALLE puljers løb (101 stk på tværs af 7 puljer),
// så samme løb optrådte som dubletter. racesForPool filtrerer den rene liste til
// spillerens egen pulje (league_division_id) + fælles/sæson-brede løb (NULL).
// Den rene logik enhedstestes, så filtreringen er korrekt uafhængigt af UI-render.

function race(id, leagueDivisionId) {
  return { id, league_division_id: leagueDivisionId };
}

test("beholder kun løb i spillerens egen pulje + fælles (NULL) løb", () => {
  const races = [
    race("own-a", 3),
    race("other-b", 5),
    race("shared-c", null),
    race("own-d", 3),
    race("other-e", 1),
  ];
  const ids = racesForPool(races, 3).map((r) => r.id);
  assert.deepEqual(ids, ["own-a", "shared-c", "own-d"]);
});

test("fælles (NULL) løb vises uanset pulje", () => {
  const races = [race("shared", null), race("other", 9)];
  const ids = racesForPool(races, 2).map((r) => r.id);
  assert.deepEqual(ids, ["shared"]);
});

test("uden pulje (null) falder tilbage til alle løb", () => {
  const races = [race("a", 1), race("b", 2), race("c", null)];
  const ids = racesForPool(races, null).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

test("uden pulje (undefined) falder tilbage til alle løb", () => {
  const races = [race("a", 1), race("b", 2)];
  const ids = racesForPool(races, undefined).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b"]);
});

test("matcher på tværs af number/string-pulje-id (løs lighed)", () => {
  const races = [race("own", 4), race("other", 7)];
  // Supabase kan levere id som number; selectedPool kan komme fra UI som string.
  const ids = racesForPool(races, "4").map((r) => r.id);
  assert.deepEqual(ids, ["own"]);
});

test("tom liste giver tom liste", () => {
  assert.deepEqual(racesForPool([], 3), []);
});

test("undefined/null liste giver tom liste", () => {
  assert.deepEqual(racesForPool(undefined, 3), []);
  assert.deepEqual(racesForPool(null, 3), []);
});

test("uændret input-array (ingen mutation)", () => {
  const races = [race("a", 3), race("b", 5)];
  const snapshot = races.map((r) => r.id);
  racesForPool(races, 3);
  assert.deepEqual(races.map((r) => r.id), snapshot);
});
