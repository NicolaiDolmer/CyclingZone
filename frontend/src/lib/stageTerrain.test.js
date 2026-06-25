import test from "node:test";
import assert from "node:assert/strict";
import { terrainBucket, bucketCounts, topDemands, TERRAIN_BUCKETS } from "./stageTerrain.js";

test("terrainBucket: 9 profiltyper → 5 buckets (mirror af backend raceTerrain.js)", () => {
  assert.equal(terrainBucket("flat"), "flat");
  assert.equal(terrainBucket("rolling"), "flat");
  assert.equal(terrainBucket("hilly"), "hilly");
  assert.equal(terrainBucket("classic"), "hilly");
  assert.equal(terrainBucket("mountain"), "mountain");
  assert.equal(terrainBucket("high_mountain"), "mountain");
  assert.equal(terrainBucket("cobbles"), "cobbles");
  assert.equal(terrainBucket("itt"), "itt");
  assert.equal(terrainBucket("ttt"), "itt");
});

test("terrainBucket: ukendt/null → flat (defensiv default)", () => {
  assert.equal(terrainBucket("nonsense"), "flat");
  assert.equal(terrainBucket(null), "flat");
  assert.equal(terrainBucket(undefined), "flat");
});

test("TERRAIN_BUCKETS: 5 i stabil rækkefølge", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});

test("bucketCounts: tæller pr. bucket, sorteret count desc, tiebreak bucket-rækkefølge", () => {
  const stages = [
    { profile_type: "mountain" }, { profile_type: "high_mountain" },
    { profile_type: "flat" }, { profile_type: "rolling" }, { profile_type: "itt" },
  ];
  assert.deepEqual(bucketCounts(stages), [
    { bucket: "flat", count: 2 },
    { bucket: "mountain", count: 2 },
    { bucket: "itt", count: 1 },
  ]);
});

test("bucketCounts: tom → tom liste", () => {
  assert.deepEqual(bucketCounts([]), []);
  assert.deepEqual(bucketCounts(null), []);
});

test("topDemands: top-N evner, ekskl. randomness, sorteret vægt desc", () => {
  const dv = { climbing: 0.52, endurance: 0.18, tempo: 0.08, recovery: 0.06, randomness: 0.10 };
  assert.deepEqual(topDemands(dv, 3), [
    { ability: "climbing", weight: 0.52 },
    { ability: "endurance", weight: 0.18 },
    { ability: "tempo", weight: 0.08 },
  ]);
});

test("topDemands: tom/null demand_vector → tom liste", () => {
  assert.deepEqual(topDemands(null), []);
  assert.deepEqual(topDemands({}), []);
  assert.deepEqual(topDemands({ randomness: 0.5 }), []);
});
