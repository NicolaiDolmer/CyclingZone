// frontend/src/lib/raceResultsPodium.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { podiumFor } from "./raceResultsPodium.js";

const STAGE_RACE = { id: "race-1", race_type: "stage_race" };
const SINGLE_RACE = { id: "race-2", race_type: "single" };

test("podiumFor: færdigt etapeløb → gc-rækker på højeste stage_number, sorteret på rank", () => {
  const rows = [
    { race_id: "race-1", result_type: "gc", stage_number: 6, rank: 2, rider_id: "b" },
    { race_id: "race-1", result_type: "gc", stage_number: 6, rank: 1, rider_id: "a" },
    { race_id: "race-1", result_type: "gc", stage_number: 6, rank: 3, rider_id: "c" },
    { race_id: "race-1", result_type: "gc", stage_number: 6, rank: 4, rider_id: "d" }, // uden for top-3
    { race_id: "race-1", result_type: "leader", stage_number: 5, rank: 1, rider_id: "z" }, // anden etape, skal ignoreres
  ];
  const podium = podiumFor(STAGE_RACE, rows);
  assert.deepEqual(podium.map((r) => r.rider_id), ["a", "b", "c"]);
});

test("podiumFor: endagsløb → stage-resultatet ER podiet", () => {
  const rows = [
    { race_id: "race-2", result_type: "stage", stage_number: 1, rank: 1, rider_id: "x" },
    { race_id: "race-2", result_type: "stage", stage_number: 1, rank: 2, rider_id: "y" },
  ];
  const podium = podiumFor(SINGLE_RACE, rows);
  assert.deepEqual(podium.map((r) => r.rider_id), ["x", "y"]);
});

test("podiumFor: igangværende etapeløb uden 'gc'-rækker falder tilbage til seneste 'leader'-stilling (#3333)", () => {
  // Vuelta Ibérica-shapen: status stadig scheduled, ingen gc-rækker endnu, men
  // 'leader'-snapshots findes pr. kørt etape.
  const rows = [
    { race_id: "race-1", result_type: "leader", stage_number: 13, rank: 1, rider_id: "old1" },
    { race_id: "race-1", result_type: "leader", stage_number: 13, rank: 2, rider_id: "old2" },
    { race_id: "race-1", result_type: "leader", stage_number: 14, rank: 1, rider_id: "new1" },
    { race_id: "race-1", result_type: "leader", stage_number: 14, rank: 2, rider_id: "new2" },
    { race_id: "race-1", result_type: "leader", stage_number: 14, rank: 3, rider_id: "new3" },
  ];
  const podium = podiumFor(STAGE_RACE, rows);
  assert.deepEqual(podium.map((r) => r.rider_id), ["new1", "new2", "new3"]); // seneste (14), ikke etape 13
});

test("podiumFor: kun legacy rank-1-etaper (< #2081-motoren) → tomt podie, ikke crash", () => {
  const rows = [
    { race_id: "race-1", result_type: "leader", stage_number: 1, rank: 1, rider_id: "a" },
    { race_id: "race-1", result_type: "leader", stage_number: 2, rank: 1, rider_id: "b" },
  ];
  assert.deepEqual(podiumFor(STAGE_RACE, rows), []);
});

test("podiumFor: ingen relevante rækker → tomt podie", () => {
  assert.deepEqual(podiumFor(STAGE_RACE, []), []);
  assert.deepEqual(podiumFor(STAGE_RACE, null), []);
});

test("podiumFor: rækker fra andre løb ignoreres", () => {
  const rows = [
    { race_id: "other-race", result_type: "gc", stage_number: 1, rank: 1, rider_id: "nope" },
  ];
  assert.deepEqual(podiumFor(STAGE_RACE, rows), []);
});
