import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GREEN_FINISH_SCALES, INTERMEDIATE_SPRINT_SCALE, KOM_SCALES,
  FINISH_BONUS_SECONDS, INTERMEDIATE_BONUS_SECONDS, computePassages,
} from "./racePassages.js";

test("Tour-skalaer er ejer-låste værdier", () => {
  assert.deepEqual(GREEN_FINISH_SCALES.flat, [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.rolling, [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]);
  assert.deepEqual(GREEN_FINISH_SCALES.mountain, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(INTERMEDIATE_SPRINT_SCALE, [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(KOM_SCALES.HC, [20, 15, 12, 10, 8, 6, 4, 2]);
  assert.deepEqual(KOM_SCALES["1"], [10, 8, 6, 4, 2, 1]);
  assert.deepEqual(KOM_SCALES["4"], [1]);
  assert.deepEqual(FINISH_BONUS_SECONDS, [10, 6, 4]);
  assert.deepEqual(INTERMEDIATE_BONUS_SECONDS, [3, 2, 1]);
});

test("ingen rutedata → tomt resultat (data-gating)", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "flat", stage_number: 1 }, // ingen climbs/sprints/distance_km
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: true,
  });
  assert.deepEqual(out.passages, []);
  assert.equal(out.perRider.size, 0);
});

test("endagsløb → tomt resultat", () => {
  const out = computePassages({
    ranked: [{ rider_id: "a", rank: 1, components: { breakaway: 0 } }],
    stageProfile: { profile_type: "classic", distance_km: 240, climbs: [], sprints: [{ name: "Finish", km: 240, kind: "finish" }], sectors: [] },
    entrants: [{ rider_id: "a", abilities: {} }],
    seed: 42, isStageRace: false,
  });
  assert.deepEqual(out.passages, []);
});
