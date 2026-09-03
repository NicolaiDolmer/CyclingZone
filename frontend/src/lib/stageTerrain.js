// frontend/src/lib/stageTerrain.js
// Race Hub S4: rene terræn-helpers til løbs-detaljen. Ingen React, ingen I/O.
// terrainBucket SPEJLER backend/lib/raceTerrain.js (samme 9→5 mapping) — drift-guard
// i stageTerrain.test.js (mønstret som strategyLogic.js/TERRAIN_BUCKETS).

export const TERRAIN_BUCKETS = ["flat", "hilly", "mountain", "cobbles", "itt"];

const PROFILE_TO_BUCKET = {
  flat: "flat", rolling: "flat",
  hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  cobbles: "cobbles", gravel: "cobbles", // #4105: grus deler bucket med brosten
  itt: "itt", ttt: "itt", itt_hilly: "itt",
};

export function terrainBucket(profileType) {
  return PROFILE_TO_BUCKET[profileType] || "flat";
}

// [{bucket, count}] sorteret count desc, tiebreak = TERRAIN_BUCKETS-index (stabil).
export function bucketCounts(stages) {
  if (!Array.isArray(stages) || !stages.length) return [];
  const counts = new Map();
  for (const s of stages) {
    const b = terrainBucket(s?.profile_type);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count || TERRAIN_BUCKETS.indexOf(a.bucket) - TERRAIN_BUCKETS.indexOf(b.bucket));
}

// Top-N evner ruten belønner, ekskl. randomness. [{ability, weight}] vægt desc.
export function topDemands(demandVector, n = 5) {
  if (!demandVector || typeof demandVector !== "object") return [];
  return Object.entries(demandVector)
    .filter(([k, w]) => k !== "randomness" && Number.isFinite(w) && w > 0)
    .map(([ability, weight]) => ({ ability, weight }))
    .sort((a, b) => b.weight - a.weight || a.ability.localeCompare(b.ability))
    .slice(0, n);
}

// #3149: DEMAND_VECTORS summer altid til 1.0 (raceStageProfileGenerator.js) —
// randomness (motorens støj-skalar, IKKE en evne) og evner uden for top-N'et
// topDemands viser, tælles her med i "resten". Uden dette summerede den viste
// procent kun til ~88% på fx enkeltstarter (spillerne på Discord: "hvor er de
// sidste 12%?") — resten er en ÆGTE afledt sum, aldrig et gættet tal.
export function remainderWeight(demandVector, shown = []) {
  if (!demandVector || typeof demandVector !== "object") return 0;
  const total = Object.values(demandVector).reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);
  const shownSum = shown.reduce((sum, d) => sum + (Number.isFinite(d?.weight) ? d.weight : 0), 0);
  const rest = total - shownSum;
  return rest > 0.0001 ? rest : 0;
}
