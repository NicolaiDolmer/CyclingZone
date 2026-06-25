import test from "node:test";
import assert from "node:assert/strict";
import { terrainBucket, raceTerrainBucket, TERRAIN_BUCKETS } from "./raceTerrain.js";

test("terrainBucket: 9 profiltyper → 5 buckets (locks L3)", () => {
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

test("TERRAIN_BUCKETS er de 5 forventede i stabil rækkefølge", () => {
  assert.deepEqual(TERRAIN_BUCKETS, ["flat", "hilly", "mountain", "cobbles", "itt"]);
});

test("raceTerrainBucket: endagsløb → dets profils bucket", () => {
  assert.equal(raceTerrainBucket([{ profile_type: "cobbles" }]), "cobbles");
});

test("raceTerrainBucket: etapeløb → dominerende bucket over GC-etaper (flade ekskluderes)", () => {
  // 3 flade + 2 bjerg → GC-etaper er de 2 bjerg → mountain.
  const stages = [
    { profile_type: "flat" }, { profile_type: "flat" }, { profile_type: "flat" },
    { profile_type: "mountain" }, { profile_type: "high_mountain" },
  ];
  assert.equal(raceTerrainBucket(stages), "mountain");
});

test("raceTerrainBucket: kun flade etaper → flat (fallback til alle)", () => {
  assert.equal(raceTerrainBucket([{ profile_type: "flat" }, { profile_type: "rolling" }]), "flat");
});

test("raceTerrainBucket: tom/ugyldig → flat", () => {
  assert.equal(raceTerrainBucket([]), "flat");
  assert.equal(raceTerrainBucket(null), "flat");
});

test("raceTerrainBucket: tie brydes stabilt efter TERRAIN_BUCKETS-index", () => {
  // 1 hilly (GC) + 1 mountain (GC) → tie; hilly har lavere index → hilly.
  assert.equal(raceTerrainBucket([{ profile_type: "hilly" }, { profile_type: "mountain" }]), "hilly");
});
