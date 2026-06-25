// frontend/src/lib/stageTerrain.js
// Race Hub S4: rene terræn-helpers til løbs-detaljen. Ingen React, ingen I/O.
// terrainBucket SPEJLER backend/lib/raceTerrain.js (samme 9→5 mapping) — drift-guard
// i stageTerrain.test.js (mønstret som strategyLogic.js/TERRAIN_BUCKETS).

export const TERRAIN_BUCKETS = ["flat", "hilly", "mountain", "cobbles", "itt"];

const PROFILE_TO_BUCKET = {
  flat: "flat", rolling: "flat",
  hilly: "hilly", classic: "hilly",
  mountain: "mountain", high_mountain: "mountain",
  cobbles: "cobbles",
  itt: "itt", ttt: "itt",
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
