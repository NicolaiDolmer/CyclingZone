// #2352 (Race v3 S1): counterfactual hjælper-tab-metrik (top-terrain-linsen)
// + quantile-helper. Ren metrik-lib-test — ingen motor.
import test from "node:test";
import assert from "node:assert/strict";

import { helperCounterfactualDeltas, quantile } from "./raceDominanceMetrics.js";

// Hjælper: byg ranked-liste ud fra [rider_id, rank, terrain]-tripler.
const ranked = (rows) => rows.map(([rider_id, rank, terrain]) => ({
  rider_id, rank, components: { terrain },
}));

test("counterfactual: kun role=helper OG terrain-top-N medregnes; delta = rankRoles − rankCounterfactual (positiv = tabte pladser)", () => {
  const rankedRoles = ranked([
    ["captain1", 1, 0.70],
    ["helperTop", 15, 0.68],   // top-terrain helper — arbejdet kostede
    ["helperWeak", 40, 0.30],  // svag helper — UDEN for top-N-linsen
    ["free1", 3, 0.65],
  ]);
  const rankedCounterfactual = ranked([
    ["captain1", 2, 0.70],
    ["helperTop", 4, 0.68],    // uden arbejde havde han været nr. 4
    ["helperWeak", 38, 0.30],
    ["free1", 3, 0.65],
  ]);
  const roleByRider = new Map([
    ["captain1", "captain"],
    ["helperTop", "helper"],
    ["helperWeak", "helper"],
    ["free1", "free_role"],
  ]);
  const deltas = helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual, roleByRider, topTerrainN: 3 });
  // Kun helperTop: i terrain-top-3 (0.70/0.68/0.65) OG helper. Delta 15-4 = +11.
  assert.deepEqual(deltas, [11]);
});

test("counterfactual: topTerrainN afgrænser linsen (N=1 → kun feltets terrain-bedste kan medregnes)", () => {
  const rankedRoles = ranked([["h1", 10, 0.9], ["h2", 12, 0.8]]);
  const rankedCounterfactual = ranked([["h1", 2, 0.9], ["h2", 3, 0.8]]);
  const roleByRider = new Map([["h1", "helper"], ["h2", "helper"]]);
  assert.deepEqual(
    helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual, roleByRider, topTerrainN: 1 }),
    [8],
  );
  const both = helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual, roleByRider, topTerrainN: 2 });
  assert.deepEqual([...both].sort((a, b) => a - b), [8, 9]);
});

test("counterfactual: ryttere der kun findes i den ene kørsel springes over; tomme inputs → []", () => {
  const rankedRoles = ranked([["h1", 5, 0.9]]);
  const roleByRider = new Map([["h1", "helper"], ["ghost", "helper"]]);
  assert.deepEqual(
    helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual: [], roleByRider }),
    [],
  );
  assert.deepEqual(helperCounterfactualDeltas({}), []);
  assert.deepEqual(helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual: rankedRoles }), [], "manglende roleByRider → []");
});

test("counterfactual: deterministisk terrain-tiebreak på rider_id (lavere id vinder top-N-pladsen)", () => {
  // To ryttere med SAMME terrain — kun én plads i top-1. 'a' skal vinde pladsen.
  const rankedRoles = ranked([["b", 10, 0.5], ["a", 11, 0.5]]);
  const rankedCounterfactual = ranked([["b", 2, 0.5], ["a", 3, 0.5]]);
  const roleByRider = new Map([["a", "helper"], ["b", "helper"]]);
  const deltas = helperCounterfactualDeltas({ rankedRoles, rankedCounterfactual, roleByRider, topTerrainN: 1 });
  assert.deepEqual(deltas, [8], "kun 'a' (id-tiebreak) er i top-1 → kun a's delta (11-3=8)");
});

test("quantile: nearest-rank floor-konvention, p25/p50/p75", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.equal(quantile(xs, 0.25), 3);  // floor(0.25*8)=2 → sorted[2]=3
  assert.equal(quantile(xs, 0.5), 5);   // floor(4) → sorted[4]=5
  assert.equal(quantile(xs, 0.75), 7);  // floor(6) → sorted[6]=7
  assert.equal(quantile(xs, 1), 8, "p=1 clamper til sidste element");
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([42], 0.75), 42);
});
