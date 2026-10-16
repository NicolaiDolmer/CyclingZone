import test from "node:test";
import assert from "node:assert/strict";
import { stepState, primaryUpgradeTrack, ladderRow } from "./klubFacilityModel.ts";
import type { Facility } from "./klubFacilityModel.ts";

function fac(track: string, tier: number, upgradePrice: number | null, effectLive = true): Facility {
  return { track, tier, upgradePrice, tierUpkeep: 0, effectiveBonus: 0, nextTierBonus: null, effectLive };
}

test("stepState: ejede, nuværende, næste og senere trin", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((t) => stepState(t, 2)), ["owned", "current", "next", "future", "future"]);
  // Ikke bygget: intet nuværende trin, trin 1 er næste.
  assert.deepEqual([1, 2].map((t) => stepState(t, 0)), ["next", "future"]);
  assert.equal(stepState(5, 5), "current");
});

test("primaryUpgradeTrack: billigste live opgradering får guld-knappen", () => {
  const list = [fac("training", 2, 50_000), fac("scouting", 1, 26_000), fac("academy", 2, 50_000)];
  assert.equal(primaryUpgradeTrack(list), "scouting");
});

test("primaryUpgradeTrack: lige pris → første i rækkefølgen; låste og maxede tæller ikke", () => {
  const list = [fac("training", 2, 50_000), fac("academy", 2, 50_000), fac("medical", 0, 12_000, false), fac("commercial", 5, null)];
  assert.equal(primaryUpgradeTrack(list), "training");
  assert.equal(primaryUpgradeTrack([fac("training", 5, null), fac("medical", 0, 12_000, false)]), null);
  assert.equal(primaryUpgradeTrack([]), null);
});

test("ladderRow: finder trinnet, null uden trappe", () => {
  const f: Facility = { ...fac("training", 1, 26_000), ladder: [{ tier: 2, price: 26_000, upkeep: 3_500, bonus: 0.02 }] };
  assert.equal(ladderRow(f, 2)?.upkeep, 3_500);
  assert.equal(ladderRow(f, 3), null);
  assert.equal(ladderRow(fac("scouting", 0, 12_000), 1), null);
});
