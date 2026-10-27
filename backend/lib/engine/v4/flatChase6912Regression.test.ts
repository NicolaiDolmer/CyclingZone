// #6912: complete-output digests generated before the flat/rolling change.
// Synthetic riders, frozen proxy routes, AI orders; hashes contain no balance measurements.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageRaceRuns } from "./testUtils/stageRaceField6804.ts";
import { digestOf, frozenDigests } from "./testUtils/oldRevisionDigests6199.ts";

const expected = JSON.parse(readFileSync(new URL("./test-data/flatChase6912Digests.json", import.meta.url), "utf8"));
test("#6912: v1/v2 complete stage outputs remain byte-identical", () => {
  assert.deepEqual(frozenDigests(["s5_profiles_v1", "s5_profiles_v2"]), expected.oldRevisions);
});
test("#6912: v3 hilly/mountain complete stage-race outputs remain byte-identical", () => {
  const actual = Object.fromEntries(stageRaceRuns("s5_profiles_v3", ["hilly", "mountain", "high_mountain"], ["6912-a", "6912-b"]).map(r => [r.key, digestOf(r.output)]));
  assert.deepEqual(actual, expected.otherTerrain);
});

test("#6912: v1/v2 complete stage-race outputs remain byte-identical", () => {
  const actual = Object.fromEntries(["s5_profiles_v1", "s5_profiles_v2"].map(rev => [rev, Object.fromEntries(stageRaceRuns(rev, ["flat", "rolling", "hilly", "mountain", "high_mountain"], ["6912-a", "6912-b"]).map(r => [r.key, digestOf(r.output)]))]));
  assert.deepEqual(actual, expected.oldStageRaces);
});
