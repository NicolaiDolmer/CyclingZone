// Unit-tests for terrainCode.ts (#4143). Kører med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";

import { TERRAIN_BUCKETS, TERRAIN_CODE, terrainCodeFor } from "./terrainCode.ts";

test("hver kalender-bucket har en kode", () => {
  for (const bucket of TERRAIN_BUCKETS) {
    assert.ok(TERRAIN_CODE[bucket], `mangler kode for ${bucket}`);
  }
});

test("koderne er alle unikke (#2791: brosten skal kunne skelnes fra flad/sprint)", () => {
  const codes = TERRAIN_BUCKETS.map((b) => TERRAIN_CODE[b]);
  assert.equal(new Set(codes).size, codes.length, "to buckets deler samme kode");
});

test("MasterCanvas' 'flat'-nøgle (backend terrainKey()) peger på samme kode som kalenderens 'sprint'", () => {
  assert.equal(TERRAIN_CODE.flat, TERRAIN_CODE.sprint);
});

test("terrainCodeFor: ukendt/manglende bucket falder tilbage til sprint-koden", () => {
  assert.equal(terrainCodeFor("nonsense"), TERRAIN_CODE.sprint);
  assert.equal(terrainCodeFor(null), TERRAIN_CODE.sprint);
  assert.equal(terrainCodeFor(undefined), TERRAIN_CODE.sprint);
});

test("terrainCodeFor: kendte buckets ruller igennem uændret", () => {
  assert.equal(terrainCodeFor("cobbles"), "COB");
  assert.equal(terrainCodeFor("mountain"), "MTN");
  assert.equal(terrainCodeFor("itt"), "ITT");
  assert.equal(terrainCodeFor("ttt"), "TTT");
});
