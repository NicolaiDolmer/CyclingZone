// Unit-tests for terrainBucket.ts (#4143 v2). Kører med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";

import { TERRAIN_BUCKETS, toTerrainBucket } from "./terrainBucket.ts";

test("en allerede-gyldig bucket returneres uændret", () => {
  for (const bucket of TERRAIN_BUCKETS) {
    assert.equal(toTerrainBucket(bucket), bucket);
  }
});

test("kendte profile_type-strenge mappes til rigtig bucket", () => {
  assert.equal(toTerrainBucket("flat"), "sprint");
  assert.equal(toTerrainBucket("rolling"), "sprint");
  assert.equal(toTerrainBucket("classic"), "hilly");
  assert.equal(toTerrainBucket("high_mountain"), "mountain");
  assert.equal(toTerrainBucket("itt_hilly"), "itt");
});

test("ukendt/manglende terræn falder tilbage til sprint (samme graceful-degrade som TerrainGlyph)", () => {
  assert.equal(toTerrainBucket("nonsense"), "sprint");
  assert.equal(toTerrainBucket(null), "sprint");
  assert.equal(toTerrainBucket(undefined), "sprint");
  assert.equal(toTerrainBucket(""), "sprint");
});
