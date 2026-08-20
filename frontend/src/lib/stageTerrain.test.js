import test from "node:test";
import assert from "node:assert/strict";
import { terrainBucket, bucketCounts, topDemands, remainderWeight, TERRAIN_BUCKETS } from "./stageTerrain.js";

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

// #3149: transparens-fix — de viste vægte skal altid kunne bringes til at summe
// til 100% ved at lægge remainderWeight til. ITT-tilfældet er #3149's eksakte
// spillerklage (58+24+6=88%, randomness=12% udelades stiltiende).
test("remainderWeight: itt-demand_vector — 88% vist + 12% rest = 100%", () => {
  const dv = { time_trial: 0.58, positioning: 0.24, flat: 0.06, randomness: 0.12 };
  const shown = topDemands(dv, 5);
  const shownPct = Math.round(shown.reduce((s, d) => s + d.weight, 0) * 100);
  assert.equal(shownPct, 88);
  assert.equal(Math.round(remainderWeight(dv, shown) * 100), 12);
});

test("remainderWeight: top-N afskærer også ikke-randomness-evner — resten dækker begge dele", () => {
  // classic har 9 ikke-randomness nøgler; top-5 viser kun de 5 tungeste.
  const dv = {
    endurance: 0.18, punch: 0.16, climbing: 0.12, cobblestone: 0.10, tempo: 0.06,
    flat: 0.06, positioning: 0.06, tactics: 0.04, sprint: 0.04, randomness: 0.18,
  };
  const shown = topDemands(dv, 5);
  assert.equal(shown.length, 5);
  // 0.18+0.16+0.12+0.10+0.06 = 0.62 vist; resten = 1.0 - 0.62 = 0.38 (0.16 afskårne evner + 0.18 randomness + 0.04 pga. tempo/flat-tie... beregnes, ikke gættes)
  const rest = remainderWeight(dv, shown);
  assert.ok(rest > 0.30 && rest < 0.40);
  const shownSum = shown.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(shownSum + rest - 1) < 1e-9, "vist + rest skal summe til demand_vector's totale sum (1.0)");
});

test("remainderWeight: intet at afrunde → 0", () => {
  assert.equal(remainderWeight(null, []), 0);
  assert.equal(remainderWeight({ climbing: 1 }, [{ ability: "climbing", weight: 1 }]), 0);
});
