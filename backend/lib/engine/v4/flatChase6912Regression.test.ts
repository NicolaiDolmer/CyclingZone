// #6912: complete-output digests generated before the flat/rolling change.
// Synthetic riders, frozen proxy routes, AI orders; hashes contain no balance measurements.
// The digests are computed in testUtils/flatChase6912Fingerprints.ts, which
// scripts/refresh-fingerprints.mjs (#7336) also uses to recompute the v3 keys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeFlatChase6912 } from "./testUtils/flatChase6912Fingerprints.ts";

const expected = JSON.parse(readFileSync(new URL("./test-data/flatChase6912Digests.json", import.meta.url), "utf8"));
test("#6912: v1/v2 complete stage outputs remain byte-identical", () => {
  assert.deepEqual(computeFlatChase6912("oldRevisions"), expected.oldRevisions);
});
test("#6912: v3 hilly/mountain complete stage-race outputs remain byte-identical", () => {
  assert.deepEqual(computeFlatChase6912("otherTerrain"), expected.otherTerrain);
});

test("#6912: v1/v2 complete stage-race outputs remain byte-identical", () => {
  assert.deepEqual(computeFlatChase6912("oldStageRaces"), expected.oldStageRaces);
});

test("#6912: v3 one-day hilly/mountain/cobbles/classic outputs remain byte-identical", () => {
  assert.deepEqual(computeFlatChase6912("otherOneDay"), expected.otherOneDay);
});
